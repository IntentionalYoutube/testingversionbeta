// ============================================================
// Standalone verification for Intent Alignment Engine
// ============================================================
// This script is completely isolated from the extension. It copies the
// current calculateIntentAlignment logic into a test harness and exercises
// representative scenarios. It does not modify content.js, is not loaded by
// the extension, and has zero impact on runtime behavior.
//
// Run with: node tests/verify-alignment.js
// ============================================================

'use strict';

const BEHAVIORAL_STATES = {
  GOAL_ORIENTED_SEARCH: 'Goal-Oriented Search',
  SUSTAINED_ENGAGEMENT: 'Sustained Engagement',
  CASUAL_EXPLORATION: 'Casual Exploration',
  RECOMMENDATION_LOOP: 'Recommendation Loop',
  PASSIVE_CONSUMPTION: 'Passive Consumption'
};

const DRIFT_MEMORY_MAX = 50;
const DECAY_RATE = 0.97;
const PENALTY_DECAY = 0.90;

function createEngine() {
  return {
    currentSession: { originalIntention: 'Find a specific video', startTime: Date.now() },
    currentState: BEHAVIORAL_STATES.CASUAL_EXPLORATION,
    stateConfidence: {
      'Goal-Oriented Search': 20,
      'Sustained Engagement': 20,
      'Casual Exploration': 20,
      'Recommendation Loop': 20,
      'Passive Consumption': 20
    },
    behavioralMetrics: {
      searchEvents: 0,
      homepageVisits: 0,
      homepageScrollEvents: 0,
      homepageScrollStreak: 0,
      lastIntentionalInteractionTime: 0,
      recommendationClicks: 0,
      autoplayTransitions: 0,
      autoplayCount: 0,
      videoSwitches: 0,
      scrollEvents: 0,
      timeSinceLastSearch: 0,
      consecutiveRecommendations: 0,
      videoWatchDurations: [],
      lastSearchTime: 0,
      sustainedViewingTime: 0,
      intentionalSustainedViewingTime: 0,
      isCurrentVideoAutoplay: false,
      isCurrentVideoFromRecommendation: false,
      lastVideoChangeWasManual: false,
      rapidSwitchCount: 0,
      lastVideoSwitchTime: 0
    },
    intentAlignmentScore: 100,
    driftMemory: 0,
    autoplayCap: 100,
    driftEvents: [],
    locationHref: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    videoPlaying: true,

    // Mock helpers
    isHomepage() {
      return this.locationHref === 'https://www.youtube.com/' ||
             this.locationHref === 'https://www.youtube.com' ||
             this.locationHref === 'https://www.youtube.com/home' ||
             this.locationHref.includes('youtube.com/feed');
    },
    documentQuerySelector() {
      return { paused: !this.videoPlaying, currentTime: this.videoPlaying ? 5 : 0 };
    },
    isAdPlaying() { return false; },
    safeSendMessage() {},
    generateDriftReason() { return 'test-drift'; }
  };
}

