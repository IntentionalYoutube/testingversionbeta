// Content script for Intentional YouTube
// Handles YouTube page detection, behavioral state engine, reflections, and interface modifications

// ============================================================
// CONSTANTS & CONFIGURATION
// ============================================================

const DEBUG_MODE = true;

const BEHAVIORAL_STATES = {
  GOAL_ORIENTED_SEARCH: 'Goal-Oriented Search',
  SUSTAINED_ENGAGEMENT: 'Sustained Engagement',
  CASUAL_EXPLORATION: 'Casual Exploration',
  RECOMMENDATION_LOOP: 'Recommendation Loop',
  PASSIVE_CONSUMPTION: 'Passive Consumption'
};

const WEIGHTS = {
  search:              { 'Goal-Oriented Search': 30, 'Sustained Engagement': 5,  'Casual Exploration': -5,  'Recommendation Loop': -20, 'Passive Consumption': -20 },
  sustainedViewing:    { 'Goal-Oriented Search': 0,  'Sustained Engagement': 25, 'Casual Exploration': 0,   'Recommendation Loop': -10, 'Passive Consumption': -5  },
  sustainedViewingPassive: { 'Goal-Oriented Search': 0, 'Sustained Engagement': -10, 'Casual Exploration': 0, 'Recommendation Loop': 8, 'Passive Consumption': 20 },
  recommendationClick: { 'Goal-Oriented Search': -10,'Sustained Engagement': -10,'Casual Exploration': 8,   'Recommendation Loop': 25,  'Passive Consumption': 5   },
  autoplay:            { 'Goal-Oriented Search': -15,'Sustained Engagement': -15,'Casual Exploration': 3,   'Recommendation Loop': 20,  'Passive Consumption': 25  },
  homepageVisit:       { 'Goal-Oriented Search': -5, 'Sustained Engagement': -10,'Casual Exploration': 20,  'Recommendation Loop': 0,   'Passive Consumption': -5  },
  rapidSwitch:         { 'Goal-Oriented Search': -5, 'Sustained Engagement': -20,'Casual Exploration': 8,   'Recommendation Loop': 20,  'Passive Consumption': 5   },
  scroll:              { 'Goal-Oriented Search': -2, 'Sustained Engagement': -2, 'Casual Exploration': 8,   'Recommendation Loop': 3,   'Passive Consumption': 2   }
};

const DECAY_RATE = 0.97;
const DECAY_INTERVAL_MS = 5000;
const MIN_TRANSITION_CYCLES = 2;
const STATE_DOMINANCE_THRESHOLD = 10;
const REFLECTION_COOLDOWN_MS = 120000;
const MINIMUM_REFLECTION_TIME = 5000;

const REFLECTION_STATES = {
  IDLE: 'idle',
  COUNTDOWN: 'countdown',
  REFLECTION_LOCKED: 'reflection_locked',
  REFLECTION_ACTIVE: 'reflection_active',
  SELECTION_FINALIZED: 'selection_finalized'
};

// ============================================================
// STATE VARIABLES
// ============================================================

let currentSession = null;
let settings = {};
let interventionTimer = null;
let currentInterventionInterval = null;
let checkpointCount = 0;
let hasShownCheckpoint = false;
let pageLoadTime = Date.now();
let isInitialPageLoad = true;

// Behavioral State Engine
let currentState = BEHAVIORAL_STATES.CASUAL_EXPLORATION;
let stateConfidence = {
  'Goal-Oriented Search': 20,
  'Sustained Engagement': 20,
  'Casual Exploration': 20,
  'Recommendation Loop': 20,
  'Passive Consumption': 20
};
let dominantStateHistory = [];
let stateTransitionCooldown = 0;
let behavioralStateHistory = [];

// Intent Alignment
let intentAlignmentScore = 100;
let driftEvents = [];

// Behavioral Metrics
let behavioralMetrics = {
  searchEvents: 0, homepageVisits: 0, homepageScrollEvents: 0, homepageScrollStreak: 0,
  lastIntentionalInteractionTime: 0, recommendationClicks: 0, autoplayTransitions: 0, autoplayCount: 0,
  videoSwitches: 0, scrollEvents: 0, timeSinceLastSearch: 0, consecutiveRecommendations: 0,
  videoWatchDurations: [], lastSearchTime: 0, sustainedViewingTime: 0,
  intentionalSustainedViewingTime: 0, isCurrentVideoAutoplay: false, isCurrentVideoFromRecommendation: false,
  lastVideoChangeWasManual: false, rapidSwitchCount: 0, lastVideoSwitchTime: 0
};

// Autoplay alignment cap: tracks the current ceiling imposed by autoplay history.
// Cap lifts gradually as intentional viewing accumulates.
let autoplayCap = 100;
const AUTOPLAY_CAP_RECOVERY_PER_TICK = 0.5; // points recovered per 5s tick of intentional viewing

// Drift memory: persistent record of intent-inconsistent behavior (homepage browsing,
// recommendation chains). It decays slowly and cannot be fully erased by later sustained viewing.
let driftMemory = 0;
const DRIFT_MEMORY_MAX = 50;

// Pathway, Fork Points, Recovery
let sessionPathway = [];
let forkPoints = [];
let recoveryEvents = [];
let lastForkPoint = null;
let lastRecoveryEvent = null;

// Reflection state machine
let reflectionState = REFLECTION_STATES.IDLE;
let reflectionLocked = false;
let reflectionOverlay = null;
let reflectionLockTimer = null;
let lastReflectionTime = 0;

// Video playback state
let videoWasPlaying = false;
let originalVideoTime = 0;

// Decay timer
let decayTimerId = null;

// Persistent tracking variables reset per session
let lastTrackedUrl = location.href;
let lastVideoSrc = '';
let lastVideoDurationCheck = 0;
let lastVideoDurationTime = 0;
let lastShortsId = location.href.includes('/shorts/') ? location.href : '';

// ============================================================
// SAFE MESSAGING HELPER & CONTEXT GUARD
// ============================================================

function isContextValid() {
  try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
}

function safeSendMessage(message) {
  if (!isContextValid()) { killAllTimers(); return Promise.resolve(); }
  try {
    return chrome.runtime.sendMessage(message).catch(function(e) { if (DEBUG_MODE) console.warn('[Intentional YouTube] sendMessage failed:', message.action, e); });
  } catch (e) { if (DEBUG_MODE) console.warn('[Intentional YouTube] sendMessage threw:', message.action, e); killAllTimers(); }
  return Promise.resolve();
}

function killAllTimers() {
  if (interventionTimer) { clearInterval(interventionTimer); interventionTimer = null; }
  if (decayTimerId) { clearInterval(decayTimerId); decayTimerId = null; }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initializeContentScript();
} else {
  window.addEventListener('load', initializeContentScript);
}

chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action === 'pageLoaded') handlePageLoad();
  if (request.action === 'applyInterfaceChanges') applyInterfaceChanges();
  if (request.action === 'showExitReflection') endCurrentSession();
  if (request.action === 'showIntentCheckpoint') {
    currentSession = null;
    killAllTimers();
    resetBehavioralState();
    chrome.storage.local.remove('pendingIntentCheckpoint').catch(() => {});
    showIntentCheckpoint();
  }
});

// ============================================================
// BEHAVIORAL STATE ENGINE
// ============================================================

function applyScoreDecay() {
  for (const state in stateConfidence) {
    // Floor is 0, not 10 — states need to be able to fully clear so dominant state is unambiguous
    stateConfidence[state] = Math.max(0, stateConfidence[state] * DECAY_RATE);
  }
  // Decay behavioral-event penalties faster so recovery is practical
  const penaltyDecay = 0.90;
  // Preserve the recommendation chain as long as the user is still watching
  // a recommendation-derived video. Otherwise sustained viewing would decay the
  // chain away and erase the drift signal.
  if (!behavioralMetrics.isCurrentVideoFromRecommendation) {
    behavioralMetrics.consecutiveRecommendations *= penaltyDecay;
  }
  behavioralMetrics.rapidSwitchCount *= penaltyDecay;
  behavioralMetrics.autoplayTransitions *= penaltyDecay;
  behavioralMetrics.homepageScrollStreak *= penaltyDecay;
  if (behavioralMetrics.consecutiveRecommendations < 0.1) behavioralMetrics.consecutiveRecommendations = 0;
  if (behavioralMetrics.rapidSwitchCount < 0.1) behavioralMetrics.rapidSwitchCount = 0;
  if (behavioralMetrics.autoplayTransitions < 0.1) behavioralMetrics.autoplayTransitions = 0;
  if (behavioralMetrics.homepageScrollStreak < 0.1) behavioralMetrics.homepageScrollStreak = 0;
}

function updateConfidenceScores(eventType, intensity = 1.0) {
  const weights = WEIGHTS[eventType];
  if (!weights) return;
  for (const state in weights) {
    const adjustment = weights[state] * intensity;
    stateConfidence[state] = Math.max(0, Math.min(100, stateConfidence[state] + adjustment));
  }
}

// Used for passive/autoplay viewing ticks.
// Recommendation Loop represents *entry into* the autoplay chain, not ongoing passive consumption.
// Once RecLoop confidence reaches ~45 it is already fully established; further autoplay viewing
// should grow Passive Consumption, not keep pushing RecLoop higher.
const REC_LOOP_SATURATION = 45;
function updateConfidenceScoresPassiveViewing(intensity) {
  const weights = WEIGHTS['sustainedViewingPassive'];
  for (const state in weights) {
    var perStateIntensity = intensity;
    if (state === BEHAVIORAL_STATES.RECOMMENDATION_LOOP) {
      // Scale down the RecLoop contribution linearly as it approaches the saturation point.
      // At confidence <= 0: full weight. At confidence >= REC_LOOP_SATURATION: zero weight.
      var recConf = stateConfidence[BEHAVIORAL_STATES.RECOMMENDATION_LOOP];
      var scale = Math.max(0, 1 - recConf / REC_LOOP_SATURATION);
      perStateIntensity = intensity * scale;
    }
    var adjustment = weights[state] * perStateIntensity;
    stateConfidence[state] = Math.max(0, Math.min(100, stateConfidence[state] + adjustment));
  }
}

function updateBehavioralState() {
  // Enforce transition cooldown to prevent rapid oscillation between states.
  // Cooldown is decremented once per engine cycle in startDecayTimer.
  if (stateTransitionCooldown > 0) return;

  const dominantState = Object.keys(stateConfidence).reduce((a, b) =>
    stateConfidence[a] > stateConfidence[b] ? a : b
  );

  dominantStateHistory.push(dominantState);
  if (dominantStateHistory.length > MIN_TRANSITION_CYCLES) dominantStateHistory.shift();

  const isConsistentlyDominant = dominantStateHistory.length >= MIN_TRANSITION_CYCLES &&
    dominantStateHistory.every(s => s === dominantState);
  const dominanceMargin = stateConfidence[dominantState] - stateConfidence[currentState];
  const isSignificantlyDominant = dominanceMargin >= STATE_DOMINANCE_THRESHOLD;

  if (isConsistentlyDominant && isSignificantlyDominant && dominantState !== currentState) {
    const previousState = currentState;
    currentState = dominantState;
    stateTransitionCooldown = MIN_TRANSITION_CYCLES;
    dominantStateHistory = []; // Clear history so the new state must establish its own dominance
    behavioralStateHistory.push({ timestamp: Date.now(), previousState, newState: currentState, confidenceScores: { ...stateConfidence } });
    recordPathwayEvent('state_transition', { previousState, newState: currentState });
    detectForkPoint(previousState, currentState);
    detectRecovery(previousState, currentState);
    syncBehavioralState();
  }
}

function syncBehavioralState() {
  if (currentSession) {
    safeSendMessage({ action: 'updateBehavioralState', data: { state: currentState, history: behavioralStateHistory, confidenceScores: { ...stateConfidence }, intentAlignment: intentAlignmentScore } });
  }
}

// ============================================================
// INTENT ALIGNMENT ENGINE
// ============================================================

