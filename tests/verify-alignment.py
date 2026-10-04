# ============================================================
# Standalone verification for Intent Alignment Engine (Python port)
# ============================================================
# This is a direct port of tests/verify-alignment.js for environments where
# Node is not available. It mirrors the same logic and scenarios and has zero
# impact on the extension itself.
#
# Run with: python tests/verify-alignment.py
# ============================================================

import math

BEHAVIORAL_STATES = {
    'GOAL_ORIENTED_SEARCH': 'Goal-Oriented Search',
    'SUSTAINED_ENGAGEMENT': 'Sustained Engagement',
    'CASUAL_EXPLORATION': 'Casual Exploration',
    'RECOMMENDATION_LOOP': 'Recommendation Loop',
    'PASSIVE_CONSUMPTION': 'Passive Consumption',
}

DRIFT_MEMORY_MAX = 50
DECAY_RATE = 0.97
PENALTY_DECAY = 0.90


def create_engine():
    return {
        'currentSession': {'originalIntention': 'Find a specific video', 'startTime': 0},
        'currentState': BEHAVIORAL_STATES['CASUAL_EXPLORATION'],
        'stateConfidence': {
            'Goal-Oriented Search': 20.0,
            'Sustained Engagement': 20.0,
            'Casual Exploration': 20.0,
            'Recommendation Loop': 20.0,
            'Passive Consumption': 20.0,
        },
        'behavioralMetrics': {
            'searchEvents': 0,
            'homepageVisits': 0,
            'homepageScrollEvents': 0,
            'homepageScrollStreak': 0,
            'lastIntentionalInteractionTime': 0,
            'recommendationClicks': 0,
            'autoplayTransitions': 0,
            'autoplayCount': 0,
            'videoSwitches': 0,
            'scrollEvents': 0,
            'timeSinceLastSearch': 0,
            'consecutiveRecommendations': 0,
            'videoWatchDurations': [],
            'lastSearchTime': 0,
            'sustainedViewingTime': 0,
            'intentionalSustainedViewingTime': 0,
            'isCurrentVideoAutoplay': False,
            'isCurrentVideoFromRecommendation': False,
            'lastVideoChangeWasManual': False,
            'rapidSwitchCount': 0,
            'lastVideoSwitchTime': 0,
        },
        'intentAlignmentScore': 100,
        'driftMemory': 0.0,
        'autoplayCap': 100,
        'driftEvents': [],
        'locationHref': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        'videoPlaying': True,
    }


def is_homepage(engine):
    href = engine['locationHref']
    return (href == 'https://www.youtube.com/' or
            href == 'https://www.youtube.com' or
            href == 'https://www.youtube.com/home' or
            'youtube.com/feed' in href)


def document_query_selector(engine):
    return {'paused': not engine['videoPlaying'], 'currentTime': 5 if engine['videoPlaying'] else 0}


def is_ad_playing():
    return False


def sign(x):
    return 1 if x > 0 else -1 if x < 0 else 0