function calculateIntentAlignment(engine) {
  if (!engine.currentSession) { engine.intentAlignmentScore = 100; return; }
  const intention = engine.currentSession.originalIntention || engine.currentSession.intention;

  // State confidences
  var recLoopConf = Math.max(0, engine.stateConfidence[BEHAVIORAL_STATES.RECOMMENDATION_LOOP] - 20);
  var passiveConf = Math.max(0, engine.stateConfidence[BEHAVIORAL_STATES.PASSIVE_CONSUMPTION] - 20);
  var goalConf = engine.stateConfidence[BEHAVIORAL_STATES.GOAL_ORIENTED_SEARCH];
  var engageConf = engine.stateConfidence[BEHAVIORAL_STATES.SUSTAINED_ENGAGEMENT];
  var casualConf = engine.stateConfidence[BEHAVIORAL_STATES.CASUAL_EXPLORATION];

  var intentWeights = {
    'Find a specific video': { recLoop: 1.0, autoplay: 1.0, rapidSwitch: 1.0, passive: 1.0, homepageScroll: 1.0 },
    'Learn something':       { recLoop: 0.9, autoplay: 0.9, rapidSwitch: 0.85, passive: 0.85, homepageScroll: 0.7 },
    'Relax / Be entertained':{ recLoop: 0.45, autoplay: 0.45, rapidSwitch: 0.5, passive: 0.35, homepageScroll: 0.25 },
    'Explore a topic':       { recLoop: 0.45, autoplay: 0.50, rapidSwitch: 0.6, passive: 0.65, homepageScroll: 0.75 }
  };
  var w = intentWeights[intention] || intentWeights['Explore a topic'];

  var penalty = 0;
  var recCapForIntent = intention === 'Find a specific video' ? 30 : 50;
  var recStepForIntent = intention === 'Relax / Be entertained' ? 10 : (intention === 'Learn something' ? 14 : (intention === 'Find a specific video' ? 18 : 12));
  penalty += Math.min(recCapForIntent, engine.behavioralMetrics.consecutiveRecommendations * recStepForIntent) * w.recLoop;
  penalty += Math.min(20, engine.behavioralMetrics.autoplayTransitions * 10) * w.autoplay;
  penalty += Math.min(30, engine.behavioralMetrics.rapidSwitchCount * 8) * w.rapidSwitch;
  penalty += (recLoopConf / 80) * 35 * w.recLoop;
  penalty += (passiveConf / 80) * 30 * w.passive;

  var onHomepage = engine.isHomepage();
  var onVideoPage = engine.locationHref.includes('/watch') || engine.locationHref.includes('/shorts/');
  var scrollStreak = engine.behavioralMetrics.homepageScrollStreak;
  var noRecentSearch = engine.behavioralMetrics.searchEvents === 0 || engine.behavioralMetrics.timeSinceLastSearch > 120000;
  var idleMs = engine.behavioralMetrics.lastIntentionalInteractionTime > 0 ? Date.now() - engine.behavioralMetrics.lastIntentionalInteractionTime : (engine.currentSession.startTime ? Date.now() - engine.currentSession.startTime : 0);
  var prolongedIdle = idleMs > 20000;
  var idleMinutes = idleMs / 60000;
  var vid = engine.documentQuerySelector();
  var videoIsPlaying = !!(vid && !vid.paused && vid.currentTime > 0 && !engine.isAdPlaying());
  var idleMinutesForVideoPage = videoIsPlaying ? 0 : idleMinutes;
  var homepageDrift = 0;

  if (intention === 'Find a specific video') {
    if (onHomepage || onVideoPage) homepageDrift += scrollStreak * 8;
    if (onHomepage && noRecentSearch) {
      homepageDrift += idleMinutes * 36;
    } else if (onVideoPage && noRecentSearch) {
      homepageDrift += idleMinutesForVideoPage * 36;
    }
  } else if (intention === 'Learn something') {
    if (onHomepage || onVideoPage) homepageDrift += scrollStreak * 6;
    if (onHomepage && noRecentSearch && prolongedIdle) {
      homepageDrift += idleMinutes * 34;
    } else if (onVideoPage && noRecentSearch && prolongedIdle) {
      homepageDrift += idleMinutesForVideoPage * 34;
    }
  } else if (intention === 'Relax / Be entertained') {
    if (onHomepage || onVideoPage) homepageDrift += scrollStreak * 4;
    if (onHomepage) {
      homepageDrift += idleMinutes * 27;
    } else if (onVideoPage) {
      homepageDrift += idleMinutesForVideoPage * 27;
    }
  } else if (intention === 'Explore a topic') {
    if (onHomepage || onVideoPage) homepageDrift += scrollStreak * 5;
    if (onHomepage) {
      homepageDrift += idleMinutes * 15;
    } else if (onVideoPage) {
      homepageDrift += idleMinutesForVideoPage * 15;
    }
  }

  penalty += homepageDrift * Math.max(0, w.homepageScroll);

  var recLoopPenaltyThisCycle = Math.min(recCapForIntent, engine.behavioralMetrics.consecutiveRecommendations * recStepForIntent) * w.recLoop;
  var driftThisCycle = (homepageDrift * Math.max(0, w.homepageScroll)) + recLoopPenaltyThisCycle;
  engine.driftMemory = Math.max(0, engine.driftMemory * 0.95);
  engine.driftMemory = Math.min(DRIFT_MEMORY_MAX, engine.driftMemory + driftThisCycle * 0.12);
  penalty += engine.driftMemory;

  var homepageIdling = onHomepage && prolongedIdle;
  var isPassiveState = engine.currentState === BEHAVIORAL_STATES.PASSIVE_CONSUMPTION || engine.currentState === BEHAVIORAL_STATES.RECOMMENDATION_LOOP;
  var bonus = 0;
  if (intention === 'Find a specific video') {
    var findOnTask = !engine.behavioralMetrics.isCurrentVideoAutoplay &&
                     !engine.behavioralMetrics.isCurrentVideoFromRecommendation &&
                     engine.behavioralMetrics.consecutiveRecommendations < 1 &&
                     engine.behavioralMetrics.searchEvents > 0;
    var findOffTask = onVideoPage && !findOnTask && !engine.behavioralMetrics.isCurrentVideoAutoplay &&
                      !engine.behavioralMetrics.isCurrentVideoFromRecommendation &&
                      engine.behavioralMetrics.consecutiveRecommendations < 1 &&
                      !engine.behavioralMetrics.lastVideoChangeWasManual;
    if (findOffTask && !isPassiveState) penalty += 8;
    if (!homepageIdling && !isPassiveState && findOnTask) bonus += (goalConf / 100) * 35;
    if (!homepageIdling && !isPassiveState && findOnTask) bonus += (engageConf / 100) * 15;
    if (!homepageIdling && findOnTask && engine.behavioralMetrics.timeSinceLastSearch < 120000) bonus += 20;
  } else if (intention === 'Learn something') {
    var learnContext = !engine.behavioralMetrics.isCurrentVideoAutoplay && engine.behavioralMetrics.consecutiveRecommendations < 1;
    if (!homepageIdling && !isPassiveState) bonus += (goalConf / 100) * 20;
    if (!homepageIdling && !isPassiveState && learnContext) bonus += (engageConf / 100) * 35;
    if (!homepageIdling && !isPassiveState && learnContext && engine.behavioralMetrics.intentionalSustainedViewingTime > 30000) {
      bonus += Math.min(30, (engine.behavioralMetrics.intentionalSustainedViewingTime / 60000) * 22);
    }
    if (!homepageIdling && engine.behavioralMetrics.searchEvents > 0 && engine.behavioralMetrics.timeSinceLastSearch < 600000) bonus += 10;
  } else if (intention === 'Relax / Be entertained') {
    var relaxContext = !engine.behavioralMetrics.isCurrentVideoAutoplay;
    if (!homepageIdling && relaxContext) bonus += (casualConf / 100) * 30;
    if (!homepageIdling && !isPassiveState && relaxContext) bonus += (engageConf / 100) * 25;
    if (!homepageIdling && !isPassiveState && relaxContext && engine.behavioralMetrics.intentionalSustainedViewingTime > 30000) {
      bonus += Math.min(20, (engine.behavioralMetrics.intentionalSustainedViewingTime / 60000) * 16);
    }
  } else if (intention === 'Explore a topic') {
    var suppressHomepageBonus = onHomepage && noRecentSearch;
    var exploreContext = !engine.behavioralMetrics.isCurrentVideoAutoplay && (engine.behavioralMetrics.consecutiveRecommendations > 0 || engine.behavioralMetrics.searchEvents > 0);
    if (!suppressHomepageBonus) bonus += (casualConf / 100) * 22;
    if (!suppressHomepageBonus && !isPassiveState && exploreContext) bonus += (engageConf / 100) * 18;
    if (!suppressHomepageBonus && !isPassiveState) bonus += (goalConf / 100) * 10;
    if (!suppressHomepageBonus && !isPassiveState && exploreContext && engine.behavioralMetrics.intentionalSustainedViewingTime > 30000) {
      bonus += Math.min(15, (engine.behavioralMetrics.intentionalSustainedViewingTime / 60000) * 12);
    }
    var exploreRecBonus = Math.min(3, engine.behavioralMetrics.consecutiveRecommendations);
    if (!isPassiveState && exploreRecBonus > 0) bonus += exploreRecBonus * 8;
    if (!suppressHomepageBonus && engine.behavioralMetrics.searchEvents > 0 && engine.behavioralMetrics.timeSinceLastSearch < 300000) bonus += 8;
  }

  bonus = Math.min(40, bonus);

  var alignment = Math.max(0, Math.min(100, Math.round(100 - penalty + bonus)));
  alignment = Math.min(alignment, engine.autoplayCap);
  var diff = alignment - engine.intentAlignmentScore;
  if (Math.abs(diff) > 15) {
    engine.intentAlignmentScore += Math.sign(diff) * 15;
  } else {
    engine.intentAlignmentScore = alignment;
  }
}