function calculateIntentAlignment() {
  if (!currentSession) { intentAlignmentScore = 100; return; }
  const intention = currentSession.originalIntention || currentSession.intention;

  // State confidences
  var recLoopConf = Math.max(0, stateConfidence[BEHAVIORAL_STATES.RECOMMENDATION_LOOP] - 20);
  var passiveConf = Math.max(0, stateConfidence[BEHAVIORAL_STATES.PASSIVE_CONSUMPTION] - 20);
  var goalConf = stateConfidence[BEHAVIORAL_STATES.GOAL_ORIENTED_SEARCH];
  var engageConf = stateConfidence[BEHAVIORAL_STATES.SUSTAINED_ENGAGEMENT];
  var casualConf = stateConfidence[BEHAVIORAL_STATES.CASUAL_EXPLORATION];

  // Intent weights for universal drift signals
  // Lower = more lenient for that intent; 0 = ignored entirely
  var intentWeights = {
    // Find: strictest — any drift from goal is meaningful
    'Find a specific video': { recLoop: 1.0, autoplay: 1.0, rapidSwitch: 1.0, passive: 1.0, homepageScroll: 1.0 },
    // Learn: strict but tolerates intentional branching; passive/autoplay still serious
    'Learn something':       { recLoop: 0.9, autoplay: 0.9, rapidSwitch: 0.85, passive: 0.85, homepageScroll: 0.7 },
    // Relax: most forgiving — intentional entertainment is the goal
    'Relax / Be entertained':{ recLoop: 0.45, autoplay: 0.45, rapidSwitch: 0.5, passive: 0.35, homepageScroll: 0.25 },
    // Explore: tolerates recommendation-following; penalises passive drift, not curiosity
    'Explore a topic':       { recLoop: 0.45, autoplay: 0.50, rapidSwitch: 0.6, passive: 0.65, homepageScroll: 0.75 }
  };
  var w = intentWeights[intention] || intentWeights['Explore a topic'];

  // Universal drift penalties weighted by intent
  var penalty = 0;
  // Find: tighter cap on rec-loop penalty — even 2-3 recs without search is a strong signal
  // Learn: single manual recommendation should register as a small drift, so per-step penalty is higher
  // Relax: reduced per-step sensitivity — following a few recs while relaxing is normal
  // Others: standard
  var recCapForIntent = intention === 'Find a specific video' ? 30 : 50;
  var recStepForIntent = intention === 'Relax / Be entertained' ? 10 : (intention === 'Learn something' ? 14 : (intention === 'Find a specific video' ? 18 : 12));
  penalty += Math.min(recCapForIntent, behavioralMetrics.consecutiveRecommendations * recStepForIntent) * w.recLoop;
  penalty += Math.min(20, behavioralMetrics.autoplayTransitions * 10) * w.autoplay;
  penalty += Math.min(30, behavioralMetrics.rapidSwitchCount * 8) * w.rapidSwitch;
  penalty += (recLoopConf / 80) * 35 * w.recLoop;
  penalty += (passiveConf / 80) * 30 * w.passive;

  // Homepage behavior is treated as a CONTEXTUAL signal, never a direct penalty.
  var onHomepage = isHomepage();
  var onVideoPage = location.href.includes('/watch') || location.href.includes('/shorts/');
  var scrollStreak = behavioralMetrics.homepageScrollStreak;
  var noRecentSearch = behavioralMetrics.searchEvents === 0 || behavioralMetrics.timeSinceLastSearch > 120000;
  var idleMs = behavioralMetrics.lastIntentionalInteractionTime > 0 ? Date.now() - behavioralMetrics.lastIntentionalInteractionTime : (currentSession.startTime ? Date.now() - currentSession.startTime : 0);
  var prolongedIdle = idleMs > 20000;
  var idleMinutes = idleMs / 60000;
  // idleMinutes drift on a video page only applies when no video is actively playing.
  // While a video is playing (intentional or passive), the confidence-based passiveConf
  // penalty already captures the passive-viewing signal. Applying idleMinutes on top
  // would cause continuous alignment drain from a single autoplay event with no new behavior.
  var vid = document.querySelector('video');
  var videoIsPlaying = !!(vid && !vid.paused && vid.currentTime > 0 && !isAdPlaying());
  var idleMinutesForVideoPage = videoIsPlaying ? 0 : idleMinutes;
  var homepageDrift = 0;

  if (intention === 'Find a specific video') {
    // Homepage or video page browsing without search is a strong negative signal — no plateau.
    // Scroll streak applies immediately; idle-time drift only when no recent search.
    if (onHomepage || onVideoPage) homepageDrift += scrollStreak * 8;
    if (onHomepage && noRecentSearch) {
      homepageDrift += idleMinutes * 36; // 36 × 1.0 + 5.0 = 41 pts/min → 50/41 = 1.22 min ✓
    } else if (onVideoPage && noRecentSearch) {
      homepageDrift += idleMinutesForVideoPage * 36;
    }
  } else if (intention === 'Learn something') {
    // Scroll streak applies immediately on video/homepage regardless of idle gate.
    // Idle-time drift still requires prolongedIdle to avoid penalising brief pauses.
    if (onHomepage || onVideoPage) homepageDrift += scrollStreak * 6;
    if (onHomepage && noRecentSearch && prolongedIdle) {
      homepageDrift += idleMinutes * 34; // 34 × 0.7 + 3.6 = 27.4 pts/min → 50/27.4 = 1.82 min ✓
    } else if (onVideoPage && noRecentSearch && prolongedIdle) {
      homepageDrift += idleMinutesForVideoPage * 34;
    }
  } else if (intention === 'Relax / Be entertained') {
    // Mild drift from any homepage/video page scrolling or idling.
    if (onHomepage || onVideoPage) {
      homepageDrift += scrollStreak * 4;
    }
    if (onHomepage) {
      homepageDrift += idleMinutes * 27; // 27 × 0.3 + 1.2 = 9.3 pts/min → 50/9.3 = 5.38 min ✓
    } else if (onVideoPage) {
      homepageDrift += idleMinutesForVideoPage * 27;
    }
  } else if (intention === 'Explore a topic') {
    // Mild drift from homepage/video page scrolling or idling regardless of search recency.
    if (onHomepage || onVideoPage) {
      homepageDrift += scrollStreak * 5;
    }
    if (onHomepage) {
      homepageDrift += idleMinutes * 15; // 15 × 0.8 + 2.4 = 14.4 pts/min → 50/14.4 = 3.47 min ✓
    } else if (onVideoPage) {
      homepageDrift += idleMinutesForVideoPage * 15;
    }
  }

  // Apply intent-specific weighting to the homepage-derived drift
  // Note: homepageDrift is already in points per minute, not needing time-based decay
  penalty += homepageDrift * Math.max(0, w.homepageScroll);

  // Persistent drift memory: intent-inconsistent behavior (homepage browsing, recommendation chains)
  // leaves a lasting mark that decays slowly. Sustained viewing can recover alignment, but it cannot
  // fully erase a prior drift sequence. This is separate from the autoplay cap, which handles autoplay.
  var recLoopPenaltyThisCycle = Math.min(recCapForIntent, behavioralMetrics.consecutiveRecommendations * recStepForIntent) * w.recLoop;
  var driftThisCycle = (homepageDrift * Math.max(0, w.homepageScroll)) + recLoopPenaltyThisCycle;
  driftMemory = Math.max(0, driftMemory * 0.95);
  driftMemory = Math.min(DRIFT_MEMORY_MAX, driftMemory + driftThisCycle * 0.12);
  penalty += driftMemory;

  // Intent-specific bonuses
  // Suppress ALL confidence/activity bonuses while idling on homepage to prevent
  // them from negating drift penalties. Only active engagement should earn bonuses.
  // Also suppress engagement/goal bonuses when the inferred state is passive or recommendation-loop,
  // so residual Sustained Engagement confidence from prior intentional viewing does not
  // generate alignment recovery during autoplay chains.
  var homepageIdling = onHomepage && prolongedIdle;
  var isPassiveState = currentState === BEHAVIORAL_STATES.PASSIVE_CONSUMPTION || currentState === BEHAVIORAL_STATES.RECOMMENDATION_LOOP;
  var bonus = 0;
  if (intention === 'Find a specific video') {
    // Find: search and goal-directed behavior are the only positive signals.
    // Sustained engagement is only rewarding when the user is on-task: no autoplay,
    // no recommendation chain, and the current video was not reached via a recommendation.
    // The provenance flag persists for the current video, so long watching cannot erase
    // the fact that the video was sidebar-driven.
    var findOnTask = !behavioralMetrics.isCurrentVideoAutoplay &&
                     !behavioralMetrics.isCurrentVideoFromRecommendation &&
                     behavioralMetrics.consecutiveRecommendations < 1 &&
                     behavioralMetrics.searchEvents > 0;
    // Find requires a goal. Viewing a video that was neither searched for nor chosen from a rec
    // is a small off-task signal, even when the video is playing intentionally.
    var findOffTask = onVideoPage && !findOnTask && !behavioralMetrics.isCurrentVideoAutoplay &&
                      !behavioralMetrics.isCurrentVideoFromRecommendation &&
                      behavioralMetrics.consecutiveRecommendations < 1 &&
                      !behavioralMetrics.lastVideoChangeWasManual;
    if (findOffTask && !isPassiveState) penalty += 8;
    if (!homepageIdling && !isPassiveState && findOnTask) bonus += (goalConf / 100) * 35;
    if (!homepageIdling && !isPassiveState && findOnTask) bonus += (engageConf / 100) * 15;
    // The search bonus only applies when the user is still on the searched result.
    // A sidebar-recommended video cannot use the prior search to fully restore alignment.
    if (!homepageIdling && findOnTask && behavioralMetrics.timeSinceLastSearch < 120000) bonus += 20;
  } else if (intention === 'Learn something') {
    // Learn: sustained engagement is the primary signal, but only when it is intentional.
    // A single manual recommendation is a small departure from focused learning; the sustained
    // engagement bonus is therefore only available when no rec chain exists. The higher
    // recStepForIntent ensures the first rec still produces a small, visible drift even when
    // the search bonus is present. Autoplayed viewing is never a learning signal.
    var learnContext = !behavioralMetrics.isCurrentVideoAutoplay && behavioralMetrics.consecutiveRecommendations < 1;
    if (!homepageIdling && !isPassiveState) bonus += (goalConf / 100) * 20;
    if (!homepageIdling && !isPassiveState && learnContext) bonus += (engageConf / 100) * 35;
    if (!homepageIdling && !isPassiveState && learnContext && behavioralMetrics.intentionalSustainedViewingTime > 30000) {
      bonus += Math.min(30, (behavioralMetrics.intentionalSustainedViewingTime / 60000) * 22);
    }
    if (!homepageIdling && behavioralMetrics.searchEvents > 0 && behavioralMetrics.timeSinceLastSearch < 600000) bonus += 10;
  } else if (intention === 'Relax / Be entertained') {
    // Relax: intentional leisure is the goal. Casual exploration and sustained viewing are rewarded,
    // but only when the user is actually choosing. Passive/autoplay viewing is not rewarded.
    var relaxContext = !behavioralMetrics.isCurrentVideoAutoplay;
    if (!homepageIdling && relaxContext) bonus += (casualConf / 100) * 30;
    if (!homepageIdling && !isPassiveState && relaxContext) bonus += (engageConf / 100) * 25;
    if (!homepageIdling && !isPassiveState && relaxContext && behavioralMetrics.intentionalSustainedViewingTime > 30000) {
      bonus += Math.min(20, (behavioralMetrics.intentionalSustainedViewingTime / 60000) * 16);
    }
  } else if (intention === 'Explore a topic') {
    // Explore: curiosity and discovery are rewarded. Intentional recommendation-following is the core
    // positive signal, not a penalty. Sustained viewing is only rewarded when the user is following
    // a thread (recent rec chain) or has searched and branched. Autoplay is not exploration.
    var suppressHomepageBonus = onHomepage && noRecentSearch;
    var exploreContext = !behavioralMetrics.isCurrentVideoAutoplay && (behavioralMetrics.consecutiveRecommendations > 0 || behavioralMetrics.searchEvents > 0);
    if (!suppressHomepageBonus) bonus += (casualConf / 100) * 22;
    if (!suppressHomepageBonus && !isPassiveState && exploreContext) bonus += (engageConf / 100) * 18;
    if (!suppressHomepageBonus && !isPassiveState) bonus += (goalConf / 100) * 10;
    if (!suppressHomepageBonus && !isPassiveState && exploreContext && behavioralMetrics.intentionalSustainedViewingTime > 30000) {
      bonus += Math.min(15, (behavioralMetrics.intentionalSustainedViewingTime / 60000) * 12);
    }
    // Intentional recommendation-following: a chain of 1-3 manually selected recs is the clearest
    // evidence of active exploration. The bonus is larger to make it the dominant reward.
    var exploreRecBonus = Math.min(3, behavioralMetrics.consecutiveRecommendations);
    if (!isPassiveState && exploreRecBonus > 0) bonus += exploreRecBonus * 8;
    if (!suppressHomepageBonus && behavioralMetrics.searchEvents > 0 && behavioralMetrics.timeSinceLastSearch < 300000) bonus += 8;
  }

  // Hard caps
  bonus = Math.min(40, bonus);

  var alignment = Math.max(0, Math.min(100, Math.round(100 - penalty + bonus)));
  // Apply autoplay alignment cap — lifts gradually via intentional viewing ticks
  alignment = Math.min(alignment, autoplayCap);
  var diff = alignment - intentAlignmentScore;
  // Smooth transitions: move by up to 15 per cycle
  // This prevents sudden drops when confidence scores decay rapidly
  if (Math.abs(diff) > 15) {
    intentAlignmentScore += Math.sign(diff) * 15;
  } else {
    intentAlignmentScore = alignment;
  }

  const prevAlignment = driftEvents.length > 0 ? driftEvents[driftEvents.length - 1].newAlignment : 100;
  if (prevAlignment - intentAlignmentScore > 15) {
    const driftEvent = { timestamp: Date.now(), previousAlignment: prevAlignment, newAlignment: intentAlignmentScore, currentState, reason: generateDriftReason() };
    driftEvents.push(driftEvent);
    safeSendMessage({ action: 'recordDriftEvent', data: driftEvent });
  }
}

function generateDriftReason() {
  if (behavioralMetrics.consecutiveRecommendations >= 5) return `${behavioralMetrics.consecutiveRecommendations} consecutive recommendation clicks`;
  if (behavioralMetrics.autoplayTransitions >= 3) return `${behavioralMetrics.autoplayTransitions} autoplay transitions`;
  if (currentState === BEHAVIORAL_STATES.RECOMMENDATION_LOOP) return 'Entered recommendation loop pattern';
  return 'Behavioral pattern shift detected';
}

// ============================================================
// FORK POINT & RECOVERY DETECTION
// ============================================================

function detectForkPoint(previousState, newState) {
  const goalStates = [BEHAVIORAL_STATES.GOAL_ORIENTED_SEARCH, BEHAVIORAL_STATES.SUSTAINED_ENGAGEMENT];
  const passiveStates = [BEHAVIORAL_STATES.RECOMMENDATION_LOOP, BEHAVIORAL_STATES.PASSIVE_CONSUMPTION];
  // Only flag divergences away from intentional states, not recoveries back to them
  const isMeaningful = (goalStates.includes(previousState) && passiveStates.includes(newState)) ||
    (goalStates.includes(previousState) && newState === BEHAVIORAL_STATES.CASUAL_EXPLORATION) ||
    (previousState === BEHAVIORAL_STATES.CASUAL_EXPLORATION && newState === BEHAVIORAL_STATES.RECOMMENDATION_LOOP);
  if (!isMeaningful) return;
  if (lastForkPoint && Date.now() - lastForkPoint.timestamp < 60000) return;
  const sessionElapsed = currentSession && currentSession.startTime ? Date.now() - currentSession.startTime : 0;
  const fp = {
    timestamp: Date.now(),
    previousState,
    newState,
    reason: `${previousState} → ${newState}`,
    alignmentBefore: intentAlignmentScore,
    sessionElapsedMs: sessionElapsed
  };
  forkPoints.push(fp);
  lastForkPoint = fp;
  recordPathwayEvent('fork_point', { previousState, newState, reason: fp.reason });
  safeSendMessage({ action: 'recordForkPoint', data: fp });
}

function detectRecovery(previousState, newState) {
  const goalStates = [BEHAVIORAL_STATES.GOAL_ORIENTED_SEARCH, BEHAVIORAL_STATES.SUSTAINED_ENGAGEMENT];
  const passiveStates = [BEHAVIORAL_STATES.RECOMMENDATION_LOOP, BEHAVIORAL_STATES.PASSIVE_CONSUMPTION];
  if (passiveStates.includes(previousState) && goalStates.includes(newState)) {
    intentAlignmentScore = Math.min(100, intentAlignmentScore + 15);
    const re = { timestamp: Date.now(), previousState, newState, reason: `Returned to ${newState} from ${previousState}`, trigger: 'state_transition' };
    recoveryEvents.push(re);
    lastRecoveryEvent = re;
    recordPathwayEvent('recovery', { reason: re.reason });
    safeSendMessage({ action: 'recordRecovery', data: re });
  }
}