def calculate_intent_alignment(engine):
    current_session = engine['currentSession']
    if not current_session:
        engine['intentAlignmentScore'] = 100
        return

    intention = current_session.get('originalIntention') or current_session.get('intention', 'Explore a topic')
    sc = engine['stateConfidence']
    bm = engine['behavioralMetrics']

    rec_loop_conf = max(0, sc[BEHAVIORAL_STATES['RECOMMENDATION_LOOP']] - 20)
    passive_conf = max(0, sc[BEHAVIORAL_STATES['PASSIVE_CONSUMPTION']] - 20)
    goal_conf = sc[BEHAVIORAL_STATES['GOAL_ORIENTED_SEARCH']]
    engage_conf = sc[BEHAVIORAL_STATES['SUSTAINED_ENGAGEMENT']]
    casual_conf = sc[BEHAVIORAL_STATES['CASUAL_EXPLORATION']]

    intent_weights = {
        'Find a specific video': {'recLoop': 1.0, 'autoplay': 1.0, 'rapidSwitch': 1.0, 'passive': 1.0, 'homepageScroll': 1.0},
        'Learn something': {'recLoop': 0.9, 'autoplay': 0.9, 'rapidSwitch': 0.85, 'passive': 0.85, 'homepageScroll': 0.7},
        'Relax / Be entertained': {'recLoop': 0.45, 'autoplay': 0.45, 'rapidSwitch': 0.5, 'passive': 0.35, 'homepageScroll': 0.25},
        'Explore a topic': {'recLoop': 0.45, 'autoplay': 0.50, 'rapidSwitch': 0.6, 'passive': 0.65, 'homepageScroll': 0.75},
    }
    w = intent_weights.get(intention, intent_weights['Explore a topic'])

    penalty = 0.0
    rec_cap_for_intent = 30 if intention == 'Find a specific video' else 50
    rec_step_for_intent = 10 if intention == 'Relax / Be entertained' else (14 if intention == 'Learn something' else (18 if intention == 'Find a specific video' else 12))
    penalty += min(rec_cap_for_intent, bm['consecutiveRecommendations'] * rec_step_for_intent) * w['recLoop']
    penalty += min(20, bm['autoplayTransitions'] * 10) * w['autoplay']
    penalty += min(30, bm['rapidSwitchCount'] * 8) * w['rapidSwitch']
    penalty += (rec_loop_conf / 80) * 35 * w['recLoop']
    penalty += (passive_conf / 80) * 30 * w['passive']

    on_homepage = is_homepage(engine)
    on_video_page = '/watch' in engine['locationHref'] or '/shorts' in engine['locationHref']
    scroll_streak = bm['homepageScrollStreak']
    no_recent_search = bm['searchEvents'] == 0 or bm['timeSinceLastSearch'] > 120000
    now = 0  # time is frozen in tests; lastIntentionalInteractionTime is used relative to 0
    idle_ms = bm['lastIntentionalInteractionTime'] if bm['lastIntentionalInteractionTime'] > 0 else 0
    prolonged_idle = idle_ms > 20000
    idle_minutes = idle_ms / 60000.0

    vid = document_query_selector(engine)
    video_is_playing = bool(vid and not vid['paused'] and vid['currentTime'] > 0 and not is_ad_playing())
    idle_minutes_for_video_page = 0 if video_is_playing else idle_minutes
    homepage_drift = 0.0

    if intention == 'Find a specific video':
        if on_homepage or on_video_page:
            homepage_drift += scroll_streak * 8
        if on_homepage and no_recent_search:
            homepage_drift += idle_minutes * 36
        elif on_video_page and no_recent_search:
            homepage_drift += idle_minutes_for_video_page * 36
    elif intention == 'Learn something':
        if on_homepage or on_video_page:
            homepage_drift += scroll_streak * 6
        if on_homepage and no_recent_search and prolonged_idle:
            homepage_drift += idle_minutes * 34
        elif on_video_page and no_recent_search and prolonged_idle:
            homepage_drift += idle_minutes_for_video_page * 34
    elif intention == 'Relax / Be entertained':
        if on_homepage or on_video_page:
            homepage_drift += scroll_streak * 4
        if on_homepage:
            homepage_drift += idle_minutes * 27
        elif on_video_page:
            homepage_drift += idle_minutes_for_video_page * 27
    elif intention == 'Explore a topic':
        if on_homepage or on_video_page:
            homepage_drift += scroll_streak * 5
        if on_homepage:
            homepage_drift += idle_minutes * 15
        elif on_video_page:
            homepage_drift += idle_minutes_for_video_page * 15

    penalty += homepage_drift * max(0, w['homepageScroll'])

    rec_loop_penalty_this_cycle = min(rec_cap_for_intent, bm['consecutiveRecommendations'] * rec_step_for_intent) * w['recLoop']
    drift_this_cycle = (homepage_drift * max(0, w['homepageScroll'])) + rec_loop_penalty_this_cycle
    engine['driftMemory'] = max(0.0, engine['driftMemory'] * 0.95)
    engine['driftMemory'] = min(DRIFT_MEMORY_MAX, engine['driftMemory'] + drift_this_cycle * 0.12)
    penalty += engine['driftMemory']

    homepage_idling = on_homepage and prolonged_idle
    is_passive_state = engine['currentState'] in (BEHAVIORAL_STATES['PASSIVE_CONSUMPTION'], BEHAVIORAL_STATES['RECOMMENDATION_LOOP'])
    bonus = 0.0

    if intention == 'Find a specific video':
        find_on_task = (not bm['isCurrentVideoAutoplay'] and
                        not bm['isCurrentVideoFromRecommendation'] and
                        bm['consecutiveRecommendations'] < 1 and
                        bm['searchEvents'] > 0)
        find_off_task = (on_video_page and not find_on_task and not bm['isCurrentVideoAutoplay'] and
                         not bm['isCurrentVideoFromRecommendation'] and
                         bm['consecutiveRecommendations'] < 1 and
                         not bm['lastVideoChangeWasManual'])
        if find_off_task and not is_passive_state:
            penalty += 8
        if not homepage_idling and not is_passive_state and find_on_task:
            bonus += (goal_conf / 100) * 35
        if not homepage_idling and not is_passive_state and find_on_task:
            bonus += (engage_conf / 100) * 15
        if not homepage_idling and find_on_task and bm['timeSinceLastSearch'] < 120000:
            bonus += 20
    elif intention == 'Learn something':
        learn_context = not bm['isCurrentVideoAutoplay'] and bm['consecutiveRecommendations'] < 1
        if not homepage_idling and not is_passive_state:
            bonus += (goal_conf / 100) * 20
        if not homepage_idling and not is_passive_state and learn_context:
            bonus += (engage_conf / 100) * 35
        if (not homepage_idling and not is_passive_state and learn_context and
                bm['intentionalSustainedViewingTime'] > 30000):
            bonus += min(30, (bm['intentionalSustainedViewingTime'] / 60000) * 22)
        if not homepage_idling and bm['searchEvents'] > 0 and bm['timeSinceLastSearch'] < 600000:
            bonus += 10
    elif intention == 'Relax / Be entertained':
        relax_context = not bm['isCurrentVideoAutoplay']
        if not homepage_idling and relax_context:
            bonus += (casual_conf / 100) * 30
        if not homepage_idling and not is_passive_state and relax_context:
            bonus += (engage_conf / 100) * 25
        if (not homepage_idling and not is_passive_state and relax_context and
                bm['intentionalSustainedViewingTime'] > 30000):
            bonus += min(20, (bm['intentionalSustainedViewingTime'] / 60000) * 16)
    elif intention == 'Explore a topic':
        suppress_homepage_bonus = on_homepage and no_recent_search
        explore_context = (not bm['isCurrentVideoAutoplay'] and
                         (bm['consecutiveRecommendations'] > 0 or bm['searchEvents'] > 0))
        if not suppress_homepage_bonus:
            bonus += (casual_conf / 100) * 22
        if not suppress_homepage_bonus and not is_passive_state and explore_context:
            bonus += (engage_conf / 100) * 18
        if not suppress_homepage_bonus and not is_passive_state:
            bonus += (goal_conf / 100) * 10
        if (not suppress_homepage_bonus and not is_passive_state and explore_context and
                bm['intentionalSustainedViewingTime'] > 30000):
            bonus += min(15, (bm['intentionalSustainedViewingTime'] / 60000) * 12)
        explore_rec_bonus = min(3, bm['consecutiveRecommendations'])
        if not is_passive_state and explore_rec_bonus > 0:
            bonus += explore_rec_bonus * 8
        if not suppress_homepage_bonus and bm['searchEvents'] > 0 and bm['timeSinceLastSearch'] < 300000:
            bonus += 8

    bonus = min(40, bonus)

    alignment = max(0, min(100, round(100 - penalty + bonus)))
    alignment = min(alignment, engine['autoplayCap'])
    diff = alignment - engine['intentAlignmentScore']
    if abs(diff) > 15:
        engine['intentAlignmentScore'] += sign(diff) * 15
    else:
        engine['intentAlignmentScore'] = alignment