// ============================================================
// Scenario helpers
// ============================================================

function applyScoreDecay(engine) {
  for (const state in engine.stateConfidence) {
    engine.stateConfidence[state] = Math.max(0, engine.stateConfidence[state] * DECAY_RATE);
  }
  const bm = engine.behavioralMetrics;
  if (!bm.isCurrentVideoFromRecommendation) {
    bm.consecutiveRecommendations *= PENALTY_DECAY;
  }
  bm.rapidSwitchCount *= PENALTY_DECAY;
  bm.autoplayTransitions *= PENALTY_DECAY;
  bm.homepageScrollStreak *= PENALTY_DECAY;
  if (bm.consecutiveRecommendations < 0.1) bm.consecutiveRecommendations = 0;
  if (bm.rapidSwitchCount < 0.1) bm.rapidSwitchCount = 0;
  if (bm.autoplayTransitions < 0.1) bm.autoplayTransitions = 0;
  if (bm.homepageScrollStreak < 0.1) bm.homepageScrollStreak = 0;
}

function simulateTicks(engine, n, intention) {
  engine.currentSession.originalIntention = intention;
  for (let i = 0; i < n; i++) {
    calculateIntentAlignment(engine);
  }
}

function simulateTicksWithDecay(engine, n, intention) {
  engine.currentSession.originalIntention = intention;
  for (let i = 0; i < n; i++) {
    applyScoreDecay(engine);
    calculateIntentAlignment(engine);
  }
}