function detectRecoveryFromBehavior(eventType) {
  if (eventType === 'search') {
    intentAlignmentScore = Math.min(100, intentAlignmentScore + 20);
    const re = { timestamp: Date.now(), reason: 'Performed new search', trigger: 'search' };
    recoveryEvents.push(re);
    lastRecoveryEvent = re;
    recordPathwayEvent('recovery', { reason: re.reason, trigger: 'search' });
  }
  if (eventType === 'homepageVisit' && currentState === BEHAVIORAL_STATES.RECOMMENDATION_LOOP) {
    intentAlignmentScore = Math.min(100, intentAlignmentScore + 10);
    const re = { timestamp: Date.now(), reason: 'Returned to homepage', trigger: 'homepage' };
    recoveryEvents.push(re);
    lastRecoveryEvent = re;
    recordPathwayEvent('recovery', { reason: re.reason, trigger: 'homepage' });
  }
}

// ============================================================
// PATHWAY RECORDING
// ============================================================

const MEANINGFUL_EVENTS = ['search', 'state_transition', 'fork_point', 'recovery', 'reflection_checkpoint', 'intention_change', 'session_start', 'session_end', 'homepage', 'recommendation', 'autoplay'];

function recordPathwayEvent(eventType, data = {}) {
  if (!MEANINGFUL_EVENTS.includes(eventType)) return;
  const event = { timestamp: Date.now(), type: eventType, state: currentState, alignment: intentAlignmentScore, ...data };
  sessionPathway.push(event);
  safeSendMessage({ action: 'updatePathway', data: { pathway: sessionPathway } });
}

// ============================================================
// BEHAVIOR TRACKING
// ============================================================

function isHomepage() {
  var url = location.href;
  return url === 'https://www.youtube.com/' || url === 'https://www.youtube.com' || url === 'https://www.youtube.com/home' || url.includes('youtube.com/feed');
}

function trackBehavioralEvent(eventType, data = {}) {
  switch (eventType) {
    case 'search':
      behavioralMetrics.searchEvents++;
      behavioralMetrics.lastSearchTime = Date.now();
      behavioralMetrics.timeSinceLastSearch = 0;
      behavioralMetrics.consecutiveRecommendations = 0;
      behavioralMetrics.homepageScrollStreak = 0;
      behavioralMetrics.lastIntentionalInteractionTime = Date.now();
      behavioralMetrics.isCurrentVideoAutoplay = false;
      behavioralMetrics.isCurrentVideoFromRecommendation = false;
      behavioralMetrics.lastVideoChangeWasManual = true;
      updateConfidenceScores('search', 1.0);
      detectRecoveryFromBehavior('search');
      break;
    case 'homepage':
      behavioralMetrics.homepageVisits++;
      behavioralMetrics.isCurrentVideoAutoplay = false;
      behavioralMetrics.isCurrentVideoFromRecommendation = false;
      updateConfidenceScores('homepageVisit', 1.0);
      detectRecoveryFromBehavior('homepageVisit');
      break;
    case 'recommendation':
      behavioralMetrics.recommendationClicks++;
      behavioralMetrics.consecutiveRecommendations++;
      behavioralMetrics.homepageScrollStreak = 0;
      if (data.passive) {
        // Passive algorithm-driven transitions (e.g., Shorts swipe-through) are treated like autoplay.
        behavioralMetrics.isCurrentVideoAutoplay = true;
        behavioralMetrics.isCurrentVideoFromRecommendation = false;
        behavioralMetrics.lastVideoChangeWasManual = false;
      } else {
        behavioralMetrics.lastIntentionalInteractionTime = Date.now();
        behavioralMetrics.isCurrentVideoAutoplay = false;
        behavioralMetrics.isCurrentVideoFromRecommendation = true;
        behavioralMetrics.lastVideoChangeWasManual = true;
      }
      updateConfidenceScores('recommendationClick', 1.0);
      break;
    case 'autoplay':
      behavioralMetrics.autoplayTransitions++;
      behavioralMetrics.autoplayCount++;
      behavioralMetrics.videoSwitches++;
      behavioralMetrics.consecutiveRecommendations++;
      behavioralMetrics.isCurrentVideoAutoplay = true;
      behavioralMetrics.isCurrentVideoFromRecommendation = false;
      updateConfidenceScores('autoplay', 1.0);
      // Apply a tiered alignment cap based on cumulative autoplay count.
      // 1st autoplay: cap at 85. 2nd: cap at 70. 3rd+: cap at 55.
      var newCap = behavioralMetrics.autoplayCount === 1 ? 85 : behavioralMetrics.autoplayCount === 2 ? 70 : 55;
      autoplayCap = Math.min(autoplayCap, newCap);
      showAutoplayCapToast(behavioralMetrics.autoplayCount, autoplayCap);
      break;
    case 'video_switch':
      behavioralMetrics.videoSwitches++;
      const switchNow = Date.now();
      if (behavioralMetrics.lastVideoSwitchTime && switchNow - behavioralMetrics.lastVideoSwitchTime < 30000) {
        behavioralMetrics.rapidSwitchCount++;
        updateConfidenceScores('rapidSwitch', 1.0);
      }
      behavioralMetrics.lastVideoSwitchTime = switchNow;
      behavioralMetrics.homepageScrollStreak = 0;
      break;
    case 'scroll':
      behavioralMetrics.scrollEvents++;
      if (isHomepage()) {
        behavioralMetrics.homepageScrollEvents++;
        behavioralMetrics.homepageScrollStreak++;
      } else if (location.href.includes('/watch') || location.href.includes('/shorts/')) {
        // On video pages, treat sidebar/comments scrolling the same as homepage scrolling for drift
        behavioralMetrics.homepageScrollStreak++;
      }
      updateConfidenceScores('scroll', 0.5);
      break;
    case 'video_duration':
      if (data.duration) {
        behavioralMetrics.videoWatchDurations.push(data.duration);
        if (behavioralMetrics.videoWatchDurations.length > 10) behavioralMetrics.videoWatchDurations.shift();
        // >= 1000 so each 1s interval qualifies for continuous per-second updates
        if (data.duration >= 1000) {
          behavioralMetrics.sustainedViewingTime += data.duration;
          if (behavioralMetrics.isCurrentVideoAutoplay) {
            // Autoplay-driven viewing is passive consumption, not sustained engagement.
            updateConfidenceScoresPassiveViewing(Math.min(2.0, data.duration / 30000));
          } else {
            // Intentional sustained viewing rewards engagement and earns alignment bonuses.
            behavioralMetrics.intentionalSustainedViewingTime += data.duration;
            // Treat continued intentional playback as an interaction every second so the
            // timestamp keeps moving forward even when the mouse is idle.
            behavioralMetrics.lastIntentionalInteractionTime = Date.now();
            updateConfidenceScores('sustainedViewing', Math.min(2.0, data.duration / 30000));
          }
        }
      }
      break;
  }
  if (behavioralMetrics.lastSearchTime > 0) {
    behavioralMetrics.timeSinceLastSearch = Date.now() - behavioralMetrics.lastSearchTime;
  }
  updateBehavioralState();
  calculateIntentAlignment();
  applyVisualDrift();
  recordPathwayEvent(eventType, data);
  updateDebugPanel();
  checkBehaviorTriggeredReflection();
}

function checkBehaviorTriggeredReflection() {
  if (!currentSession) return;
  if (Date.now() - lastReflectionTime < REFLECTION_COOLDOWN_MS) return;
  if (reflectionState !== REFLECTION_STATES.IDLE) return;
  if (intentAlignmentScore < 50) {
    showBehavioralReflection('low_alignment');
  } else if (currentState === BEHAVIORAL_STATES.PASSIVE_CONSUMPTION && behavioralMetrics.autoplayTransitions >= 4) {
    showBehavioralReflection('passive_consumption');
  }
}

function detectCurrentActivity() {
  const url = window.location.href;
  if (url.includes('/results')) return 'Searching';
  if (url.includes('/watch')) return 'Watching a video';
  if (url.includes('/shorts')) return 'Viewing Shorts';
  if (url === 'https://www.youtube.com/' || url === 'https://www.youtube.com') return 'Browsing homepage';
  return 'Browsing YouTube';
}

// ============================================================
// BEHAVIOR-RESPONSIVE VISUAL DRIFT
// ============================================================

const DRIFT_INTENSITY_MULTIPLIER = { off: 0, subtle: 0.6, moderate: 0.8, strong: 1.0 };
let driftStyleElement = null;

function applyVisualDrift() {
  const driftSetting = settings.visualDrift || 'subtle';
  if (!currentSession || driftSetting === 'off') { removeVisualDrift(); return; }
  const multiplier = DRIFT_INTENSITY_MULTIPLIER[driftSetting] || 0.6;
  const normalizedDrift = (100 - intentAlignmentScore) / 100;
  const curvedDrift = Math.pow(normalizedDrift, 0.85);
  const grayscalePercent = curvedDrift * 95 * multiplier;
  if (!driftStyleElement) {
    driftStyleElement = document.createElement('style');
    driftStyleElement.id = 'iy-visual-drift-style';
    document.head.appendChild(driftStyleElement);
  }
  driftStyleElement.textContent = `
    ytd-page-manager, ytd-browse, #columns,
    #secondary, #related, #comments, #info, #meta,
    ytd-watch-metadata, #above-the-fold, #below {
      filter: grayscale(${grayscalePercent.toFixed(1)}%);
      transition: filter 3s ease;
    }
    ytd-watch-flexy #primary #player {
      filter: none !important;
    }
    #masthead, #masthead-container, ytd-masthead {
      filter: none !important;
    }
    #masthead #logo-icon, #masthead ytd-topbar-logo-renderer, #masthead a#logo, #masthead #logo,
    #masthead yt-icon, #masthead svg, #masthead .ytd-topbar-logo-renderer,
    #masthead yt-icon-button#guide-button, #masthead #logo-icon *,
    #masthead ytd-topbar-logo-renderer *, #masthead a#logo *,
    #masthead yt-icon *, #masthead svg *, #masthead .ytd-topbar-logo-renderer * {
      filter: none !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer {
      filter: none !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
    #movie_player, .html5-video-player, #player-container,
    .ytp-chrome-top, .ytp-chrome-bottom, .ytp-chrome-controls,
    .ytp-settings-button, .ytp-size-button, .ytp-fullscreen-button,
    .ytp-miniplayer-button, .ytp-subtitles-button, .ytp-right-controls,
    .ytp-left-controls, .ytp-button, .ytp-menuitem,
    .ytp-popup, .ytp-panel, .ytp-panel-menu,
    .ytp-title, .ytp-title-text,
    .ytp-gradient-top, .ytp-gradient-bottom,
    .ytp-chrome-controls *, .ytp-button *,
    .ytp-settings-button *, .ytp-size-button *, .ytp-fullscreen-button *,
    .ytp-miniplayer-button *, .ytp-subtitles-button *,
    .ytp-right-controls *, .ytp-left-controls *,
    .ytp-autonav-toggle-button, .ytp-autonav-toggle-button *,
    .ytp-autonav-toggle-container, .ytp-autonav-toggle-container *,
    .ytp-autonav-toggle-button *, .ytp-autonav-toggle-container *,
    [data-tooltip-target-id="ytp-autonav-toggle-button"],
    .ytp-subtitles-button, .ytp-subtitles-button *,
    .ytp-settings-button, .ytp-settings-button *,
    .ytp-size-button, .ytp-size-button *,
    .ytp-fullscreen-button, .ytp-fullscreen-button *,
    .ytp-play-button, .ytp-play-button *,
    .ytp-next-button, .ytp-next-button *,
    .ytp-prev-button, .ytp-prev-button * {
      filter: none !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
  `;
}

function removeVisualDrift() {
  if (driftStyleElement) {
    driftStyleElement.textContent = `
      ytd-page-manager, ytd-browse, #columns, #secondary, #related, #comments, #info, #meta, ytd-watch-metadata, #above-the-fold, #below { filter: grayscale(0%); transition: filter 3s ease; }
    `;
    setTimeout(() => { if (driftStyleElement) driftStyleElement.textContent = ''; }, 3500);
  }
}

// ============================================================
// VIDEO PLAYBACK CONTROL
// ============================================================

function pauseVideo() {
  const video = document.querySelector('video');
  if (video) {
    videoWasPlaying = !video.paused;
    if (!video.paused) video.pause();
  }
}

function resumeVideo() {
  const video = document.querySelector('video');
  if (video && videoWasPlaying) video.play();
  videoWasPlaying = false;
}

// ============================================================
// DEBUG PANEL & SETTINGS BUTTON
// ============================================================

function createSettingsButton() {
  if (document.getElementById('iy-settings-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'iy-settings-btn';
  btn.textContent = '\u2699 Settings';
  btn.title = 'Open Intentional YouTube Settings';
  document.body.appendChild(btn);
  btn.addEventListener('click', function() {
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(function() { window.open(chrome.runtime.getURL('options.html'), '_blank'); });
      } else { window.open(chrome.runtime.getURL('options.html'), '_blank'); }
    } catch (e) { window.open(chrome.runtime.getURL('options.html'), '_blank'); }
  });
}