def round(x):
    return int(math.floor(x + 0.5))


def apply_decay(engine):
    for state in engine['stateConfidence']:
        engine['stateConfidence'][state] = max(0.0, engine['stateConfidence'][state] * DECAY_RATE)
    bm = engine['behavioralMetrics']
    # Preserve the recommendation chain while the current video is from a recommendation.
    if not bm['isCurrentVideoFromRecommendation']:
        bm['consecutiveRecommendations'] *= PENALTY_DECAY
    bm['rapidSwitchCount'] *= PENALTY_DECAY
    bm['autoplayTransitions'] *= PENALTY_DECAY
    bm['homepageScrollStreak'] *= PENALTY_DECAY
    if bm['consecutiveRecommendations'] < 0.1:
        bm['consecutiveRecommendations'] = 0
    if bm['rapidSwitchCount'] < 0.1:
        bm['rapidSwitchCount'] = 0
    if bm['autoplayTransitions'] < 0.1:
        bm['autoplayTransitions'] = 0
    if bm['homepageScrollStreak'] < 0.1:
        bm['homepageScrollStreak'] = 0


def simulate_ticks(engine, n, intention):
    engine['currentSession']['originalIntention'] = intention
    for _ in range(n):
        calculate_intent_alignment(engine)


def simulate_ticks_with_decay(engine, n, intention):
    engine['currentSession']['originalIntention'] = intention
    for _ in range(n):
        apply_decay(engine)
        calculate_intent_alignment(engine)


def search(engine):
    bm = engine['behavioralMetrics']
    bm['searchEvents'] += 1
    bm['lastSearchTime'] = 0
    bm['timeSinceLastSearch'] = 0
    bm['consecutiveRecommendations'] = 0
    bm['homepageScrollStreak'] = 0
    bm['lastIntentionalInteractionTime'] = 1  # >0 to avoid idle
    bm['isCurrentVideoAutoplay'] = False
    bm['isCurrentVideoFromRecommendation'] = False
    bm['lastVideoChangeWasManual'] = True
    engine['stateConfidence']['Goal-Oriented Search'] = min(100, engine['stateConfidence']['Goal-Oriented Search'] + 25)