function search(engine) {
  engine.behavioralMetrics.searchEvents++;
  engine.behavioralMetrics.lastSearchTime = Date.now();
  engine.behavioralMetrics.timeSinceLastSearch = 0;
  engine.behavioralMetrics.consecutiveRecommendations = 0;
  engine.behavioralMetrics.homepageScrollStreak = 0;
  engine.behavioralMetrics.lastIntentionalInteractionTime = Date.now();
  engine.behavioralMetrics.isCurrentVideoAutoplay = false;
  engine.behavioralMetrics.isCurrentVideoFromRecommendation = false;
  engine.behavioralMetrics.lastVideoChangeWasManual = true;
  engine.stateConfidence['Goal-Oriented Search'] = Math.min(100, engine.stateConfidence['Goal-Oriented Search'] + 25);
}

function watchIntentionally(engine, seconds) {
  engine.behavioralMetrics.intentionalSustainedViewingTime += seconds * 1000;
  engine.behavioralMetrics.sustainedViewingTime += seconds * 1000;
  engine.stateConfidence['Sustained Engagement'] = Math.min(100, engine.stateConfidence['Sustained Engagement'] + seconds * 0.8);
  engine.behavioralMetrics.lastIntentionalInteractionTime = Date.now();
}

function clickRecommendation(engine, passive) {
  engine.behavioralMetrics.recommendationClicks++;
  engine.behavioralMetrics.consecutiveRecommendations++;
  engine.behavioralMetrics.homepageScrollStreak = 0;
  if (passive) {
    engine.behavioralMetrics.isCurrentVideoAutoplay = true;
    engine.behavioralMetrics.isCurrentVideoFromRecommendation = false;
    engine.behavioralMetrics.lastVideoChangeWasManual = false;
  } else {
    engine.behavioralMetrics.lastIntentionalInteractionTime = Date.now();
    engine.behavioralMetrics.isCurrentVideoAutoplay = false;
    engine.behavioralMetrics.isCurrentVideoFromRecommendation = true;
    engine.behavioralMetrics.lastVideoChangeWasManual = true;
  }
  engine.stateConfidence['Recommendation Loop'] = Math.min(100, engine.stateConfidence['Recommendation Loop'] + 15);
}

