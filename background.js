// Background service worker for Intentional YouTube
// Handles extension lifecycle, storage management, and tab monitoring

// Initialize default settings when extension is installed
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({
    settings: {
      usualPurpose: null,
      supportLevel: 'medium',
      hideShorts: false,
      hideHomepageRecs: false,
      hideSidebarRecs: false,
      disableAutoplay: false,
      blurThumbnails: false,
      reflectionInterval: 15, // minutes
      hasCompletedOnboarding: false
    },
    sessions: [],
    currentSession: null,
    reflectionResponses: [], // Store all reflection question responses
    reflectionMessages: [
      "Entertainment can be meaningful. The question is whether it is giving you what you hoped for.",
      "A moment of awareness can help you decide rather than continue automatically.",
      "Short-term enjoyment and long-term satisfaction are not always the same.",
      "The goal is not to remove fun, but to make your choices more intentional.",
      "Consider whether this time is aligning with what matters to you.",
      "You have the power to choose how you spend your attention.",
      "Small moments of reflection can lead to more intentional habits.",
      "Your time is valuable. Use it in ways that feel right to you."
    ],
    reflectionQuestions: {
      beforeBrowsing: [
        "What are you hoping to get from YouTube right now?",
        "How do you want to feel when you finish this session?",
        "What would make this session feel worthwhile?"
      ],
      duringBrowsing: [
        "You originally planned to:\n[user goal]\n\nIs your current activity still moving toward that goal?",
        "What are you looking for right now?",
        "Are you actively choosing this, or did you continue automatically?"
      ],
      endOfSession: [
        "Did this session give you what you were hoping for?",
        "What did you gain from this time?",
        "Would you make the same choice again?"
      ]
    }
  });
  
  console.log('Intentional YouTube extension installed');
});

// Monitor tab updates to detect YouTube navigation and leaving YouTube
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url) return;
  if (tab.url.includes('youtube.com')) {
    // Send message to content script to handle page load
    chrome.tabs.sendMessage(tabId, { action: 'pageLoaded' }).catch(() => {
      // Content script might not be loaded yet, which is fine
    });
  } else {
    // User navigated away from YouTube in this tab; end the session only if no YouTube tabs remain
    chrome.tabs.query({ url: '*://www.youtube.com/*' }).then(tabs => {
      if (tabs.length === 0) autoEndStaleSession();
    });
  }
});

// Auto-end stale sessions only when the last YouTube tab is closed
async function autoEndStaleSession() {
  const data = await chrome.storage.local.get(['currentSession', 'sessions']);
  if (data.currentSession && data.currentSession.startTime) {
    const session = {
      ...data.currentSession,
      endTime: Date.now(),
      duration: Date.now() - data.currentSession.startTime,
      matchedIntention: null,
      satisfaction: null,
      actualActivity: 'Session ended automatically (tab closed)',
      autoEnded: true
    };
    const sessions = data.sessions || [];
    sessions.push(session);
    // Store a pending reflection so the content script prompts on next visit.
    // Include behavioral summary data for the Welcome Back screen.
    await chrome.storage.local.set({
      sessions,
      currentSession: null,
      pendingReflection: {
        sessionId: session.id,
        intention: session.originalIntention || session.intention || 'Explore a topic',
        goal: session.goal || '',
        duration: session.duration,
        endTime: session.endTime,
        startTime: session.startTime,
        finalState: session.currentState || 'Casual Exploration',
        finalAlignment: session.intentAlignment != null ? session.intentAlignment : null,
        pathway: session.pathway || [],
        forkPoints: session.forkPoints || [],
        recoveryEvents: session.recoveryEvents || [],
        stateConfidence: session.stateConfidence || {}
      }
    });
    console.log('[Intentional YouTube] Auto-ended stale session:', session.id);
  }
}