function createDebugPanel() {
  if (!DEBUG_MODE) return;
  let panel = document.getElementById('iy-debug-panel');
  if (panel) return;
  panel = document.createElement('div');
  panel.id = 'iy-debug-panel';
  panel.innerHTML = `
    <div class="debug-header"><span>Intentional YT Debug</span><button id="iy-debug-toggle">_</button></div>
    <div class="debug-body" id="iy-debug-body">
      <div class="debug-section"><strong>State:</strong> <span id="dbg-state">-</span></div>
      <div class="debug-section"><strong>Confidence:</strong><pre id="dbg-confidence">-</pre></div>
      <div class="debug-section"><strong>Alignment:</strong> <span id="dbg-alignment">-</span></div>
      <div class="debug-section"><strong>Behavior:</strong><pre id="dbg-behavior">-</pre></div>
      <div class="debug-section"><strong>Engine State:</strong><pre id="dbg-engine">-</pre></div>
      <div class="debug-section"><strong>Events:</strong><div id="dbg-events">-</div></div>
      <div class="debug-section"><strong>Visual Drift:</strong> <span id="dbg-drift">-</span></div>
      <div class="debug-section"><strong>Reflection Timer:</strong>
        <div>Session: <span id="dbg-session-active">-</span></div>
        <div>Interval: <span id="dbg-reflection-interval">-</span></div>
        <div>Elapsed: <span id="dbg-reflection-elapsed">-</span></div>
        <div>Remaining: <span id="dbg-reflection-remaining">-</span></div>
        <div>Status: <span id="dbg-reflection-status">-</span></div>
        <button id="dbg-trigger-reflection" style="margin-top:6px;padding:4px 8px;background:#444;color:#fff;border:1px solid #666;border-radius:4px;cursor:pointer;">Trigger reflection</button>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
  document.getElementById('iy-debug-toggle').addEventListener('click', () => {
    const body = document.getElementById('iy-debug-body');
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('dbg-trigger-reflection').addEventListener('click', () => {
    if (!currentSession) return alert('No active session');
    showForcedObservationPause(currentSession.originalIntention || currentSession.intention || '');
  });
}

function showAutoplayCapToast(autoplayCount, capValue) {
  var existing = document.getElementById('iy-autoplay-toast');
  if (existing) existing.remove();
  var ordinal = autoplayCount === 1 ? '1st' : autoplayCount === 2 ? '2nd' : autoplayCount + 'th';
  var recoveryMins = Math.ceil((100 - capValue) / AUTOPLAY_CAP_RECOVERY_PER_TICK * (DECAY_INTERVAL_MS / 1000) / 60);
  var toast = document.createElement('div');
  toast.id = 'iy-autoplay-toast';
  toast.style.cssText = 'position:fixed;bottom:80px;right:24px;z-index:2147483647;background:#1a1a1a;color:#f1f1f1;border-left:4px solid #ff6b35;border-radius:6px;padding:12px 16px;max-width:300px;font-size:13px;font-family:sans-serif;line-height:1.5;box-shadow:0 4px 16px rgba(0,0,0,0.5);';
  toast.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">' +
      '<strong>Autoplay detected (' + ordinal + ')</strong>' +
      '<button id="iy-autoplay-toast-close" style="background:none;border:none;color:#aaa;font-size:16px;cursor:pointer;line-height:1;padding:0 0 0 12px;">&times;</button>' +
    '</div>' +
    'Alignment is now capped at <strong>' + capValue + '%</strong> due to ' + autoplayCount + ' autoplay transition' + (autoplayCount > 1 ? 's' : '') + ' this session.<br>' +
    '<span style="color:#aaa;font-size:11px;">Watch intentionally for ~' + recoveryMins + ' min to fully lift the cap.</span>';
  document.body.appendChild(toast);
  document.getElementById('iy-autoplay-toast-close').addEventListener('click', function() {
    toast.remove();
  });
}

function updateDebugPanel() {
  if (!DEBUG_MODE) return;
  const el = (id) => document.getElementById(id);
  if (!el('dbg-state')) return;
  el('dbg-state').textContent = currentState;
  el('dbg-alignment').textContent = intentAlignmentScore + '%';
  el('dbg-drift').textContent = settings.visualDrift || 'subtle';
  el('dbg-confidence').textContent = Object.entries(stateConfidence).map(([k, v]) => k + ': ' + v.toFixed(1)).join('\n');
  el('dbg-behavior').textContent = [
    'consecutiveRec: ' + behavioralMetrics.consecutiveRecommendations.toFixed(2),
    'autoplay: ' + behavioralMetrics.autoplayCount + ' instances',
    'rapidSwitch: ' + behavioralMetrics.rapidSwitchCount.toFixed(2),
    'sustainedView: ' + Math.round(behavioralMetrics.sustainedViewingTime / 1000) + 's',
    'intentionalSustainedView: ' + Math.round(behavioralMetrics.intentionalSustainedViewingTime / 1000) + 's',
    'timeSinceSearch: ' + Math.round(behavioralMetrics.timeSinceLastSearch / 1000) + 's',
    'scrollEvents: ' + behavioralMetrics.scrollEvents
  ].join('\n');
  el('dbg-engine').textContent = [
    'driftMemory: ' + driftMemory.toFixed(2),
    'autoplayCap: ' + autoplayCap.toFixed(2),
    'videoFromRec: ' + (behavioralMetrics.isCurrentVideoFromRecommendation ? 'yes' : 'no'),
    'videoAutoplay: ' + (behavioralMetrics.isCurrentVideoAutoplay ? 'yes' : 'no')
  ].join('\n');
  const recentEvents = sessionPathway.slice(-5).map(e => new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ': ' + e.type).join('\n');
  el('dbg-events').textContent = recentEvents || 'None';
  const intervalMs = (parseInt(settings.reflectionInterval) || 15) * 60 * 1000;
  const elapsed = currentSession ? Date.now() - (lastReflectionTime || currentSession.startTime || Date.now()) : 0;
  const remaining = currentSession ? Math.max(0, intervalMs - elapsed) : 0;
  el('dbg-session-active').textContent = currentSession ? 'yes' : 'no';
  el('dbg-reflection-interval').textContent = (intervalMs / 60000).toFixed(1) + ' min';
  el('dbg-reflection-elapsed').textContent = (elapsed / 60000).toFixed(1) + ' min';
  el('dbg-reflection-remaining').textContent = (remaining / 60000).toFixed(1) + ' min';
  el('dbg-reflection-status').textContent = interventionTimer ? 'running' : 'stopped';
}

// ============================================================
// REFLECTION STATE MACHINE
// ============================================================

function setReflectionState(state) { reflectionState = state; }
function isReflectionLocked() { return reflectionLocked; }

function lockReflection(overlay, callback) {
  reflectionLocked = true;
  reflectionOverlay = overlay;
  setReflectionState(REFLECTION_STATES.REFLECTION_LOCKED);
  pauseVideo();
  let remaining = MINIMUM_REFLECTION_TIME / 1000;
  const countdownEl = overlay.querySelector('.reflection-countdown');
  reflectionLockTimer = setInterval(() => {
    remaining--;
    if (countdownEl) countdownEl.textContent = 'Reflecting... ' + remaining + 's remaining';
    if (remaining <= 0) {
      clearInterval(reflectionLockTimer);
      reflectionLocked = false;
      setReflectionState(REFLECTION_STATES.REFLECTION_ACTIVE);
      overlay.querySelectorAll('.assessment-btn, .drift-btn, .comparison-btn, .confirmation-btn, .update-btn').forEach(btn => { btn.disabled = false; btn.classList.remove('disabled'); });
      if (callback) callback();
    }
  }, 1000);
}

function resetReflectionState() {
  if (reflectionLockTimer) { clearInterval(reflectionLockTimer); reflectionLockTimer = null; }
  reflectionLocked = false;
  reflectionState = REFLECTION_STATES.IDLE;
  reflectionOverlay = null;
}

// ============================================================
// REFLECTION UI
// ============================================================

function humanizeDuration(minutes) {
  if (minutes <= 0) return 'less than a minute';
  if (minutes === 1) return '1 minute';
  return minutes + ' minutes';
}

function buildBehavioralStateTimeline(sessionData) {
  const startTime = sessionData.startTime || 0;
  const events = sessionPathway.filter(function(p) {
    return ['session_start', 'state_transition', 'fork_point', 'recovery', 'recommendation', 'intention_change'].indexOf(p.type) !== -1;
  });
  events.sort(function(a, b) { return a.timestamp - b.timestamp; });

  if (events.length === 0) return [];

  const timeline = [];

  events.forEach(function(evt, i) {
    const elapsed = startTime ? Math.round((evt.timestamp - startTime) / 60000) : 0;
    const nextEvt = events[i + 1];
    const duration = (nextEvt && startTime) ? Math.round((nextEvt.timestamp - evt.timestamp) / 60000) : 0;

    if (evt.type === 'session_start') {
      timeline.push({
        kind: 'state',
        state: evt.state,
        elapsed: elapsed,
        duration: duration,
        alignment: evt.alignment,
        isCurrent: false
      });
    } else if (evt.type === 'state_transition') {
      timeline.push({
        kind: 'state',
        state: evt.newState,
        elapsed: elapsed,
        duration: duration,
        alignment: evt.alignment,
        isCurrent: false
      });
    } else if (evt.type === 'fork_point') {
      timeline.push({
        kind: 'fork',
        fromState: evt.previousState,
        toState: evt.newState,
        elapsed: elapsed,
        alignment: evt.alignment,
        narrative: 'About ' + humanizeDuration(elapsed) + ' into your session, your browsing began shifting from ' + evt.previousState + ' toward ' + evt.newState + '.'
      });
    } else if (evt.type === 'recovery') {
      var narrative;
      if (evt.previousState && evt.newState) {
        narrative = 'You later returned to ' + evt.newState + ' from ' + evt.previousState + '.';
      } else if (evt.reason) {
        narrative = 'You later ' + evt.reason.toLowerCase() + '.';
      } else {
        narrative = 'Your browsing shifted back toward your intention.';
      }
      timeline.push({
        kind: 'recovery',
        fromState: evt.previousState || '',
        toState: evt.newState || '',
        elapsed: elapsed,
        alignment: evt.alignment,
        narrative: narrative
      });
    } else if (evt.type === 'intention_change') {
      var newIntention = evt.newIntention || 'a different intention';
      timeline.push({
        kind: 'intention_change',
        newIntention: newIntention,
        elapsed: elapsed,
        alignment: evt.alignment,
        narrative: 'You updated your intention to ' + newIntention + '.'
      });
    } else if (evt.type === 'recommendation') {
      var narrative = evt.passive
        ? 'You moved to a recommended video.'
        : 'You clicked a recommendation.';
      timeline.push({
        kind: 'recommendation',
        elapsed: elapsed,
        alignment: evt.alignment,
        narrative: narrative
      });
    }
  });

  // Mark the last state as current and use the live alignment
  for (var i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].kind === 'state') {
      timeline[i].isCurrent = true;
      timeline[i].alignment = intentAlignmentScore;
      break;
    }
  }

  return timeline;
}

function renderStateTimeline(timeline, containerClass) {
  if (timeline.length === 0) {
    return '<div class="behavioral-timeline ' + (containerClass || '') + '">' +
      '<div class="timeline-empty">Your session is still unfolding. No major behavioral transitions yet.</div>' +
      '</div>';
  }

  const itemDelay = 0.5;
  var html = '<div class="behavioral-timeline ' + (containerClass || '') + '">';

  timeline.forEach(function(item, i) {
    const delay = (i * itemDelay).toFixed(2);

    if (item.kind === 'state') {
      const currentBadge = item.isCurrent ? '<span class="current-badge">Current</span>' : '';
      html += '<div class="timeline-row timeline-state fade-in" style="animation-delay:' + delay + 's">' +
        '<span class="timeline-marker state-dot"></span>' +
        '<div class="timeline-content">' +
        '<div class="timeline-state-name">' + item.state + currentBadge + '</div>' +
        '<div class="timeline-meta">' + humanizeDuration(item.elapsed) + ' in' + (item.duration > 0 ? ' · lasted ' + humanizeDuration(item.duration) : '') + '</div>' +
        '</div>' +
        '<div class="timeline-alignment">' + item.alignment + '% aligned</div>' +
        '</div>';
    } else if (item.kind === 'fork') {
      html += '<div class="timeline-row timeline-fork fade-in" style="animation-delay:' + delay + 's">' +
        '<span class="timeline-marker fork-icon">⤵</span>' +
        '<div class="timeline-content">' +
        '<div class="timeline-event-label">Attention shifted</div>' +
        '<div class="timeline-narrative">' + item.narrative + '</div>' +
        '</div>' +
        '</div>';
    } else if (item.kind === 'recovery') {
      html += '<div class="timeline-row timeline-recovery fade-in" style="animation-delay:' + delay + 's">' +
        '<span class="timeline-marker recovery-icon">↩</span>' +
        '<div class="timeline-content">' +
        '<div class="timeline-event-label">Returned toward intention</div>' +
        '<div class="timeline-narrative">' + item.narrative + '</div>' +
        '</div>' +
        '</div>';
    } else if (item.kind === 'intention_change') {
      html += '<div class="timeline-row timeline-intention-change fade-in" style="animation-delay:' + delay + 's">' +
        '<span class="timeline-marker intention-change-icon">✎</span>' +
        '<div class="timeline-content">' +
        '<div class="timeline-event-label">Intention updated</div>' +
        '<div class="timeline-narrative">' + item.narrative + '</div>' +
        '</div>' +
        '</div>';
    } else if (item.kind === 'recommendation') {
      html += '<div class="timeline-row timeline-recommendation fade-in" style="animation-delay:' + delay + 's">' +
        '<span class="timeline-marker recommendation-icon">▸</span>' +
        '<div class="timeline-content">' +
        '<div class="timeline-event-label">Recommendation clicked</div>' +
        '<div class="timeline-narrative">' + item.narrative + '</div>' +
        '</div>' +
        '</div>';
    }
  });

  html += '</div>';
  return html;
}

function showBehavioralReflection(trigger) {
  if (reflectionState !== REFLECTION_STATES.IDLE) return;
  if (Date.now() - lastReflectionTime < REFLECTION_COOLDOWN_MS) return;
  lastReflectionTime = Date.now();
  if (currentSession) { currentSession.lastReflectionTime = lastReflectionTime; try { chrome.storage.local.set({ currentSession: currentSession }); } catch (e) {} }
  const intention = currentSession?.originalIntention || currentSession?.intention || '';
  showMidSessionReflection(intention);
}

async function showForcedObservationPause(intention) {
  if (DEBUG_MODE) console.log('[Intentional YouTube] Showing forced observation pause');
  if (reflectionState !== REFLECTION_STATES.IDLE) return;
  setReflectionState(REFLECTION_STATES.COUNTDOWN);
  lastReflectionTime = Date.now();
  if (currentSession) { currentSession.lastReflectionTime = lastReflectionTime; try { chrome.storage.local.set({ currentSession: currentSession }); } catch (e) {} }
  showMidSessionReflection(intention);
}

function showMidSessionReflection(intention) {
  resetReflectionState();
  setReflectionState(REFLECTION_STATES.REFLECTION_ACTIVE);
  lastReflectionTime = Date.now();
  if (currentSession) { currentSession.lastReflectionTime = lastReflectionTime; try { chrome.storage.local.set({ currentSession: currentSession }); } catch (e) {} }
  pauseVideo();

  const overlay = document.createElement('div');
  overlay.className = 'reflection-overlay mid-session-reflection';
  overlay.style.pointerEvents = 'auto';
  document.body.appendChild(overlay);

  let phase = 'observe';

  const sessionData = (currentSession || {});
  const originalIntention = sessionData.originalIntention || sessionData.intention || intention || 'Explore a topic';
  const sessionGoal = sessionData.goal || '';
  const timeline = buildBehavioralStateTimeline(sessionData);
  const timelineHTML = renderStateTimeline(timeline, 'mid-session-timeline');
  const itemDelay = 0.5;
  const fadeDuration = 0.6;
  const timelineAnimationMs = Math.max(0, (timeline.length - 1) * itemDelay * 1000) + fadeDuration * 1000 + 800;
  const mirrorDuration = Math.max(7000, timelineAnimationMs);
  const observationDuration = 6000;

  const mirrorHTML = getMirrorHTML();

  function getMirrorHTML() {
    return '<div class="mirror-phase">' +
      '<div class="mirror-header fade-in">Your session so far</div>' +
      '<div class="original-intention fade-in">' +
      '<div class="intention-label">Original Intention</div>' +
      '<div class="intention-value">' + originalIntention + '</div>' +
      (sessionGoal ? '<div class="intention-goal">Goal: ' + sessionGoal + '</div>' : '') +
      '</div>' +
      '<div class="mirror-pathway-label fade-in">Behavioral pathway</div>' +
      timelineHTML +
      '</div>';
  }

  function getReflectionHTML() {
    return '<div class="reflection-phase fade-in">' +
      '<div class="reflection-phase-question">Looking at your session, which best describes what happened?</div>' +
      '<div class="reflection-options">' +
      '<button class="reflection-option-btn" data-reflection="still-pursuing">I am still pursuing my original goal</button>' +
      '<button class="reflection-option-btn" data-reflection="intentionally-changed">I intentionally changed direction</button>' +
      '<button class="reflection-option-btn" data-reflection="drifted">I gradually drifted without realizing it</button>' +
      '</div>' +
      '</div>';
  }

  function getDecisionHTML() {
    return '<div class="decision-phase fade-in">' +
      '<div class="decision-phase-question">What would you like to do?</div>' +
      '<div class="decision-options">' +
      '<button class="decision-btn primary" data-action="continue-original">Continue</button>' +
      '<button class="decision-btn secondary" data-action="change-intention">Change Intention</button>' +
      '<button class="decision-btn secondary" data-action="end-session">End Session</button>' +
      '</div>' +
      '</div>';
  }

  function render() {
    if (phase === 'observe') {
      overlay.innerHTML = '<div class="observe-phase">' +
        '<div class="observe-title">Let&#39;s look at how this session has evolved.</div>' +
        '<div class="observe-subtitle">Pause and notice what you planned to do versus what you are doing now.</div>' +
        '</div>';
      setTimeout(function() { phase = 'mirror'; render(); }, observationDuration);
    } else if (phase === 'mirror') {
      overlay.innerHTML = '<div class="mirror-container">' + mirrorHTML + '</div>';
      setTimeout(function() { phase = 'reflect'; render(); }, mirrorDuration);
    } else if (phase === 'reflect') {
      overlay.innerHTML = '<div class="mirror-container">' + mirrorHTML + getReflectionHTML() + '</div>';
      bindReflectionButtons();
    } else if (phase === 'decide') {
      overlay.innerHTML = '<div class="mirror-container">' + mirrorHTML + getDecisionHTML() + '</div>';
      bindDecisionButtons();
    }
  }

  function bindReflectionButtons() {
    overlay.querySelectorAll('.reflection-option-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var reflection = btn.dataset.reflection;
        safeSendMessage({ action: 'storeSelfAssessment', data: { reason: reflection } });
        recordPathwayEvent('reflection_checkpoint', { reason: reflection });
        phase = 'decide';
        render();
      });
    });
  }

  function bindDecisionButtons() {
    overlay.querySelectorAll('.decision-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var action = btn.dataset.action;
        safeSendMessage({ action: 'storeConfirmationDecision', data: { action: action } });
        overlay.remove();
        resumeVideo();
        resetReflectionState();
        if (action === 'continue-original') {
          checkpointCount++;
          lastReflectionTime = Date.now();
          if (currentSession) { currentSession.lastReflectionTime = lastReflectionTime; try { chrome.storage.local.set({ currentSession: currentSession }); } catch (e) {} }
          startInterventionTimer(true);
        } else if (action === 'change-intention') {
          showIntentionUpdateScreen();
        } else if (action === 'end-session') {
          endCurrentSession();
        }
      });
    });
  }

  render();
}

function showIntentionUpdateScreen() {
  var updateHTML = '<div class="update-content"><h2>Update your intention</h2><p>What are you hoping to do now?</p><div class="intention-options">' +
    '<button class="update-btn" data-intention="Find a specific video">Find a specific video</button>' +
    '<button class="update-btn" data-intention="Learn something">Learn something</button>' +
    '<button class="update-btn" data-intention="Relax / Be entertained">Relax / Be entertained</button>' +
    '<button class="update-btn" data-intention="Explore a topic">Explore a topic</button></div></div>';
  const overlay = document.createElement('div');
  overlay.className = 'intention-update-screen';
  overlay.style.pointerEvents = 'auto';
  overlay.innerHTML = updateHTML;
  document.body.appendChild(overlay);
  overlay.querySelectorAll('.update-btn').forEach(function(btn) {
    btn.addEventListener('click', async function() {
      var newIntention = btn.dataset.intention;
      if (currentSession) {
        currentSession.intention = newIntention;
        // Update originalIntention as well so the alignment engine and saved session
        // reflect the new active intent mode, not just the first-chosen intent.
        currentSession.originalIntention = newIntention;
      }
      // Persist the new intent before the overlay closes. The next SPA page load
      // re-reads currentSession from storage, so we must wait for the background
      // to finish writing it; otherwise the stale pre-change intent is reloaded.
      await safeSendMessage({ action: 'updateSessionIntention', data: { intention: newIntention } });
      calculateIntentAlignment();
      recordPathwayEvent('intention_change', { newIntention: newIntention });
      applyVisualDrift();
      updateDebugPanel();
      overlay.remove();
    });
  });
}

function endCurrentSession() {
  recordPathwayEvent('session_end', {});
  removeVisualDrift();
  if (decayTimerId) { clearInterval(decayTimerId); decayTimerId = null; }
  if (interventionTimer) { clearInterval(interventionTimer); interventionTimer = null; }
  showExitReflection();
}

// ============================================================
// SESSION FLOW & INITIALIZATION
// ============================================================

async function initializeContentScript() {
  hasShownCheckpoint = false;
  pageLoadTime = Date.now();
  var data = await chrome.storage.local.get(['settings', 'currentSession', 'pendingReflection', 'pendingIntentCheckpoint']);
  settings = data.settings || {};
  currentSession = data.currentSession;
  if (DEBUG_MODE) console.log('[Intentional YouTube] Loaded settings:', settings, 'hasCompletedOnboarding:', settings.hasCompletedOnboarding);
  applyInterfaceChanges();
  if (!settings.hasCompletedOnboarding) {
    showOnboardingReminder();
  } else {
    // Check if there's a pending reflection from a previous auto-ended session
    if (data.pendingReflection) {
      showReturnReflection(data.pendingReflection);
    } else if (currentSession) { resumeSession(); }
    else {
      // No active session — show intent checkpoint on any YouTube page
      if (data.pendingIntentCheckpoint) chrome.storage.local.remove('pendingIntentCheckpoint').catch(() => {});
      setTimeout(function() { showIntentCheckpoint(); }, 800);
    }
  }
  setupExitDetection();
  setupBehaviorTracking();
  createSettingsButton();
  if (DEBUG_MODE) createDebugPanel();
  setupBlurThumbnailsObserver();
  setupAutoplayIndicatorObserver();
}

async function handlePageLoad() {
  pageLoadTime = Date.now();
  var data = await chrome.storage.local.get(['settings', 'currentSession', 'pendingReflection', 'pendingIntentCheckpoint']);
  settings = data.settings || {};
  currentSession = data.currentSession;
  applyInterfaceChanges();
  setupBlurThumbnailsObserver();
  setupAutoplayIndicatorObserver();
  if (settings.hasCompletedOnboarding) {
    if (data.pendingReflection) {
      showReturnReflection(data.pendingReflection);
    } else if (currentSession) { resumeSession(); }
    else {
      // No active session on SPA navigation — show intent checkpoint
      if (data.pendingIntentCheckpoint) chrome.storage.local.remove('pendingIntentCheckpoint').catch(() => {});
      isInitialPageLoad = false;
      document.querySelectorAll('.modal, .intentional-modal').forEach(function(el) { el.remove(); });
      showIntentCheckpoint();
    }
  }
}

function showOnboardingReminder() {
  var modal = createModal(
    '<div class="onboarding-reminder"><h2>Welcome to Intentional YouTube</h2>' +
    '<p>Please complete the setup to continue.</p>' +
    '<button class="primary-button onboarding-settings-btn">Open Settings</button></div>'
  );
  document.body.appendChild(modal);
  modal.querySelector('.onboarding-settings-btn').addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    modal.remove();
    try {
      if (chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' }).catch(function() { window.open(chrome.runtime.getURL('options.html'), '_blank'); });
      } else { window.open(chrome.runtime.getURL('options.html'), '_blank'); }
    } catch (e) { window.open(chrome.runtime.getURL('options.html'), '_blank'); }
  });
}

function showIntentCheckpoint() {
  if (!settings.hasCompletedOnboarding) return;
  if (hasShownCheckpoint && Date.now() - pageLoadTime < 5000) return;
  document.querySelectorAll('.modal, .intentional-modal, .return-overlay').forEach(function(el) { el.remove(); });
  pauseVideo();

  var modal = createModal(
    '<div class="intent-checkpoint"><h2>Which option best matches why you\'re opening YouTube right now?</h2>' +
    '<p class="intent-helper">Choose the option that best matches your current goal. It doesn\'t have to be perfect\u2014you can always change it later.</p>' +
    '<div class="intention-options">' +
    '<button class="intention-btn" data-intention="Find a specific video">Find a specific video</button>' +
    '<button class="intention-btn" data-intention="Learn something">Learn something</button>' +
    '<button class="intention-btn" data-intention="Relax / Be entertained">Relax / Be entertained</button>' +
    '<button class="intention-btn" data-intention="Explore a topic">Explore a topic</button>' +
    '</div></div>'
  );
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) {
    var btn = e.target.closest('.intention-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    var intention = btn.dataset.intention;
    modal.remove();
    hasShownCheckpoint = true;
    document.querySelectorAll('.modal, .intentional-modal').forEach(function(el) { el.remove(); });
    showGoalPrompt(intention);
  });
}

function showGoalPrompt(intention) {
  var modal = createModal(
    '<div class="intent-checkpoint"><h2>What do you hope to accomplish or explore?</h2>' +
    '<p>Optional — you can skip this if you prefer.</p>' +
    '<input type="text" class="goal-input" placeholder="e.g. Calculus, Guitar, Build a PC..." maxlength="100" />' +
    '<div class="goal-actions">' +
    '<button class="primary-button goal-submit-btn">Continue</button>' +
    '<button class="secondary-button goal-skip-btn">Skip</button></div></div>'
  );
  document.body.appendChild(modal);
  var input = modal.querySelector('.goal-input');
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); modal.remove(); beginSession(intention, input.value.trim()); } });
  modal.querySelector('.goal-submit-btn').addEventListener('click', function() { modal.remove(); beginSession(intention, input.value.trim()); });
  modal.querySelector('.goal-skip-btn').addEventListener('click', function() { modal.remove(); beginSession(intention, ''); });
  setTimeout(function() { input.focus(); }, 100);
}

function beginSession(intention, goal) {
  setTimeout(function() {
    startSession(intention, goal).catch(function(error) { console.error('[Session] Error:', error); });
  }, 50);
}

async function startSession(intention, goal) {
  if (!intention) intention = 'Explore a topic';
  try {
    var response = await safeSendMessage({ action: 'startSession', data: { intention: intention, goal: goal || '' } });
    if (DEBUG_MODE) console.log('[Intentional YouTube] startSession response:', response);
    if (response && response.success) {
      var storageData = await chrome.storage.local.get(['currentSession']);
      currentSession = storageData.currentSession || { id: response.sessionId, intention: intention, originalIntention: intention, goal: goal || '', startTime: Date.now() };
    } else {
      if (DEBUG_MODE) console.warn('[Intentional YouTube] Background did not start session; starting local session');
      currentSession = { id: 'local-' + Date.now(), intention: intention, originalIntention: intention, goal: goal || '', startTime: Date.now() };
    }
    if (currentSession) {
      lastReflectionTime = 0;
      currentSession.lastReflectionTime = 0;
      try { await chrome.storage.local.set({ currentSession: currentSession }); } catch (e) {}
      resetBehavioralState();
      recordPathwayEvent('session_start', { intention: intention, goal: goal || '' });
      startInterventionTimer(true);
      startDecayTimer();
    } else if (DEBUG_MODE) {
      console.warn('[Intentional YouTube] startSession failed; currentSession not set');
    }
  } catch (error) { console.error('[Session] Extension context error:', error); }
}

function resumeSession() {
  startInterventionTimer();
  startDecayTimer();
  if (DEBUG_MODE) createDebugPanel();
}

function startInterventionTimer(forceRestart) {
  var intervalMs = (parseInt(settings.reflectionInterval) || 15) * 60 * 1000;
  if (currentSession && currentSession.lastReflectionTime) lastReflectionTime = currentSession.lastReflectionTime;
  if (typeof lastReflectionTime !== 'number' || isNaN(lastReflectionTime)) lastReflectionTime = 0;
  if (DEBUG_MODE) console.log('[Intentional YouTube] Timer interval:', intervalMs / 60000, 'min | currentSession:', !!currentSession, '| lastReflectionTime:', lastReflectionTime);
  // Restart if the interval changed in settings, even on SPA navigations
  if (interventionTimer && !forceRestart && currentInterventionInterval === intervalMs) return;
  if (interventionTimer) clearInterval(interventionTimer);
  currentInterventionInterval = intervalMs;
  updateDebugPanel();
  interventionTimer = setInterval(function() {
    var elapsed = Date.now() - lastReflectionTime;
    if (DEBUG_MODE) console.log('[Intentional YouTube] Timer tick | currentSession:', !!currentSession, '| elapsed since reflection:', elapsed / 60000, 'min');
    updateDebugPanel();
    if (!isContextValid()) { killAllTimers(); return; }
    if (currentSession && elapsed >= intervalMs && elapsed >= REFLECTION_COOLDOWN_MS) {
      var intention = currentSession.originalIntention || currentSession.intention || 'Explore a topic';
      if (DEBUG_MODE) console.log('[Intentional YouTube] Reflection interval reached; showing forced pause');
      showForcedObservationPause(intention);
    }
  }, 10000);
}

function startDecayTimer() {
  if (decayTimerId) clearInterval(decayTimerId);
  decayTimerId = setInterval(function() {
    if (!isContextValid()) { killAllTimers(); return; }
    // Keep timeSinceLastSearch and time-since-last-intentional-interaction current between events
    if (behavioralMetrics.lastSearchTime > 0) {
      behavioralMetrics.timeSinceLastSearch = Date.now() - behavioralMetrics.lastSearchTime;
    }
    if (behavioralMetrics.lastIntentionalInteractionTime > 0) {
      // Not stored as a metric; recalculated on demand in calculateIntentAlignment
    }
    // Apply a small sustainedViewing boost every decay tick while a video is actively playing,
    // so confidence doesn't crater in the 30s gap between video_duration events.
    // Autoplay-driven viewing is treated as passive consumption, not sustained engagement.
    if (!isAdPlaying()) {
      var vid = document.querySelector('video');
      if (vid && !vid.paused && vid.currentTime > 0) {
        // intensity = 5s / 30s = 0.167 per tick — equivalent to one 30s tick spread across 6 decay cycles
        if (behavioralMetrics.isCurrentVideoAutoplay) {
          updateConfidenceScoresPassiveViewing(DECAY_INTERVAL_MS / 30000);
        } else {
          updateConfidenceScores('sustainedViewing', DECAY_INTERVAL_MS / 30000);
          behavioralMetrics.intentionalSustainedViewingTime += DECAY_INTERVAL_MS;
          // Only intentional viewing resets the idle timer and scroll streak.
          // Also reset consecutiveRecommendations so the chain-entry penalty clears on recovery.
          behavioralMetrics.homepageScrollStreak = 0;
          behavioralMetrics.lastIntentionalInteractionTime = Date.now();
          // consecutiveRecommendations decays naturally via applyScoreDecay (90%/tick).
          // Hard-zeroing it here would destroy the Explore intent's rec-following bonus
          // within the first intentional-viewing tick after clicking a recommendation.
          // Gradually lift the autoplay cap during intentional viewing.
          if (autoplayCap < 100) autoplayCap = Math.min(100, autoplayCap + AUTOPLAY_CAP_RECOVERY_PER_TICK);
        }
        behavioralMetrics.sustainedViewingTime += DECAY_INTERVAL_MS;
      }
    }
    applyScoreDecay();
    if (stateTransitionCooldown > 0) stateTransitionCooldown--;
    updateBehavioralState();
    calculateIntentAlignment();
    applyVisualDrift();
    updateDebugPanel();
  }, DECAY_INTERVAL_MS);
}

function resetBehavioralState() {
  currentState = BEHAVIORAL_STATES.CASUAL_EXPLORATION;
  stateConfidence = { 'Goal-Oriented Search': 20, 'Sustained Engagement': 20, 'Casual Exploration': 20, 'Recommendation Loop': 20, 'Passive Consumption': 20 };
  dominantStateHistory = [];
  stateTransitionCooldown = 0;
  behavioralStateHistory = [];
  intentAlignmentScore = 100;
  driftEvents = [];
  behavioralMetrics = { searchEvents: 0, homepageVisits: 0, homepageScrollEvents: 0, homepageScrollStreak: 0, lastIntentionalInteractionTime: 0, recommendationClicks: 0, autoplayTransitions: 0, autoplayCount: 0, videoSwitches: 0, scrollEvents: 0, timeSinceLastSearch: 0, consecutiveRecommendations: 0, videoWatchDurations: [], lastSearchTime: 0, sustainedViewingTime: 0, intentionalSustainedViewingTime: 0, isCurrentVideoAutoplay: false, isCurrentVideoFromRecommendation: false, lastVideoChangeWasManual: false, rapidSwitchCount: 0, lastVideoSwitchTime: 0 };
  autoplayCap = 100;
  driftMemory = 0;
  sessionPathway = [];
  forkPoints = [];
  recoveryEvents = [];
  lastForkPoint = null;
  lastRecoveryEvent = null;
  lastReflectionTime = 0;
  lastTrackedUrl = location.href;
  lastVideoSrc = '';
  lastVideoDurationCheck = 0;
  lastVideoDurationTime = 0;
  lastShortsId = location.href.includes('/shorts/') ? location.href : '';
}

function buildReturnTimelineEvents(pathway, startTime) {
  if (!pathway || pathway.length === 0) return [];
  var visibleTypes = ['session_start', 'state_transition', 'fork_point', 'recovery', 'search', 'recommendation', 'homepage', 'autoplay', 'intention_change', 'session_end'];
  var filtered = pathway.filter(function(p) { return visibleTypes.indexOf(p.type) !== -1; });
  filtered.sort(function(a, b) { return a.timestamp - b.timestamp; });

  // Consolidate consecutive same-type events (e.g. multiple recommendations)
  var consolidated = [];
  for (var i = 0; i < filtered.length; i++) {
    var evt = filtered[i];
    var prev = consolidated.length > 0 ? consolidated[consolidated.length - 1] : null;
    if (prev && prev.type === evt.type && evt.type !== 'state_transition' && evt.type !== 'session_start' && evt.type !== 'fork_point' && evt.type !== 'recovery' && evt.type !== 'intention_change' && evt.type !== 'session_end') {
      prev.count = (prev.count || 1) + 1;
      prev.lastTimestamp = evt.timestamp;
    } else {
      consolidated.push({ type: evt.type, timestamp: evt.timestamp, count: 1, state: evt.state, newState: evt.newState, previousState: evt.previousState, alignment: evt.alignment, reason: evt.reason, newIntention: evt.newIntention });
    }
  }

  // Map to display items
  var eventLabels = {
    'session_start': 'Session started',
    'session_end': 'Session ended',
    'search': 'Searched',
    'recommendation': 'Clicked recommendation',
    'homepage': 'Visited homepage',
    'autoplay': 'Autoplay transition',
    'intention_change': 'Intention updated'
  };
  var eventIcons = {
    'session_start': '\u25B6',
    'session_end': '\u25A0',
    'state_transition': '\u25CF',
    'fork_point': '\u2935',
    'recovery': '\u21A9',
    'search': '\uD83D\uDD0D',
    'recommendation': '\u25B8',
    'homepage': '\uD83C\uDFE0',
    'autoplay': '\u25B6\u25B6',
    'intention_change': '\u270E'
  };
  var eventKinds = {
    'fork_point': 'fork',
    'recovery': 'recovery',
    'state_transition': 'state',
    'session_start': 'start',
    'session_end': 'end',
    'intention_change': 'intention_change'
  };

  return consolidated.map(function(evt) {
    var elapsed = startTime ? Math.round((evt.timestamp - startTime) / 60000) : 0;
    var kind = eventKinds[evt.type] || 'action';
    var label = '';
    if (evt.type === 'state_transition') {
      label = (evt.previousState || '?') + ' \u2192 ' + (evt.newState || evt.state || '?');
    } else if (evt.type === 'fork_point') {
      label = 'Attention shifted: ' + (evt.previousState || '?') + ' \u2192 ' + (evt.newState || '?');
    } else if (evt.type === 'recovery') {
      label = evt.reason || 'Returned toward intention';
    } else if (evt.type === 'intention_change') {
      label = (eventLabels[evt.type] || 'Intention updated') + (evt.newIntention ? ': ' + evt.newIntention : '');
    } else {
      label = eventLabels[evt.type] || evt.type;
    }
    if (evt.count > 1) label += ' (\u00D7' + evt.count + ')';
    return { kind: kind, label: label, icon: eventIcons[evt.type] || '\u25CF', elapsed: elapsed, alignment: evt.alignment };
  });
}

function showReturnReflection(pending) {
  document.querySelectorAll('.modal, .intentional-modal, .return-overlay').forEach(function(el) { el.remove(); });
  pauseVideo();

  var intention = pending.intention || 'Explore a topic';
  var goal = pending.goal || '';
  var durationStr = pending.duration ? formatTimeSpent(pending.duration) : 'unknown';
  var finalState = pending.finalState || 'Unknown';
  var finalAlignment = pending.finalAlignment != null ? pending.finalAlignment : null;
  var pathway = pending.pathway || [];
  var startTime = pending.startTime || 0;

  // Build timeline events from full pathway
  var timelineEvents = buildReturnTimelineEvents(pathway, startTime);

  var timelineHTML = '';
  if (timelineEvents.length > 0) {
    timelineHTML = '<div class="return-timeline">';
    timelineEvents.forEach(function(item, i) {
      var isLast = i === timelineEvents.length - 1;
      var kindClass = 'return-tl-' + item.kind;
      timelineHTML += '<div class="return-tl-step ' + kindClass + (isLast ? ' last' : '') + '">' +
        '<span class="return-tl-rail"><span class="return-tl-dot"></span></span>' +
        '<div class="return-tl-body">' +
        '<span class="return-tl-label">' + item.label + '</span>' +
        '<span class="return-tl-time">' + humanizeDuration(item.elapsed) + ' in</span>' +
        '</div>' +
        '</div>';
    });
    timelineHTML += '</div>';
  }

  // Alignment badge
  var alignBadge = '';
  if (finalAlignment != null) {
    var ac = finalAlignment >= 70 ? 'high' : finalAlignment >= 40 ? 'medium' : 'low';
    alignBadge = '<div class="return-metric"><span class="return-metric-label">Final Intent Alignment</span><span class="return-metric-value alignment-score ' + ac + '">' + finalAlignment + '%</span></div>';
  }

  // Build overlay
  var overlay = document.createElement('div');
  overlay.className = 'return-overlay';
  overlay.innerHTML =
    '<div class="return-panel">' +
    '<h2>Welcome back!</h2>' +
    '<p class="return-subtitle">Here\u2019s a quick look at your last session.</p>' +
    '<div class="return-summary">' +
    '<div class="return-metric"><span class="return-metric-label">Intention</span><span class="return-metric-value">' + intention + '</span></div>' +
    (goal ? '<div class="return-metric"><span class="return-metric-label">Goal</span><span class="return-metric-value return-goal">' + goal + '</span></div>' : '') +
    '<div class="return-metric"><span class="return-metric-label">Duration</span><span class="return-metric-value">' + durationStr + '</span></div>' +
    '<div class="return-metric"><span class="return-metric-label">Final State</span><span class="return-metric-value">' + finalState + '</span></div>' +
    alignBadge +
    '</div>' +
    (timelineHTML ? '<div class="return-section-label">Session pathway</div>' + timelineHTML : '') +
    '<div class="return-question-section"><p class="return-question-text">Looking back, which best describes that session?</p><div class="return-options">' +
    '<button class="return-opt-btn" data-description="stayed-on-path">I stayed on my intended path</button>' +
    '<button class="return-opt-btn" data-description="intentionally-changed">I intentionally changed direction</button>' +
    '<button class="return-opt-btn" data-description="drifted">I gradually drifted</button>' +
    '<button class="return-opt-btn" data-description="dont-remember">I don\u2019t remember the session well enough</button>' +
    '</div></div>' +
    '<div class="return-question-section"><p class="return-question-text">How satisfied did you feel?</p><div class="return-satisfaction">' +
    '<button class="return-sat-btn" data-satisfaction="1">1</button><button class="return-sat-btn" data-satisfaction="2">2</button>' +
    '<button class="return-sat-btn" data-satisfaction="3">3</button><button class="return-sat-btn" data-satisfaction="4">4</button>' +
    '<button class="return-sat-btn" data-satisfaction="5">5</button></div>' +
    '<p class="return-sat-labels">Not satisfied ... Very satisfied</p></div>' +
    '<div class="return-actions">' +
    '<button class="return-submit-btn" disabled>Submit reflection</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  var reflectionData = { description: null, satisfaction: null };
  overlay.querySelectorAll('.return-opt-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      overlay.querySelectorAll('.return-opt-btn').forEach(function(b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      reflectionData.description = btn.dataset.description;
      checkReturnComplete();
    });
  });
  overlay.querySelectorAll('.return-sat-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      overlay.querySelectorAll('.return-sat-btn').forEach(function(b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      reflectionData.satisfaction = parseInt(btn.dataset.satisfaction);
      checkReturnComplete();
    });
  });
  function checkReturnComplete() {
    var submitBtn = overlay.querySelector('.return-submit-btn');
    if (reflectionData.description && reflectionData.satisfaction) submitBtn.disabled = false;
  }
  overlay.querySelector('.return-submit-btn').addEventListener('click', async function() {
    var matchedIntention = reflectionData.description === 'stayed-on-path' ? 'Yes' : reflectionData.description === 'intentionally-changed' ? 'Partially' : reflectionData.description === 'dont-remember' ? null : 'No';
    await safeSendMessage({ action: 'updateAutoEndedSession', data: { sessionId: pending.sessionId, matchedIntention: matchedIntention, satisfaction: reflectionData.satisfaction } });
    await chrome.storage.local.remove('pendingReflection');
    overlay.remove();
    setTimeout(function() { showIntentCheckpoint(); }, 500);
  });
}

function showExitReflection() {
  pauseVideo();
  if (currentSession) {
    currentSession.forkPoints = forkPoints.slice();
    currentSession.recoveryEvents = recoveryEvents.slice();
    currentSession.pathway = sessionPathway.slice();
    try { chrome.storage.local.set({ currentSession: currentSession }); } catch (e) {}
  }

  const overlay = document.createElement('div');
  overlay.className = 'reflection-overlay end-session-reflection';
  overlay.style.pointerEvents = 'auto';
  document.body.appendChild(overlay);

  let phase = 'summary';
  const sessionData = currentSession || {};
  const originalIntention = sessionData.originalIntention || sessionData.intention || 'Explore a topic';
  const sessionGoal = sessionData.goal || '';
  const duration = sessionData.startTime ? Date.now() - sessionData.startTime : 0;
  const reflectionData = { modelAccuracy: null, sessionDescription: null, satisfaction: null, matchedIntention: null, actualActivity: null };
  const timeline = buildBehavioralStateTimeline(sessionData);
  const timelineHTML = renderStateTimeline(timeline, 'end-session-timeline');
  const itemDelay = 0.5;
  const fadeDuration = 0.6;
  const timelineAnimationMs = Math.max(0, (timeline.length - 1) * itemDelay * 1000) + fadeDuration * 1000 + 1000;
  const summaryDuration = Math.max(8000, timelineAnimationMs);

  const summaryHTML = getSummaryHTML();

  function getSummaryHTML() {
    const durationStr = formatTimeSpent(duration);
    return '<div class="debrief-summary">' +
      '<div class="debrief-title fade-in">Session Debrief</div>' +
      '<div class="original-intention fade-in">' +
      '<div class="intention-label">Original Intention</div>' +
      '<div class="intention-value">' + originalIntention + '</div>' +
      (sessionGoal ? '<div class="intention-goal">Goal: ' + sessionGoal + '</div>' : '') +
      '</div>' +
      '<div class="debrief-pathway-label fade-in">How your session evolved</div>' +
      timelineHTML +
      '<div class="debrief-final-metrics">' +
      '<div class="final-state fade-in"><span class="final-label">Final State</span><span class="final-value">' + currentState + '</span></div>' +
      '<div class="final-alignment fade-in"><span class="final-label">Final Alignment</span><span class="final-value alignment-score ' + (intentAlignmentScore >= 70 ? 'high' : intentAlignmentScore >= 40 ? 'medium' : 'low') + '">' + intentAlignmentScore + '%</span></div>' +
      '</div>' +
      '<div class="debrief-duration fade-in">Session duration: ' + durationStr + '</div>' +
      '</div>';
  }

  function getAccuracyHTML() {
    return '<div class="debrief-phase fade-in">' +
      '<div class="debrief-phase-question">How accurately does this summary reflect your experience?</div>' +
      '<div class="debrief-options">' +
      '<button class="debrief-option-btn" data-accuracy="very">Very accurate</button>' +
      '<button class="debrief-option-btn" data-accuracy="mostly">Mostly accurate</button>' +
      '<button class="debrief-option-btn" data-accuracy="somewhat">Somewhat accurate</button>' +
      '<button class="debrief-option-btn" data-accuracy="not">Not accurate</button>' +
      '</div>' +
      '</div>';
  }

  function getBehavioralReflectionHTML() {
    return '<div class="debrief-phase fade-in">' +
      '<div class="debrief-phase-question">Looking back, which statement best describes your session?</div>' +
      '<div class="debrief-options">' +
      '<button class="debrief-option-btn" data-description="stayed-focused">I stayed focused throughout</button>' +
      '<button class="debrief-option-btn" data-description="intentionally-changed">I intentionally changed what I wanted to watch</button>' +
      '<button class="debrief-option-btn" data-description="drifted">I gradually drifted</button>' +
      '<button class="debrief-option-btn" data-description="drifted-aware">I noticed myself drifting but continued anyway</button>' +
      '</div>' +
      '</div>';
  }

  function getSatisfactionHTML() {
    return '<div class="debrief-phase fade-in">' +
      '<div class="debrief-phase-question">How satisfied do you feel with this session?</div>' +
      '<div class="satisfaction-scale">' +
      '<button class="satisfaction-btn" data-satisfaction="1">1</button><button class="satisfaction-btn" data-satisfaction="2">2</button>' +
      '<button class="satisfaction-btn" data-satisfaction="3">3</button><button class="satisfaction-btn" data-satisfaction="4">4</button>' +
      '<button class="satisfaction-btn" data-satisfaction="5">5</button>' +
      '</div>' +
      '<p class="scale-labels">Not satisfied ... Very satisfied</p>' +
      '<button class="debrief-submit-btn" disabled>Submit reflection</button>' +
      '</div>';
  }

  function render() {
    if (phase === 'summary') {
      overlay.innerHTML = '<div class="debrief-container">' + summaryHTML + '</div>';
      setTimeout(function() { phase = 'accuracy'; render(); }, summaryDuration);
    } else if (phase === 'accuracy') {
      overlay.innerHTML = '<div class="debrief-container">' + summaryHTML + getAccuracyHTML() + '</div>';
      bindAccuracyButtons();
    } else if (phase === 'reflection') {
      overlay.innerHTML = '<div class="debrief-container">' + summaryHTML + getBehavioralReflectionHTML() + '</div>';
      bindReflectionButtons();
    } else if (phase === 'satisfaction') {
      overlay.innerHTML = '<div class="debrief-container">' + summaryHTML + getSatisfactionHTML() + '</div>';
      bindSatisfactionButtons();
    }
  }

  function bindAccuracyButtons() {
    overlay.querySelectorAll('.debrief-option-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        reflectionData.modelAccuracy = btn.dataset.accuracy;
        phase = 'reflection';
        render();
      });
    });
  }

  function bindReflectionButtons() {
    overlay.querySelectorAll('.debrief-option-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        reflectionData.sessionDescription = btn.dataset.description;
        phase = 'satisfaction';
        render();
      });
    });
  }

  function bindSatisfactionButtons() {
    overlay.querySelectorAll('.satisfaction-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        overlay.querySelectorAll('.satisfaction-btn').forEach(function(b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        reflectionData.satisfaction = parseInt(btn.dataset.satisfaction);
        checkSubmit();
      });
    });
    const submitBtn = overlay.querySelector('.debrief-submit-btn');
    if (submitBtn) submitBtn.addEventListener('click', submitReflection);
  }

  function checkSubmit() {
    const submitBtn = overlay.querySelector('.debrief-submit-btn');
    if (submitBtn && reflectionData.satisfaction) submitBtn.disabled = false;
  }

  function submitReflection() {
    reflectionData.matchedIntention = reflectionData.sessionDescription === 'stayed-focused' ? 'Yes' : reflectionData.sessionDescription === 'intentionally-changed' ? 'Partially' : 'No';
    reflectionData.actualActivity = reflectionData.sessionDescription === 'stayed-focused' ? 'What I intended' : reflectionData.sessionDescription === 'intentionally-changed' ? 'Something else' : 'I lost track of time';
    safeSendMessage({ action: 'endSession', data: reflectionData });
    currentSession = null; checkpointCount = 0;
    if (interventionTimer) { clearInterval(interventionTimer); interventionTimer = null; }
    if (decayTimerId) { clearInterval(decayTimerId); decayTimerId = null; }
    removeVisualDrift(); overlay.remove(); resumeVideo(); showThankYouMessage();
  }

  render();
}

function showThankYouMessage() {
  var modal = createModal('<div class="thank-you"><h2>Thank you for your reflection</h2><p>Your responses have been saved.</p><p>Every moment of awareness helps build more intentional habits.</p><button class="primary-button close-thankyou-btn">End Session</button></div>');
  document.body.appendChild(modal);
  modal.querySelector('.close-thankyou-btn').addEventListener('click', function() { 
    modal.remove(); 
    // Close the YouTube tab using chrome.tabs API
    if (chrome.runtime && chrome.runtime.id && chrome.tabs) {
      chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        if (tabs[0]) {
          chrome.tabs.remove(tabs[0].id);
        }
      });
    } else {
      // Fallback: navigate away from YouTube
      window.location.href = 'about:blank';
    }
  });
}

// ============================================================
// BEHAVIOR DETECTION SETUP
// ============================================================

function setupBehaviorTracking() {
  lastTrackedUrl = location.href;
  new MutationObserver(function() {
    if (!isContextValid()) return;
    var url = location.href;
    if (url !== lastTrackedUrl) {
      var prevUrl = lastTrackedUrl;
      lastTrackedUrl = url;
      if (url.includes('/results')) trackBehavioralEvent('search');
      else if (url === 'https://www.youtube.com/' || url === 'https://www.youtube.com') { behavioralMetrics.lastVideoChangeWasManual = true; trackBehavioralEvent('homepage'); }
      else if ((url.includes('/watch') && prevUrl.includes('/watch')) || (url.includes('/shorts/') && prevUrl.includes('/shorts/'))) { trackBehavioralEvent('video_switch'); }
      if (isReflectionLocked() || reflectionState !== REFLECTION_STATES.IDLE) {
        resetReflectionState();
        document.querySelectorAll('.self-assessment-screen, .confirmation-screen, .forced-observation-pause, .intention-update-screen').forEach(function(el) { el.remove(); });
      }
      handlePageLoad();
    }
  }).observe(document, { subtree: true, childList: true });
  var scrollTimeout;
  window.addEventListener('scroll', function() { clearTimeout(scrollTimeout); scrollTimeout = setTimeout(function() { trackBehavioralEvent('scroll'); }, 500); }, { passive: true });
  var lastTimestampVideo = null;
  var lastTimestampUpdate = 0;
  function onVideoTimeUpdate() {
    // Refresh the debug-panel time counters directly from the playing video so they
    // keep advancing even when the JS timer that drives metrics is throttled.
    var now = Date.now();
    if (now - lastTimestampUpdate < 1000) return;
    lastTimestampUpdate = now;
    updateDebugPanel();
  }
  setInterval(function() {
    if (!isContextValid()) return;
    var video = document.querySelector('video');
    if (!video) { lastVideoDurationCheck = 0; lastVideoDurationTime = 0; return; }
    if (video !== lastTimestampVideo) {
      if (lastTimestampVideo) lastTimestampVideo.removeEventListener('timeupdate', onVideoTimeUpdate);
      video.addEventListener('timeupdate', onVideoTimeUpdate);
      lastTimestampVideo = video;
    }
    if (isAdPlaying()) { lastVideoDurationCheck = 0; lastVideoDurationTime = 0; return; }
    var currentTime = video.currentTime;
    if (video.paused || currentTime <= 0) { lastVideoDurationCheck = 0; lastVideoDurationTime = 0; return; }
    var now = Date.now();
    var duration = 0;
    if (lastVideoDurationCheck > 0 && currentTime > lastVideoDurationCheck && lastVideoDurationTime > 0) {
      // Use the smaller of wall-clock delta and playback delta to avoid over-counting during seeks/buffers
      var playbackDelta = (currentTime - lastVideoDurationCheck) * 1000;
      var wallDelta = now - lastVideoDurationTime;
      duration = Math.min(playbackDelta, wallDelta);
    } else {
      duration = 1000; // First check after play: assume ~1 second since the interval is 1 second
    }
    if (duration > 0) trackBehavioralEvent('video_duration', { duration: duration });
    lastVideoDurationCheck = currentTime;
    lastVideoDurationTime = now;
  }, 1000);
  setInterval(function() {
    if (!isContextValid()) return;
    if (isAdPlaying()) return;
    var video = document.querySelector('video');
    if (video && video.src !== lastVideoSrc) {
      if (lastVideoSrc && video.src) {
        if (!behavioralMetrics.lastVideoChangeWasManual) {
          trackBehavioralEvent('autoplay');
        }
      }
      behavioralMetrics.lastVideoChangeWasManual = false;
      lastVideoSrc = video.src;
    }
  }, 5000);

  // Track actual recommendation clicks. This catches homepage and sidebar/end-screen
  // recommendations that the SPA URL watcher alone misses (e.g. homepage -> watch).
  document.addEventListener('click', function(e) {
    if (!isContextValid()) return;
    var link = e.target.closest('a[href*="/watch"], a[href*="/shorts/"], a[href*="/@"], a[href*="/channel/"]');
    if (!link) return;
    var href = link.getAttribute('href') || '';
    var isVideoLink = href.includes('/watch') || href.includes('/shorts/');
    var isChannelLink = href.includes('/@') || href.includes('/channel/');
    if (!isVideoLink && !isChannelLink) return;
    // Search results are intentional, not recommendations
    if (location.href.includes('/results')) return;
    // Channel clicks from homepage/feed count as recommendations
    if (isChannelLink && !location.href.includes('/watch') && !location.href.includes('/shorts/')) {
      trackBehavioralEvent('recommendation');
      return;
    }
    if (!isVideoLink) return;
    // On a watch page, only count sidebar/related/end-screen recommendations
    if (location.href.includes('/watch') || location.href.includes('/shorts/')) {
      var isRelated = !!link.closest('#secondary, #related, ytd-watch-next-secondary-results-renderer, ytd-compact-video-renderer, ytd-compact-playlist-renderer, ytd-compact-radio-renderer, ytd-compact-movie-renderer, ytd-compact-show-renderer, ytd-reel-item-renderer, ytd-shorts, .ytp-endscreen-content, .ytp-videowall-still, .ytp-ce-element, .ytp-ce-covering-overlay, .ytp-ce-covering-image, .ytp-ce-video-title');
      if (!isRelated) return;
      // Exclude the autoplay up-next countdown card: clicking it is an autoplay transition,
      // not a manual recommendation. The src-change detector handles it as autoplay.
      if (link.closest('.ytp-autonav-endscreen-upnext-container, .ytp-autonav-upnext')) return;
    }
    // At this point: homepage/feed recommendation or sidebar/end-screen recommendation
    trackBehavioralEvent('recommendation');
  }, true);

  // Mark player Next/Previous button clicks as manual so they are not misclassified as autoplay.
  document.addEventListener('click', function(e) {
    if (!isContextValid()) return;
    var btn = e.target.closest('.ytp-next-button, .ytp-prev-button');
    if (!btn) return;
    behavioralMetrics.lastVideoChangeWasManual = true;
    // Manual player advancement breaks the recommendation chain; the next video is
    // chosen by the player, not by an explicit sidebar recommendation click.
    behavioralMetrics.isCurrentVideoFromRecommendation = false;
  }, true);

  // Track Shorts scrolling (swipe-through) as recommendation events.
  // When the user scrolls through Shorts, the URL updates to a new /shorts/ ID.
  if (location.href.includes('/shorts/')) {
    lastShortsId = location.href;
  }
  setInterval(function() {
    if (!isContextValid()) return;
    var url = location.href;
    if (url.includes('/shorts/') && url !== lastShortsId && lastShortsId.includes('/shorts/')) {
      trackBehavioralEvent('recommendation', { passive: true });
      trackBehavioralEvent('video_switch');
    }
    lastShortsId = url;
  }, 1000);
}

// ============================================================
// INTERFACE CHANGES
// ============================================================

function applyInterfaceChanges() {
  if (DEBUG_MODE) console.log('[Intentional YouTube] Applying interface changes with settings:', settings);
  var existingStyle = document.getElementById('intentional-youtube-styles');
  if (existingStyle) existingStyle.remove();
  var style = document.createElement('style');
  style.id = 'intentional-youtube-styles';
  var css = '';
  if (settings.hideShorts) css += 'ytd-browse[page-subtype="home"] ytd-reel-shelf-renderer, ytd-browse[page-subtype="home"] ytd-rich-shelf-renderer[is-shorts], ytd-browse[page-subtype="home"] [is-shorts] { display: none !important; }';
  if (settings.hideHomepageRecs) css += 'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer { display: none !important; }';
  if (settings.hideSidebarRecs) css += '#secondary { display: none !important; }';
  if (settings.disableAutoplay) {
    css += '.ytp-autonav-toggle-button[aria-checked="true"] { position: relative !important; } .ytp-autonav-toggle-button[aria-checked="true"]::after { content: "Autoplay on"; position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%); font-size: 12px; font-weight: bold; color: white; background: #ff4444; padding: 2px 8px; border-radius: 4px; white-space: nowrap; z-index: 9999; }';
    try { injectAutoplayIndicator(); ensureAutoplayDisabled(); } catch (e) { if (DEBUG_MODE) console.warn('[Intentional YouTube] Autoplay indicator injection failed:', e); }
  } else { try { removeAutoplayIndicator(); } catch (e) {} }
  
  // Fix homepage topic chips overlapping with videos
  css += 'ytd-feed-filter-chip-bar, tp-yt-paper-tabs { margin-top: 16px !important; }';
  css += 'ytd-browse[page-subtype="home"] ytd-feed-filter-chip-bar { margin-bottom: 24px !important; }';
  
  // Ensure YouTube home button/logo icon is always visible
  css += 'ytd-masthead, #masthead, #masthead-container { filter: none !important; opacity: 1 !important; }';
  css += '#masthead #logo-icon, #masthead ytd-topbar-logo-renderer, #masthead a#logo, #masthead #logo { filter: none !important; opacity: 1 !important; visibility: visible !important; }';
  css += '#masthead yt-icon, #masthead .ytd-topbar-logo-renderer, #masthead svg { visibility: visible !important; opacity: 1 !important; }';
  css += 'ytd-masthead yt-icon-button#guide-button, ytd-masthead a#logo { filter: none !important; opacity: 1 !important; }';
  css += 'ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer { filter: none !important; opacity: 1 !important; visibility: visible !important; }';
  
  // Ensure video control icons are always visible
  css += '.ytp-chrome-controls, .ytp-button, .ytp-settings-button, .ytp-size-button, .ytp-fullscreen-button, .ytp-miniplayer-button, .ytp-subtitles-button, .ytp-right-controls, .ytp-left-controls { filter: none !important; opacity: 1 !important; visibility: visible !important; }';
  css += '.ytp-menuitem, .ytp-popup, .ytp-panel, .ytp-panel-menu { filter: none !important; opacity: 1 !important; visibility: visible !important; }';
  css += '.ytp-autonav-toggle-button, .ytp-autonav-toggle-button *, .ytp-autonav-toggle-container, .ytp-autonav-toggle-container * { filter: none !important; opacity: 1 !important; visibility: visible !important; }';
  css += '.ytp-play-button, .ytp-play-button *, .ytp-next-button, .ytp-next-button *, .ytp-prev-button, .ytp-prev-button * { filter: none !important; opacity: 1 !important; visibility: visible !important; }';
  
  style.textContent = css;
  document.head.appendChild(style);
}

// ============================================================
// BLUR THUMBNAILS
// ============================================================

var blurThumbnailObserver = null;
var blurThumbnailInterval = null;

const BLUR_THUMBNAIL_SELECTORS = [
  'ytd-thumbnail',
  'ytd-playlist-thumbnail',
  'ytd-grid-renderer ytd-thumbnail',
  '.yt-lockup-view-model__content-image',
  '.ytLockupViewModelContentImage',
  '.yt-thumbnail-view-model',
  '.ytThumbnailViewModel',
  '.yt-lockup-view-model',
  '.ytLockupViewModel',
  // Shorts thumbnails: modern lockup view model (homepage/search shelves) and legacy reel item renderer (channel Shorts tab)
  '.shortsLockupViewModelHostThumbnail',
  '.shortsLockupViewModelHostThumbnailParentContainer',
  'ytd-reel-item-renderer #thumbnail'
].join(', ');

function querySelectorAllWithShadow(selector, root) {
  root = root || document;
  var result = [];
  try {
    var nodes = root.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      result.push(nodes[i]);
    }
  } catch (e) {
    if (DEBUG_MODE) console.warn('[Intentional YouTube] querySelectorAllWithShadow failed:', e);
  }
  var allNodes = root.querySelectorAll('*');
  for (var i = 0; i < allNodes.length; i++) {
    if (allNodes[i].shadowRoot) {
      result = result.concat(querySelectorAllWithShadow(selector, allNodes[i].shadowRoot));
    }
  }
  return result;
}

function observeShadowRoots(observer, root) {
  root = root || document;
  try {
    var allNodes = root.querySelectorAll('*');
    for (var i = 0; i < allNodes.length; i++) {
      if (allNodes[i].shadowRoot) {
        observer.observe(allNodes[i].shadowRoot, { childList: true, subtree: true });
        observeShadowRoots(observer, allNodes[i].shadowRoot);
      }
    }
  } catch (e) {
    if (DEBUG_MODE) console.warn('[Intentional YouTube] observeShadowRoots failed:', e);
  }
}

function observeShadowRootsInNodes(observer, nodes) {
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (node.shadowRoot) {
      observer.observe(node.shadowRoot, { childList: true, subtree: true });
      observeShadowRoots(observer, node.shadowRoot);
    }
    if (node.querySelectorAll) {
      var children = node.querySelectorAll('*');
      for (var j = 0; j < children.length; j++) {
        if (children[j].shadowRoot) {
          observer.observe(children[j].shadowRoot, { childList: true, subtree: true });
          observeShadowRoots(observer, children[j].shadowRoot);
        }
      }
    }
  }
}

function ensureBlurThumbnailStyles() {
  var styleId = 'intentional-blur-thumbnail-styles';
  var existing = document.getElementById(styleId);
  if (existing) return existing;
  var style = document.createElement('style');
  style.id = styleId;
  var selectors = BLUR_THUMBNAIL_SELECTORS.split(',').map(function(s) { return 'html.intentional-blur-active ' + s.trim(); }).join(', ');
  var hoverSelectors = BLUR_THUMBNAIL_SELECTORS.split(',').map(function(s) { return 'html.intentional-blur-active ' + s.trim() + ':hover'; }).join(', ');
  style.textContent =
    selectors + ' { filter: blur(8px) !important; transition: filter 0.3s ease !important; }' +
    hoverSelectors + ' { filter: none !important; }';
  document.head.appendChild(style);
  if (DEBUG_MODE) console.log('[Intentional YouTube] Injected blur thumbnail styles');
  return style;
}

function removeBlurThumbnailStyles() {
  var existing = document.getElementById('intentional-blur-thumbnail-styles');
  if (existing) existing.remove();
}

function applyBlurThumbnails() {
  if (!settings || !settings.blurThumbnails) return;
  ensureBlurThumbnailStyles();
  if (!document.documentElement.classList.contains('intentional-blur-active')) {
    document.documentElement.classList.add('intentional-blur-active');
    if (DEBUG_MODE) console.log('[Intentional YouTube] Activated blur thumbnails on root element');
  }
  var elements = querySelectorAllWithShadow(BLUR_THUMBNAIL_SELECTORS);
  if (DEBUG_MODE) console.log('[Intentional YouTube] Blur targets found:', elements.length);
  elements.forEach(function(el) {
    if (el.dataset.intentionalBlurred) return;
    el.dataset.intentionalBlurred = 'true';
    el.style.setProperty('filter', 'blur(8px)', 'important');
    el.style.setProperty('transition', 'filter 0.3s ease', 'important');
    el.addEventListener('mouseenter', function() {
      if (settings.blurThumbnails) this.style.setProperty('filter', 'none', 'important');
      else this.style.removeProperty('filter');
    });
    el.addEventListener('mouseleave', function() {
      if (settings.blurThumbnails) this.style.setProperty('filter', 'blur(8px)', 'important');
      else this.style.removeProperty('filter');
    });
  });
}

function removeBlurThumbnails() {
  document.documentElement.classList.remove('intentional-blur-active');
  querySelectorAllWithShadow('[data-intentional-blurred]').forEach(function(el) {
    el.dataset.intentionalBlurred = '';
    el.style.removeProperty('filter');
    el.style.removeProperty('transition');
  });
}

function setupBlurThumbnailsObserver() {
  if (blurThumbnailObserver) {
    blurThumbnailObserver.disconnect();
    blurThumbnailObserver = null;
  }
  if (blurThumbnailInterval) {
    clearInterval(blurThumbnailInterval);
    blurThumbnailInterval = null;
  }
  if (settings && settings.blurThumbnails) {
    applyBlurThumbnails();
    setTimeout(applyBlurThumbnails, 1000);
    setTimeout(applyBlurThumbnails, 3000);
    blurThumbnailObserver = new MutationObserver(function(mutations) {
      if (!isContextValid()) return;
      var needsApply = false;
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length > 0) {
          needsApply = true;
          observeShadowRootsInNodes(blurThumbnailObserver, mutations[i].addedNodes);
        }
      }
      if (needsApply) applyBlurThumbnails();
    });
    blurThumbnailObserver.observe(document.body, { childList: true, subtree: true });
    observeShadowRoots(blurThumbnailObserver, document.body);
    blurThumbnailInterval = setInterval(function() {
      if (!isContextValid()) return;
      applyBlurThumbnails();
    }, 3000);
  } else {
    removeBlurThumbnails();
    removeBlurThumbnailStyles();
  }
}

function injectAutoplayIndicator() {
  var css = '.ytp-autonav-toggle-button[aria-checked="true"] { position: relative !important; } .ytp-autonav-toggle-button[aria-checked="true"]::after { content: "Autoplay on"; position: absolute; bottom: 28px; left: 50%; transform: translateX(-50%); font-size: 12px; font-weight: bold; color: white; background: #ff4444; padding: 2px 8px; border-radius: 4px; white-space: nowrap; z-index: 9999; }';
  var players = document.querySelectorAll('ytd-player');
  players.forEach(function(player) {
    if (!player.shadowRoot) return;
    injectStyleIntoShadowRoot(player.shadowRoot, css);
    var nested = player.shadowRoot.querySelectorAll('*');
    nested.forEach(function(el) { if (el.shadowRoot) injectStyleIntoShadowRoot(el.shadowRoot, css); });
  });
  if (DEBUG_MODE) console.log('[Intentional YouTube] Injected autoplay indicator into player shadow DOM(s)');
}

function injectStyleIntoShadowRoot(shadowRoot, css) {
  var existing = shadowRoot.getElementById('intentional-autoplay-indicator');
  if (existing) existing.remove();
  var style = document.createElement('style');
  style.id = 'intentional-autoplay-indicator';
  style.textContent = css;
  shadowRoot.appendChild(style);
}

function removeAutoplayIndicator() {
  document.querySelectorAll('ytd-player').forEach(function(player) {
    if (!player.shadowRoot) return;
    var existing = player.shadowRoot.getElementById('intentional-autoplay-indicator');
    if (existing) existing.remove();
    var nested = player.shadowRoot.querySelectorAll('*');
    nested.forEach(function(el) {
      if (el.shadowRoot) {
        var ex = el.shadowRoot.getElementById('intentional-autoplay-indicator');
        if (ex) ex.remove();
      }
    });
  });
}

function findAutoplayToggle(root) {
  if (!root) return null;
  var toggle = root.querySelector('.ytp-autonav-toggle-button');
  if (toggle) return toggle;
  var nested = root.querySelectorAll('*');
  for (var i = 0; i < nested.length; i++) {
    if (nested[i].shadowRoot) {
      toggle = findAutoplayToggle(nested[i].shadowRoot);
      if (toggle) return toggle;
    }
  }
  return null;
}

function ensureAutoplayDisabled() {
  if (!settings.disableAutoplay) return;
  var toggle = findAutoplayToggle(document);
  if (DEBUG_MODE) console.log('[Intentional YouTube] Autoplay toggle found:', !!toggle, 'state:', toggle ? toggle.getAttribute('aria-checked') : 'n/a');
  if (toggle && toggle.getAttribute('aria-checked') === 'true') {
    toggle.click();
    if (DEBUG_MODE) console.log('[Intentional YouTube] Clicked autoplay toggle off');
  }
}

var autoplayIndicatorObserver = null;

function setupAutoplayIndicatorObserver() {
  if (autoplayIndicatorObserver) { autoplayIndicatorObserver.disconnect(); autoplayIndicatorObserver = null; }
  if (!settings.disableAutoplay) return;
  autoplayIndicatorObserver = new MutationObserver(function() {
    if (!isContextValid()) return;
    var players = document.querySelectorAll('ytd-player');
    var needsInjection = true;
    players.forEach(function(player) {
      if (player.shadowRoot && player.shadowRoot.getElementById('intentional-autoplay-indicator')) needsInjection = false;
    });
    if (players.length === 0 || needsInjection) injectAutoplayIndicator();
    ensureAutoplayDisabled();
  });
  autoplayIndicatorObserver.observe(document.body, { childList: true, subtree: true });
}

function setupExitDetection() {
  // Show native "Leave site?" dialog when user tries to leave during a session
  window.addEventListener('beforeunload', function(e) {
    if (currentSession) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

function isAdPlaying() {
  var player = document.querySelector('.html5-video-player');
  if (!player) return false;
  return player.classList.contains('ad-showing') || !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-skip-button-container');
}

function createModal(content) {
  var modal = document.createElement('div');
  modal.className = 'intentional-modal';
  modal.innerHTML = '<div class="modal-overlay"></div><div class="modal-content">' + content + '</div>';
  modal.querySelector('.modal-overlay').addEventListener('click', function(e) { e.stopPropagation(); if (modal.querySelector('.reflection-message') || modal.querySelector('.thank-you')) modal.remove(); });
  return modal;
}

function formatTimeSpent(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) return '0 seconds';
  var seconds = Math.floor(ms / 1000);
  var minutes = Math.floor(seconds / 60);
  var hours = Math.floor(minutes / 60);
  if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
  if (minutes > 0) return minutes + 'm';
  return seconds + 's';
}

chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'local' && changes.settings) {
    var wasOnboarded = settings.hasCompletedOnboarding;
    settings = Object.assign({}, settings, changes.settings.newValue || {});
    applyInterfaceChanges();
    setupBlurThumbnailsObserver();
    setupAutoplayIndicatorObserver();
    if (currentSession) startInterventionTimer(true);
    // If onboarding just completed, dismiss onboarding modal and show intent checkpoint
    if (!wasOnboarded && settings.hasCompletedOnboarding && !currentSession) {
      document.querySelectorAll('.modal, .intentional-modal').forEach(function(el) { el.remove(); });
      setTimeout(function() { showIntentCheckpoint(); }, 500);
    }
  }
  if (area === 'local' && changes.currentSession) {
    currentSession = changes.currentSession.newValue;
    if (!currentSession) {
      if (interventionTimer) { clearInterval(interventionTimer); interventionTimer = null; }
      if (decayTimerId) { clearInterval(decayTimerId); decayTimerId = null; }
      currentInterventionInterval = null;
    } else if (!interventionTimer) {
      startInterventionTimer(true);
    }
    updateDebugPanel();
  }
});

document.addEventListener('visibilitychange', function() {
  if (document.hidden && isReflectionLocked()) { if (reflectionLockTimer) { clearInterval(reflectionLockTimer); reflectionLockTimer = null; } }
  else if (!document.hidden && isReflectionLocked() && !reflectionLockTimer && reflectionOverlay) { lockReflection(reflectionOverlay, function() {}); }
});