function autoplay(engine) {
  engine.behavioralMetrics.autoplayTransitions++;
  engine.behavioralMetrics.autoplayCount++;
  engine.behavioralMetrics.consecutiveRecommendations++;
  engine.behavioralMetrics.isCurrentVideoAutoplay = true;
  engine.behavioralMetrics.isCurrentVideoFromRecommendation = false;
  var newCap = engine.behavioralMetrics.autoplayCount === 1 ? 85 : engine.behavioralMetrics.autoplayCount === 2 ? 70 : 55;
  engine.autoplayCap = Math.min(engine.autoplayCap, newCap);
  engine.stateConfidence['Passive Consumption'] = Math.min(100, engine.stateConfidence['Passive Consumption'] + 20);
}

function homepageScroll(engine, count) {
  engine.locationHref = 'https://www.youtube.com/';
  engine.behavioralMetrics.scrollEvents += count;
  engine.behavioralMetrics.homepageScrollEvents += count;
  engine.behavioralMetrics.homepageScrollStreak += count;
  engine.behavioralMetrics.lastIntentionalInteractionTime = Date.now();
  engine.stateConfidence['Casual Exploration'] = Math.min(100, engine.stateConfidence['Casual Exploration'] + count * 3);
}

function manualNavigation(engine, url) {
  engine.locationHref = url;
  engine.behavioralMetrics.lastIntentionalInteractionTime = Date.now();
  engine.behavioralMetrics.isCurrentVideoAutoplay = false;
  engine.behavioralMetrics.isCurrentVideoFromRecommendation = false;
  engine.behavioralMetrics.lastVideoChangeWasManual = true;
  engine.behavioralMetrics.consecutiveRecommendations = 0;
}

function changeIntention(engine, intention) {
  engine.currentSession.intention = intention;
  engine.currentSession.originalIntention = intention;
}

// ============================================================
// Test runner
// ============================================================

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, condition, details) {
  if (condition) {
    passed++;
    console.log('  PASS: ' + name);
  } else {
    failed++;
    failures.push(name + ' — ' + details);
    console.log('  FAIL: ' + name + ' — ' + details);
  }
}

function runScenario(name, fn) {
  console.log('\n' + name);
  const engine = createEngine();
  fn(engine, name);
}

console.log('Intentional YouTube — Alignment Engine Verification');
console.log('====================================================');

// 1. Find: search + watch searched video
runScenario('Find: search then watch searched video', (engine) => {
  engine.currentSession.originalIntention = 'Find a specific video';
  search(engine);
  watchIntentionally(engine, 120);
  simulateTicks(engine, 10, 'Find a specific video');
  assert('alignment should be high', engine.intentAlignmentScore >= 95, 'score=' + engine.intentAlignmentScore);
  assert('findOnTask should hold', !engine.behavioralMetrics.isCurrentVideoFromRecommendation, 'fromRec=' + engine.behavioralMetrics.isCurrentVideoFromRecommendation);
});

// 2. Find: search + recommendation + long watch should NOT recover to 100
runScenario('Find: search, recommendation, long watch does not fully recover', (engine) => {
  engine.currentSession.originalIntention = 'Find a specific video';
  search(engine);
  clickRecommendation(engine, false);
  watchIntentionally(engine, 300);
  simulateTicks(engine, 20, 'Find a specific video');
  assert('alignment should not reach 100', engine.intentAlignmentScore < 100, 'score=' + engine.intentAlignmentScore);
  assert('alignment should reflect a meaningful, lasting rec penalty', engine.intentAlignmentScore < 75, 'score=' + engine.intentAlignmentScore);
  assert('provenance flag should persist', engine.behavioralMetrics.isCurrentVideoFromRecommendation, 'fromRec=' + engine.behavioralMetrics.isCurrentVideoFromRecommendation);
  assert('driftMemory should be positive', engine.driftMemory > 0, 'driftMemory=' + engine.driftMemory);
});