// Monitor tab removal — end session if all YouTube tabs are gone
chrome.tabs.onRemoved.addListener(async () => {
  // Wait briefly so the removed tab is fully gone from chrome.tabs.query
  await new Promise(resolve => setTimeout(resolve, 500));
  const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
  if (tabs.length === 0) {
    await autoEndStaleSession();
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'autoEndSession') {
    autoEndStaleSession().then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'updateAutoEndedSession') {
    updateAutoEndedSession(request.data).then(sendResponse);
    return true;
  }

  if (request.action === 'startSession') {
    handleStartSession(request.data).then(sendResponse);
    return true; // Indicates async response
  }
  
  if (request.action === 'endSession') {
    handleEndSession(request.data).then(sendResponse);
    return true;
  }
  
  if (request.action === 'updateSession') {
    handleUpdateSession(request.data).then(sendResponse);
    return true;
  }
  
  if (request.action === 'getSettings') {
    getSettings().then(sendResponse);
    return true;
  }
  
  if (request.action === 'updateSettings') {
    updateSettings(request.data).then(sendResponse);
    return true;
  }
  
  if (request.action === 'getSessions') {
    getSessions().then(sendResponse);
    return true;
  }
  
  if (request.action === 'getReflectionMessage') {
    getReflectionMessage().then(sendResponse);
    return true;
  }
  
  if (request.action === 'openOptionsPage') {
    chrome.tabs.create({ url: 'options.html' });
    sendResponse({ success: true });
  }
  
  if (request.action === 'saveReflectionResponse') {
    saveReflectionResponse(request.data).then(sendResponse);
    return true;
  }
  
  if (request.action === 'getReflectionResponses') {
    getReflectionResponses().then(sendResponse);
    return true;
  }
  
  if (request.action === 'getReflectionQuestions') {
    getReflectionQuestions().then(sendResponse);
    return true;
  }
  
  if (request.action === 'updateBehaviorTracking') {
    updateBehaviorTracking(request.data).then(sendResponse);
    return true;
  }
  
  if (request.action === 'incrementInterruptions') {
    incrementInterruptions().then(sendResponse);
    return true;
  }
  
  if (request.action === 'storeSelfAssessment') {
    storeSelfAssessment(request.data).then(sendResponse);
    return true;
  }
  
  if (request.action === 'storeIntentChange') {
    storeIntentChange(request.data).then(sendResponse);
    return true;
  }
  
  if (request.action === 'storeConfirmationDecision') {
    storeConfirmationDecision(request.data).then(sendResponse);
    return true;
  }
  
  if (request.action === 'updateSessionIntention') {
    updateSessionIntention(request.data).then(sendResponse);
    return true;
  }

  if (request.action === 'updatePathway') {
    updatePathway(request.data).then(sendResponse);
    return true;
  }

  if (request.action === 'updateBehavioralState') {
    updateBehavioralState(request.data).then(sendResponse);
    return true;
  }

  if (request.action === 'recordDriftEvent') {
    recordDriftEvent(request.data).then(sendResponse);
    return true;
  }

  if (request.action === 'recordForkPoint') {
    recordForkPoint(request.data).then(sendResponse);
    return true;
  }

  if (request.action === 'recordRecovery') {
    recordRecovery(request.data).then(sendResponse);
    return true;
  }
});

// Start a new session
async function handleStartSession(sessionData) {
  const session = {
    id: generateSessionId(),
    originalIntention: sessionData.intention,
    intention: sessionData.intention,
    goal: sessionData.goal || '',
    startTime: Date.now(),
    endTime: null,
    duration: null,
    matchedIntention: null,
    satisfaction: null,
    actualActivity: null,
    checkpoints: [],
    // Behavior tracking
    timeOnHomepage: 0,
    timeOnVideo: 0,
    timeOnRecommendations: 0,
    interruptionsTriggered: 0,
    currentActivity: 'unknown',
    lastActivityChange: Date.now(),
    // Behavioral State Engine
    stateConfidence: {
      'Goal-Oriented Search': 20,
      'Sustained Engagement': 20,
      'Casual Exploration': 20,
      'Recommendation Loop': 20,
      'Passive Consumption': 20
    },
    // Intent drift memory
    checkInDecisions: [],
    intentionChanges: 0,
    continuationCount: 0,
    endCount: 0
  };
  
  await chrome.storage.local.set({ currentSession: session });
  return { success: true, sessionId: session.id };
}