def watch_intentionally(engine, seconds):
    bm = engine['behavioralMetrics']
    bm['intentionalSustainedViewingTime'] += seconds * 1000
    bm['sustainedViewingTime'] += seconds * 1000
    engine['stateConfidence']['Sustained Engagement'] = min(100, engine['stateConfidence']['Sustained Engagement'] + seconds * 0.8)
    bm['lastIntentionalInteractionTime'] = 1


def click_recommendation(engine, passive):
    bm = engine['behavioralMetrics']
    bm['recommendationClicks'] += 1
    bm['consecutiveRecommendations'] += 1
    bm['homepageScrollStreak'] = 0
    if passive:
        bm['isCurrentVideoAutoplay'] = True
        bm['isCurrentVideoFromRecommendation'] = False
        bm['lastVideoChangeWasManual'] = False
    else:
        bm['lastIntentionalInteractionTime'] = 1
        bm['isCurrentVideoAutoplay'] = False
        bm['isCurrentVideoFromRecommendation'] = True
        bm['lastVideoChangeWasManual'] = True
    engine['stateConfidence']['Recommendation Loop'] = min(100, engine['stateConfidence']['Recommendation Loop'] + 15)


def autoplay(engine):
    bm = engine['behavioralMetrics']
    bm['autoplayTransitions'] += 1
    bm['autoplayCount'] += 1
    bm['consecutiveRecommendations'] += 1
    bm['isCurrentVideoAutoplay'] = True
    bm['isCurrentVideoFromRecommendation'] = False
    new_cap = 85 if bm['autoplayCount'] == 1 else 70 if bm['autoplayCount'] == 2 else 55
    engine['autoplayCap'] = min(engine['autoplayCap'], new_cap)
    engine['stateConfidence']['Passive Consumption'] = min(100, engine['stateConfidence']['Passive Consumption'] + 20)


def homepage_scroll(engine, count):
    engine['locationHref'] = 'https://www.youtube.com/'
    bm = engine['behavioralMetrics']
    bm['scrollEvents'] += count
    bm['homepageScrollEvents'] += count
    bm['homepageScrollStreak'] += count
    bm['lastIntentionalInteractionTime'] = 1
    engine['stateConfidence']['Casual Exploration'] = min(100, engine['stateConfidence']['Casual Exploration'] + count * 3)


def rapid_switch(engine, count):
    bm = engine['behavioralMetrics']
    bm['videoSwitches'] += count
    bm['rapidSwitchCount'] += count
    bm['lastVideoSwitchTime'] = 0
    bm['lastIntentionalInteractionTime'] = 1


def manual_navigation(engine, url):
    engine['locationHref'] = url
    bm = engine['behavioralMetrics']
    bm['lastIntentionalInteractionTime'] = 1
    bm['isCurrentVideoAutoplay'] = False
    bm['isCurrentVideoFromRecommendation'] = False
    bm['lastVideoChangeWasManual'] = True
    bm['consecutiveRecommendations'] = 0


def visit_shorts(engine):
    manual_navigation(engine, 'https://www.youtube.com/shorts/abc123')
    engine['stateConfidence']['Sustained Engagement'] = min(100, engine['stateConfidence']['Sustained Engagement'] + 10)


def set_state(engine, state):
    engine['currentState'] = state


def change_intention(engine, intention):
    engine['currentSession']['intention'] = intention
    engine['currentSession']['originalIntention'] = intention


def score_for_behavior(behavior_fn, ticks=5):
    results = {}
    for intent in ['Find a specific video', 'Learn something', 'Explore a topic', 'Relax / Be entertained']:
        e = create_engine()
        behavior_fn(e)
        simulate_ticks(e, ticks, intent)
        results[intent] = e['intentAlignmentScore']
    return results


passed = 0
failed = 0
failures = []


def assert_check(name, condition, details):
    global passed, failed
    if condition:
        passed += 1
        print('  PASS: ' + name)
    else:
        failed += 1
        failures.append(name + ' — ' + details)
        print('  FAIL: ' + name + ' — ' + details)


def run_scenario(name, fn):
    print('\n' + name)
    engine = create_engine()
    fn(engine)