// 2b. Find: rec drift should not be erased by sustained viewing
runScenario('Find: recommendation drift persists during sustained viewing', (engine) => {
  engine.currentSession.originalIntention = 'Find a specific video';
  search(engine);
  clickRecommendation(engine, false);
  watchIntentionally(engine, 300);
  const afterRec = engine.intentAlignmentScore;
  simulateTicksWithDecay(engine, 60, 'Find a specific video');
  assert('consecutiveRecommendations should not decay to 0', engine.behavioralMetrics.consecutiveRecommendations >= 1, 'consecutiveRecommendations=' + engine.behavioralMetrics.consecutiveRecommendations);
  assert('alignment should not recover toward pre-rec level', engine.intentAlignmentScore <= afterRec + 5, 'afterRec=' + afterRec + ' final=' + engine.intentAlignmentScore);
  assert('driftMemory should remain substantial', engine.driftMemory >= 20, 'driftMemory=' + engine.driftMemory);
});

// 2c. Find: rec chain should resume decay after manual navigation
runScenario('Find: recommendation chain resumes decay after manual navigation', (engine) => {
  engine.currentSession.originalIntention = 'Find a specific video';
  search(engine);
  clickRecommendation(engine, false);
  watchIntentionally(engine, 60);
  manualNavigation(engine, 'https://www.youtube.com/watch?v=manual123');
  watchIntentionally(engine, 120);
  simulateTicksWithDecay(engine, 40, 'Find a specific video');
  assert('consecutiveRecommendations should decay after leaving rec video', engine.behavioralMetrics.consecutiveRecommendations < 1, 'consecutiveRecommendations=' + engine.behavioralMetrics.consecutiveRecommendations);
  assert('isCurrentVideoFromRecommendation should be cleared', !engine.behavioralMetrics.isCurrentVideoFromRecommendation, 'fromRec=' + engine.behavioralMetrics.isCurrentVideoFromRecommendation);
});

// 3. Learn: focused learning stays high
runScenario('Learn: focused learning session stays high', (engine) => {
  engine.currentSession.originalIntention = 'Learn something';
  search(engine);
  watchIntentionally(engine, 180);
  simulateTicks(engine, 10, 'Learn something');
  assert('alignment should be high', engine.intentAlignmentScore >= 95, 'score=' + engine.intentAlignmentScore);
});

// 4. Learn: single recommendation causes a small drop
runScenario('Learn: single recommendation causes small drift', (engine) => {
  engine.currentSession.originalIntention = 'Learn something';
  search(engine);
  watchIntentionally(engine, 120);
  simulateTicks(engine, 5, 'Learn something');
  const before = engine.intentAlignmentScore;
  clickRecommendation(engine, false);
  watchIntentionally(engine, 60);
  simulateTicks(engine, 10, 'Learn something');
  assert('alignment should drop after one rec', engine.intentAlignmentScore < before, 'before=' + before + ' after=' + engine.intentAlignmentScore);
  assert('drop should be small/moderate, not catastrophic', engine.intentAlignmentScore >= 70, 'score=' + engine.intentAlignmentScore);
});

// 5. Learn: two recommendations cause a larger drop
runScenario('Learn: two recommendations cause larger drift', (engine) => {
  engine.currentSession.originalIntention = 'Learn something';
  search(engine);
  clickRecommendation(engine, false);
  clickRecommendation(engine, false);
  watchIntentionally(engine, 60);
  simulateTicks(engine, 10, 'Learn something');
  assert('alignment should be significantly lower', engine.intentAlignmentScore < 90, 'score=' + engine.intentAlignmentScore);
});

// 6. Explore: recommendation chain is rewarded
runScenario('Explore: manual recommendation chain is rewarded', (engine) => {
  engine.currentSession.originalIntention = 'Explore a topic';
  search(engine);
  clickRecommendation(engine, false);
  clickRecommendation(engine, false);
  watchIntentionally(engine, 90);
  simulateTicks(engine, 10, 'Explore a topic');
  assert('alignment should be high for active exploration', engine.intentAlignmentScore >= 90, 'score=' + engine.intentAlignmentScore);
});