// End current session
async function handleEndSession(reflectionData) {
  const data = await chrome.storage.local.get(['currentSession', 'sessions']);
  
  if (data.currentSession) {
    const session = {
      ...data.currentSession,
      endTime: Date.now(),
      duration: Date.now() - data.currentSession.startTime,
      matchedIntention: reflectionData ? reflectionData.matchedIntention : null,
      satisfaction: reflectionData ? reflectionData.satisfaction : null,
      actualActivity: reflectionData ? reflectionData.actualActivity : 'Session ended (tab closed)',
      autoEnded: !reflectionData || !reflectionData.matchedIntention
    };
    
    const sessions = data.sessions || [];
    sessions.push(session);
    
    await chrome.storage.local.set({
      sessions: sessions,
      currentSession: null
    });
    
    return { success: true, session: session };
  }
  
  return { success: false, error: 'No active session' };
}

// Update current session (e.g., add checkpoint)
async function handleUpdateSession(updateData) {
  const data = await chrome.storage.local.get(['currentSession']);
  
  if (data.currentSession) {
    const session = {
      ...data.currentSession,
      checkpoints: [...(data.currentSession.checkpoints || []), updateData.checkpoint]
    };
    
    await chrome.storage.local.set({ currentSession: session });
    return { success: true };
  }
  
  return { success: false, error: 'No active session' };
}

// Get user settings
async function getSettings() {
  const data = await chrome.storage.local.get(['settings']);
  return data.settings || {};
}

// Update user settings
async function updateSettings(newSettings) {
  const data = await chrome.storage.local.get(['settings']);
  const settings = { ...data.settings, ...newSettings };
  await chrome.storage.local.set({ settings });
  return { success: true, settings };
}

// Get all sessions
async function getSessions() {
  const data = await chrome.storage.local.get(['sessions']);
  return data.sessions || [];
}

// Get a random reflection message
async function getReflectionMessage() {
  const data = await chrome.storage.local.get(['reflectionMessages']);
  const messages = data.reflectionMessages || [];
  const randomIndex = Math.floor(Math.random() * messages.length);
  return messages[randomIndex] || '';
}