def run_all_tests():
    global passed, failed, failures
    passed = 0
    failed = 0
    failures = []
    print('Intentional YouTube — Alignment Engine Verification (Python port)')
    print('==================================================================')

    run_scenario('Find: search then watch searched video', lambda e: (
        search(e),
        watch_intentionally(e, 120),
        simulate_ticks(e, 10, 'Find a specific video'),
        assert_check('alignment should be high', e['intentAlignmentScore'] >= 95, 'score=' + str(e['intentAlignmentScore'])),
        assert_check('findOnTask should hold', not e['behavioralMetrics']['isCurrentVideoFromRecommendation'],
                     'fromRec=' + str(e['behavioralMetrics']['isCurrentVideoFromRecommendation']))
    ))

    run_scenario('Find: search, recommendation, long watch does not fully recover', lambda e: (
        search(e),
        click_recommendation(e, False),
        watch_intentionally(e, 300),
        simulate_ticks(e, 20, 'Find a specific video'),
        assert_check('alignment should not reach 100', e['intentAlignmentScore'] < 100, 'score=' + str(e['intentAlignmentScore'])),
        assert_check('alignment should reflect a meaningful, lasting rec penalty', e['intentAlignmentScore'] < 75,
                     'score=' + str(e['intentAlignmentScore'])),
        assert_check('provenance flag should persist', e['behavioralMetrics']['isCurrentVideoFromRecommendation'],
                     'fromRec=' + str(e['behavioralMetrics']['isCurrentVideoFromRecommendation'])),
        assert_check('driftMemory should be positive', e['driftMemory'] > 0, 'driftMemory=' + str(e['driftMemory']))
    ))

    run_scenario('Find: recommendation drift persists during sustained viewing', lambda e: (
        search(e),
        click_recommendation(e, False),
        watch_intentionally(e, 300),
        e.update({'_afterRec': e['intentAlignmentScore']}),
        simulate_ticks_with_decay(e, 60, 'Find a specific video'),
        assert_check('consecutiveRecommendations should not decay to 0', e['behavioralMetrics']['consecutiveRecommendations'] >= 1,
                     'consecutiveRecommendations=' + str(e['behavioralMetrics']['consecutiveRecommendations'])),
        assert_check('alignment should not recover toward pre-rec level', e['intentAlignmentScore'] <= e['_afterRec'] + 5,
                     'afterRec=' + str(e['_afterRec']) + ' final=' + str(e['intentAlignmentScore'])),
        assert_check('driftMemory should remain substantial', e['driftMemory'] >= 20,
                     'driftMemory=' + str(e['driftMemory']))
    ))

    run_scenario('Find: recommendation chain resumes decay after manual navigation', lambda e: (
        search(e),
        click_recommendation(e, False),
        watch_intentionally(e, 60),
        manual_navigation(e, 'https://www.youtube.com/watch?v=manual123'),
        watch_intentionally(e, 120),
        simulate_ticks_with_decay(e, 40, 'Find a specific video'),
        assert_check('consecutiveRecommendations should decay after leaving rec video', e['behavioralMetrics']['consecutiveRecommendations'] < 1,
                     'consecutiveRecommendations=' + str(e['behavioralMetrics']['consecutiveRecommendations'])),
        assert_check('isCurrentVideoFromRecommendation should be cleared', not e['behavioralMetrics']['isCurrentVideoFromRecommendation'],
                     'fromRec=' + str(e['behavioralMetrics']['isCurrentVideoFromRecommendation']))
    ))

    run_scenario('Learn: focused learning session stays high', lambda e: (
        search(e),
        watch_intentionally(e, 180),
        simulate_ticks(e, 10, 'Learn something'),
        assert_check('alignment should be high', e['intentAlignmentScore'] >= 95, 'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Learn: single recommendation causes small drift', lambda e: (
        search(e),
        watch_intentionally(e, 120),
        simulate_ticks(e, 5, 'Learn something'),
        e.update({'_before': e['intentAlignmentScore']}),
        click_recommendation(e, False),
        watch_intentionally(e, 60),
        simulate_ticks(e, 10, 'Learn something'),
        assert_check('alignment should drop after one rec', e['intentAlignmentScore'] < e['_before'],
                     'before=' + str(e['_before']) + ' after=' + str(e['intentAlignmentScore'])),
        assert_check('drop should be small/moderate, not catastrophic', e['intentAlignmentScore'] >= 70,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Learn: two recommendations cause larger drift', lambda e: (
        search(e),
        click_recommendation(e, False),
        click_recommendation(e, False),
        watch_intentionally(e, 60),
        simulate_ticks(e, 10, 'Learn something'),
        assert_check('alignment should be significantly lower', e['intentAlignmentScore'] < 90,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Explore: manual recommendation chain is rewarded', lambda e: (
        search(e),
        click_recommendation(e, False),
        click_recommendation(e, False),
        watch_intentionally(e, 90),
        simulate_ticks(e, 10, 'Explore a topic'),
        assert_check('alignment should be high for active exploration', e['intentAlignmentScore'] >= 90,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Relax: manual video choice stays high', lambda e: (
        e['behavioralMetrics'].update({'lastIntentionalInteractionTime': 1}),
        watch_intentionally(e, 120),
        simulate_ticks(e, 10, 'Relax / Be entertained'),
        assert_check('alignment should be high', e['intentAlignmentScore'] >= 95, 'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Relax: autoplay reduces alignment', lambda e: (
        e['behavioralMetrics'].update({'lastIntentionalInteractionTime': 1}),
        watch_intentionally(e, 60),
        autoplay(e),
        watch_intentionally(e, 60),
        simulate_ticks(e, 10, 'Relax / Be entertained'),
        assert_check('alignment should drop after autoplay', e['intentAlignmentScore'] < 100,
                     'score=' + str(e['intentAlignmentScore'])),
        assert_check('autoplayCap should be reduced', e['autoplayCap'] < 100, 'cap=' + str(e['autoplayCap']))
    ))

    run_scenario('Drift memory persists after homepage browsing', lambda e: (
        e['currentSession'].update({'originalIntention': 'Find a specific video'}),
        homepage_scroll(e, 8),
        simulate_ticks(e, 5, 'Find a specific video'),
        e.update({'_drift_after_scroll': e['driftMemory']}),
        e['behavioralMetrics'].update({'homepageScrollStreak': 0, 'isCurrentVideoFromRecommendation': True}),
        e.update({'locationHref': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}),
        watch_intentionally(e, 120),
        simulate_ticks(e, 10, 'Find a specific video'),
        assert_check('driftMemory should still be positive', e['driftMemory'] > 0,
                     'driftMemory=' + str(e['driftMemory'])),
        assert_check('alignment should not fully recover', e['intentAlignmentScore'] < 100,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Autoplay cap limits alignment ceiling', lambda e: (
        e['currentSession'].update({'originalIntention': 'Relax / Be entertained'}),
        autoplay(e),
        autoplay(e),
        autoplay(e),
        watch_intentionally(e, 300),
        simulate_ticks(e, 20, 'Relax / Be entertained'),
        assert_check('alignment should not exceed autoplayCap', e['intentAlignmentScore'] <= e['autoplayCap'],
                     'score=' + str(e['intentAlignmentScore']) + ' cap=' + str(e['autoplayCap']))
    ))

    run_scenario('Cross-intent: recommendation chain produces different alignment', lambda e: (
        e.update({'_scores': score_for_behavior(lambda eng: (
            click_recommendation(eng, False),
            click_recommendation(eng, False),
            click_recommendation(eng, False),
            watch_intentionally(eng, 60)
        ), 10)}),
        assert_check('Find is most penalized', e['_scores']['Find a specific video'] < e['_scores']['Relax / Be entertained'],
                     str(e['_scores'])),
        assert_check('Learn is more penalized than Explore/Relax', e['_scores']['Learn something'] < e['_scores']['Explore a topic'],
                     str(e['_scores'])),
        assert_check('Explore and Relax stay high', e['_scores']['Explore a topic'] >= 90 and e['_scores']['Relax / Be entertained'] >= 90,
                     str(e['_scores']))
    ))

    run_scenario('Cross-intent: rapid switching produces different alignment', lambda e: (
        e.update({'_scores': score_for_behavior(lambda eng: (
            rapid_switch(eng, 5),
        ), 10)}),
        assert_check('Find is most penalized', e['_scores']['Find a specific video'] < e['_scores']['Relax / Be entertained'],
                     str(e['_scores'])),
        assert_check('Learn is more penalized than Explore', e['_scores']['Learn something'] < e['_scores']['Explore a topic'],
                     str(e['_scores'])),
        assert_check('all four scores differ', len(set(e['_scores'].values())) == 4, str(e['_scores']))
    ))

    run_scenario('Cross-intent: homepage browsing produces different drift', lambda e: (
        e.update({'_scores': score_for_behavior(lambda eng: (
            homepage_scroll(eng, 10),
        ), 5)}),
        assert_check('Find is most penalized', e['_scores']['Find a specific video'] < e['_scores']['Relax / Be entertained'],
                     str(e['_scores'])),
        assert_check('Find and Learn are more penalized than Relax', e['_scores']['Find a specific video'] < e['_scores']['Relax / Be entertained'] and e['_scores']['Learn something'] < e['_scores']['Relax / Be entertained'],
                     str(e['_scores'])),
        assert_check('all four scores differ', len(set(e['_scores'].values())) == 4, str(e['_scores']))
    ))

    run_scenario('Find: search recovery resets recommendation chain and recovers alignment', lambda e: (
        e['currentSession'].update({'originalIntention': 'Find a specific video'}),
        search(e),
        click_recommendation(e, False),
        click_recommendation(e, False),
        search(e),
        watch_intentionally(e, 120),
        simulate_ticks(e, 10, 'Find a specific video'),
        assert_check('consecutiveRecommendations is reset', e['behavioralMetrics']['consecutiveRecommendations'] == 0,
                     'consecutiveRecommendations=' + str(e['behavioralMetrics']['consecutiveRecommendations'])),
        assert_check('alignment recovers after search', e['intentAlignmentScore'] >= 90,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Learn: search recovery after recommendation chain', lambda e: (
        e['currentSession'].update({'originalIntention': 'Learn something'}),
        search(e),
        click_recommendation(e, False),
        click_recommendation(e, False),
        search(e),
        watch_intentionally(e, 120),
        simulate_ticks(e, 10, 'Learn something'),
        assert_check('alignment recovers after search', e['intentAlignmentScore'] >= 85,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Shorts: manual navigation is treated as intentional video page', lambda e: (
        e['currentSession'].update({'originalIntention': 'Relax / Be entertained'}),
        visit_shorts(e),
        watch_intentionally(e, 60),
        simulate_ticks(e, 5, 'Relax / Be entertained'),
        assert_check('treated as video page', ('/shorts' in e['locationHref']), 'href=' + e['locationHref']),
        assert_check('not flagged as autoplay', not e['behavioralMetrics']['isCurrentVideoAutoplay'],
                     'autoplay=' + str(e['behavioralMetrics']['isCurrentVideoAutoplay'])),
        assert_check('alignment stays high', e['intentAlignmentScore'] >= 90, 'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Autoplay cap tiered correctly', lambda e: (
        e['currentSession'].update({'originalIntention': 'Relax / Be entertained'}),
        autoplay(e),
        assert_check('first autoplay cap is 85', e['autoplayCap'] == 85, 'cap=' + str(e['autoplayCap'])),
        autoplay(e),
        assert_check('second autoplay cap is 70', e['autoplayCap'] == 70, 'cap=' + str(e['autoplayCap'])),
        autoplay(e),
        assert_check('third autoplay cap is 55', e['autoplayCap'] == 55, 'cap=' + str(e['autoplayCap']))
    ))

    run_scenario('Find: three recommendations cause severe penalty', lambda e: (
        e['currentSession'].update({'originalIntention': 'Find a specific video'}),
        click_recommendation(e, False),
        click_recommendation(e, False),
        click_recommendation(e, False),
        watch_intentionally(e, 60),
        simulate_ticks(e, 10, 'Find a specific video'),
        assert_check('alignment drops severely', e['intentAlignmentScore'] < 50, 'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Learn: three recommendations cause significant penalty', lambda e: (
        e['currentSession'].update({'originalIntention': 'Learn something'}),
        click_recommendation(e, False),
        click_recommendation(e, False),
        click_recommendation(e, False),
        watch_intentionally(e, 60),
        simulate_ticks(e, 10, 'Learn something'),
        assert_check('alignment drops significantly', e['intentAlignmentScore'] < 70, 'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Relax: multiple recommendations are tolerated', lambda e: (
        e['currentSession'].update({'originalIntention': 'Relax / Be entertained'}),
        click_recommendation(e, False),
        click_recommendation(e, False),
        click_recommendation(e, False),
        click_recommendation(e, False),
        watch_intentionally(e, 60),
        simulate_ticks(e, 10, 'Relax / Be entertained'),
        assert_check('alignment remains tolerable', e['intentAlignmentScore'] >= 75, 'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Passive Consumption state suppresses engagement bonuses', lambda e: (
        e['currentSession'].update({'originalIntention': 'Find a specific video'}),
        search(e),
        click_recommendation(e, False),
        set_state(e, BEHAVIORAL_STATES['PASSIVE_CONSUMPTION']),
        watch_intentionally(e, 180),
        simulate_ticks(e, 10, 'Find a specific video'),
        assert_check('alignment does not fully recover from passive state', e['intentAlignmentScore'] < 95,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Recommendation Loop state suppresses sustained viewing bonuses', lambda e: (
        e['currentSession'].update({'originalIntention': 'Learn something'}),
        search(e),
        click_recommendation(e, False),
        set_state(e, BEHAVIORAL_STATES['RECOMMENDATION_LOOP']),
        watch_intentionally(e, 180),
        simulate_ticks(e, 10, 'Learn something'),
        assert_check('alignment is suppressed in rec loop state', e['intentAlignmentScore'] < 90,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Manual navigation clears autoplay provenance', lambda e: (
        e['currentSession'].update({'originalIntention': 'Find a specific video'}),
        autoplay(e),
        manual_navigation(e, 'https://www.youtube.com/watch?v=manual'),
        watch_intentionally(e, 120),
        simulate_ticks(e, 10, 'Find a specific video'),
        assert_check('autoplay flag cleared', not e['behavioralMetrics']['isCurrentVideoAutoplay'],
                     'autoplay=' + str(e['behavioralMetrics']['isCurrentVideoAutoplay'])),
        assert_check('alignment improves after manual navigation but respects autoplay cap', e['intentAlignmentScore'] >= 80,
                     'score=' + str(e['intentAlignmentScore']))
    ))

    run_scenario('Confidence scores evolve with behavior', lambda e: (
        e['currentSession'].update({'originalIntention': 'Learn something'}),
        e.update({'_before_search': e['stateConfidence']['Goal-Oriented Search']}),
        search(e),
        e.update({'_after_search': e['stateConfidence']['Goal-Oriented Search']}),
        click_recommendation(e, False),
        e.update({'_after_rec': e['stateConfidence']['Recommendation Loop']}),
        autoplay(e),
        e.update({'_after_autoplay': e['stateConfidence']['Passive Consumption']}),
        assert_check('search increases goal confidence', e['_after_search'] > e['_before_search'],
                     'before=' + str(e['_before_search']) + ' after=' + str(e['_after_search'])),
        assert_check('recommendation increases rec-loop confidence', e['_after_rec'] > 20,
                     'recLoop=' + str(e['_after_rec'])),
        assert_check('autoplay increases passive confidence', e['_after_autoplay'] > 20,
                     'passive=' + str(e['_after_autoplay']))
    ))

    run_scenario('Drift memory decays slowly but does not vanish immediately', lambda e: (
        e['currentSession'].update({'originalIntention': 'Find a specific video'}),
        homepage_scroll(e, 8),
        simulate_ticks(e, 1, 'Find a specific video'),
        e.update({'_drift_initial': e['driftMemory']}),
        e['behavioralMetrics'].update({'homepageScrollStreak': 0}),
        simulate_ticks(e, 10, 'Find a specific video'),
        e.update({'_drift_later': e['driftMemory']}),
        assert_check('driftMemory is positive after scroll', e['_drift_initial'] > 0,
                     'initial=' + str(e['_drift_initial'])),
        assert_check('driftMemory decays over time', e['_drift_later'] < e['_drift_initial'],
                     'initial=' + str(e['_drift_initial']) + ' later=' + str(e['_drift_later'])),
        assert_check('driftMemory still present after decay', e['_drift_later'] > 0,
                     'later=' + str(e['_drift_later']))
    ))

    run_scenario('Autoplay cap is not raised by later intentional behavior', lambda e: (
        e['currentSession'].update({'originalIntention': 'Relax / Be entertained'}),
        autoplay(e),
        e.update({'_cap_after_autoplay': e['autoplayCap']}),
        search(e),
        watch_intentionally(e, 300),
        simulate_ticks(e, 10, 'Relax / Be entertained'),
        assert_check('autoplay cap remains at tier', e['autoplayCap'] == e['_cap_after_autoplay'],
                     'cap=' + str(e['autoplayCap']) + ' expected=' + str(e['_cap_after_autoplay'])),
        assert_check('alignment remains capped', e['intentAlignmentScore'] <= e['autoplayCap'],
                     'score=' + str(e['intentAlignmentScore']) + ' cap=' + str(e['autoplayCap']))
    ))

    run_scenario('Intent change immediately updates alignment calculation', lambda e: (
        e['currentSession'].update({'originalIntention': 'Find a specific video'}),
        search(e),
        click_recommendation(e, False),
        watch_intentionally(e, 120),
        simulate_ticks(e, 10, 'Find a specific video'),
        e.update({'_as_find': e['intentAlignmentScore']}),
        change_intention(e, 'Relax / Be entertained'),
        simulate_ticks(e, 1, 'Relax / Be entertained'),
        e.update({'_as_relax': e['intentAlignmentScore']}),
        assert_check('session intent is updated', e['currentSession']['originalIntention'] == 'Relax / Be entertained',
                     'intent=' + e['currentSession']['originalIntention']),
        assert_check('alignment changes after intent change', e['_as_relax'] > e['_as_find'] + 10,
                     'find=' + str(e['_as_find']) + ' relax=' + str(e['_as_relax'])),
        change_intention(e, 'Find a specific video'),
        simulate_ticks(e, 1, 'Find a specific video'),
        assert_check('alignment returns to stricter Find calculation', e['intentAlignmentScore'] < e['_as_relax'] - 5,
                     'find=' + str(e['intentAlignmentScore']) + ' relax=' + str(e['_as_relax']))
    ))

    print('\n==================================================================')
    print('Passed: ' + str(passed) + ' / ' + str(passed + failed))
    if failed > 0:
        print('Failures:')
        for f in failures:
            print('  - ' + f)
        exit(1)
    else:
        print('All checks passed.')
        exit(0)


if __name__ == '__main__':
    run_all_tests()