// 7. Relax: manual choice is rewarded
runScenario('Relax: manual video choice stays high', (engine) => {
  engine.currentSession.originalIntention = 'Relax / Be entertained';
  engine.behavioralMetrics.lastIntentionalInteractionTime = Date.now();
  watchIntentionally(engine, 120);
  simulateTicks(engine, 10, 'Relax / Be entertained');
  assert('alignment should be high', engine.intentAlignmentScore >= 95, 'score=' + engine.intentAlignmentScore);
});

// 8. Relax: autoplay drops alignment
runScenario('Relax: autoplay reduces alignment', (engine) => {
  engine.currentSession.originalIntention = 'Relax / Be entertained';
  engine.behavioralMetrics.lastIntentionalInteractionTime = Date.now();
  watchIntentionally(engine, 60);
  autoplay(engine);
  watchIntentionally(engine, 60); // intentionalSustainedViewingTime should not grow, but mimic passive watch
  simulateTicks(engine, 10, 'Relax / Be entertained');
  assert('alignment should drop after autoplay', engine.intentAlignmentScore < 100, 'score=' + engine.intentAlignmentScore);
  assert('autoplayCap should be reduced', engine.autoplayCap < 100, 'cap=' + engine.autoplayCap);
});

// 9. Drift memory persists
runScenario('Drift memory persists after homepage browsing', (engine) => {
  engine.currentSession.originalIntention = 'Find a specific video';
  homepageScroll(engine, 8);
  simulateTicks(engine, 5, 'Find a specific video');
  const driftAfterScroll = engine.driftMemory;
  engine.behavioralMetrics.homepageScrollStreak = 0;
  engine.behavioralMetrics.isCurrentVideoFromRecommendation = true;
  engine.locationHref = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  watchIntentionally(engine, 120);
  simulateTicks(engine, 10, 'Find a specific video');
  assert('driftMemory should still be positive', engine.driftMemory > 0, 'driftMemory=' + engine.driftMemory);
  assert('alignment should not fully recover', engine.intentAlignmentScore < 100, 'score=' + engine.intentAlignmentScore);
});

// 10. Autoplay cap limits recovery
runScenario('Autoplay cap limits alignment ceiling', (engine) => {
  engine.currentSession.originalIntention = 'Relax / Be entertained';
  autoplay(engine);
  autoplay(engine);
  autoplay(engine);
  watchIntentionally(engine, 300);
  simulateTicks(engine, 20, 'Relax / Be entertained');
  assert('alignment should not exceed autoplayCap', engine.intentAlignmentScore <= engine.autoplayCap, 'score=' + engine.intentAlignmentScore + ' cap=' + engine.autoplayCap);
});

runScenario('Intent change immediately updates alignment calculation', (engine) => {
  engine.currentSession.originalIntention = 'Find a specific video';
  search(engine);
  clickRecommendation(engine, false);
  watchIntentionally(engine, 120);
  simulateTicks(engine, 10, 'Find a specific video');
  const asFind = engine.intentAlignmentScore;
  changeIntention(engine, 'Relax / Be entertained');
  simulateTicks(engine, 1, 'Relax / Be entertained');
  const asRelax = engine.intentAlignmentScore;
  assert('session intent is updated', engine.currentSession.originalIntention === 'Relax / Be entertained', 'intent=' + engine.currentSession.originalIntention);
  assert('alignment changes after intent change', asRelax > asFind + 10, 'find=' + asFind + ' relax=' + asRelax);
  changeIntention(engine, 'Find a specific video');
  simulateTicks(engine, 1, 'Find a specific video');
  assert('alignment returns to stricter Find calculation', engine.intentAlignmentScore < asRelax - 5, 'find=' + engine.intentAlignmentScore + ' relax=' + asRelax);
});

console.log('\n====================================================');
console.log('Passed: ' + passed + ' / ' + (passed + failed));
if (failed > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
} else {
  console.log('All checks passed.');
  process.exit(0);
}