// Generate unique session ID
function generateSessionId() {
  return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// Save reflection response
async function saveReflectionResponse(responseData) {
  const data = await chrome.storage.local.get(['reflectionResponses']);
  const responses = data.reflectionResponses || [];
  
  const response = {
    id: 'reflection_' + Date.now(),
    sessionId: responseData.sessionId,
    stage: responseData.stage, // 'beforeBrowsing', 'duringBrowsing', 'endOfSession'
    question: responseData.question,
    answer: responseData.answer,
    timestamp: Date.now()
  };
  
  responses.push(response);
  await chrome.storage.local.set({ reflectionResponses: responses });
  return { success: true, response };
}

// Get all reflection responses
async function getReflectionResponses() {
  const data = await chrome.storage.local.get(['reflectionResponses']);
  return data.reflectionResponses || [];
}

// Get reflection questions
async function getReflectionQuestions() {
  const data = await chrome.storage.local.get(['reflectionQuestions']);
  return data.reflectionQuestions || {
    beforeBrowsing: [],
    duringBrowsing: [],
    endOfSession: []
  };
}

// Update behavior tracking
async function updateBehaviorTracking(trackingData) {
  const data = await chrome.storage.local.get(['currentSession']);
  const session = data.currentSession;
  
  if (!session) {
    return { success: false, error: 'No active session' };
  }
  
  // Update time spent on current activity
  const now = Date.now();
  const timeSinceLastChange = now - session.lastActivityChange;
  
  if (session.currentActivity === 'homepage') {
    session.timeOnHomepage += timeSinceLastChange;
  } else if (session.currentActivity === 'video') {
    session.timeOnVideo += timeSinceLastChange;
  } else if (session.currentActivity === 'recommendations') {
    session.timeOnRecommendations += timeSinceLastChange;
  }
  
  // Update current activity
  session.currentActivity = trackingData.activity;
  session.lastActivityChange = now;
  
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

// Increment interruptions counter
async function incrementInterruptions() {
  const data = await chrome.storage.local.get(['currentSession']);
  const session = data.currentSession;
  
  if (!session) {
    return { success: false, error: 'No active session' };
  }
  
  session.interruptionsTriggered = (session.interruptionsTriggered || 0) + 1;
  
  await chrome.storage.local.set({ currentSession: session });
  return { success: true, count: session.interruptionsTriggered };
}

// Store self-assessment response
async function storeSelfAssessment(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  
  if (!session) {
    return { success: false, error: 'No active session' };
  }
  
  const decision = {
    timestamp: Date.now(),
    reason: data.reason,
    activity: session.currentActivity
  };
  
  session.checkInDecisions = session.checkInDecisions || [];
  session.checkInDecisions.push(decision);
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

// Store intent change response
async function storeIntentChange(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  
  if (!session) {
    return { success: false, error: 'No active session' };
  }
  
  session.checkInDecisions = session.checkInDecisions || [];
  const lastDecision = session.checkInDecisions[session.checkInDecisions.length - 1];
  if (lastDecision) {
    lastDecision.intentChanged = data.intentChanged;
  }

  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

// Store confirmation decision
async function storeConfirmationDecision(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  
  if (!session) {
    return { success: false, error: 'No active session' };
  }
  
  session.checkInDecisions = session.checkInDecisions || [];
  const lastDecision = session.checkInDecisions[session.checkInDecisions.length - 1];
  if (lastDecision) {
    lastDecision.confirmationAction = data.action;
  }

  if (data.action === 'continue-original') {
    session.continuationCount++;
  } else if (data.action === 'end-session') {
    session.endCount++;
  }
  
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

// Update session intention
async function updateSessionIntention(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  
  if (!session) {
    return { success: false, error: 'No active session' };
  }
  
  session.intention = data.intention;
  session.originalIntention = data.intention;
  session.intentionChanges++;
  
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

// Update an auto-ended session with retroactive reflection data
async function updateAutoEndedSession(data) {
  const storageData = await chrome.storage.local.get(['sessions']);
  const sessions = storageData.sessions || [];
  const idx = sessions.findIndex(s => s.id === data.sessionId);
  if (idx !== -1) {
    sessions[idx].matchedIntention = data.matchedIntention;
    sessions[idx].satisfaction = data.satisfaction;
    sessions[idx].autoEnded = false; // Mark as properly reflected
    await chrome.storage.local.set({ sessions });
    return { success: true };
  }
  return { success: false, error: 'Session not found' };
}

async function updatePathway(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  if (!session) return { success: false, error: 'No active session' };
  session.pathway = (data && data.pathway) || session.pathway || [];
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

function normalizeSessionArrays(session) {
  session.checkInDecisions = session.checkInDecisions || [];
  session.pathway = session.pathway || [];
  session.driftEvents = session.driftEvents || [];
  session.forkPoints = session.forkPoints || [];
  session.recoveryEvents = session.recoveryEvents || [];
  return session;
}

async function updateBehavioralState(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  if (!session) return { success: false, error: 'No active session' };
  normalizeSessionArrays(session);
  if (data) {
    session.currentState = data.state || session.currentState;
    session.stateConfidence = data.confidenceScores || session.stateConfidence;
    if (data.intentAlignment != null) session.intentAlignment = data.intentAlignment;
  }
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

async function recordDriftEvent(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  if (!session) return { success: false, error: 'No active session' };
  normalizeSessionArrays(session);
  session.driftEvents = session.driftEvents.concat(data || []);
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

async function recordForkPoint(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  if (!session) return { success: false, error: 'No active session' };
  normalizeSessionArrays(session);
  session.forkPoints = session.forkPoints.concat(data || []);
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

async function recordRecovery(data) {
  const storageData = await chrome.storage.local.get(['currentSession']);
  const session = storageData.currentSession;
  if (!session) return { success: false, error: 'No active session' };
  normalizeSessionArrays(session);
  session.recoveryEvents = session.recoveryEvents.concat(data || []);
  await chrome.storage.local.set({ currentSession: session });
  return { success: true };
}

// Keep service worker alive (Chrome will terminate it periodically)
chrome.alarms.create('keepAlive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
  // This keeps the service worker alive
});
