// Popup script for Intentional YouTube
// Shows current session status and quick stats

let sessionUpdateInterval = null;

document.addEventListener('DOMContentLoaded', initializePopup);

async function initializePopup() {
  // Load current session and stats
  await loadSessionData();
  await loadStats();
  
  // Set up event listeners
  document.getElementById('endSessionBtn').addEventListener('click', endSession);
  document.getElementById('openDashboard').addEventListener('click', openDashboard);
  document.getElementById('openSettings').addEventListener('click', openSettings);
  
  // Update session duration every second
  sessionUpdateInterval = setInterval(updateSessionDuration, 1000);
}

async function loadSessionData() {
  const data = await chrome.storage.local.get(['currentSession', 'settings']);
  const currentSession = data.currentSession;
  const settings = data.settings || {};
  
  const sessionCard = document.getElementById('currentSession');
  const noSession = document.getElementById('noSession');
  
  if (currentSession) {
    sessionCard.classList.remove('hidden');
    noSession.classList.add('hidden');

    document.getElementById('sessionIntention').textContent = currentSession.intention || currentSession.originalIntention || 'Explore a topic';
    updateSessionDuration();
  } else {
    sessionCard.classList.add('hidden');
    noSession.classList.remove('hidden');
  }
}

async function loadStats() {
  const data = await chrome.storage.local.get(['sessions']);
  const sessions = data.sessions || [];
  
  const totalSessions = sessions.length;
  document.getElementById('totalSessions').textContent = totalSessions;
  
  if (totalSessions > 0) {
    // Calculate average satisfaction
    const sessionsWithSatisfaction = sessions.filter(s => s.satisfaction !== null);
    if (sessionsWithSatisfaction.length > 0) {
      const avgSatisfaction = sessionsWithSatisfaction.reduce((sum, s) => sum + s.satisfaction, 0) / sessionsWithSatisfaction.length;
      document.getElementById('avgSatisfaction').textContent = avgSatisfaction.toFixed(1) + '/5';
    }
    
    // Calculate intention match percentage
    const sessionsWithMatch = sessions.filter(s => s.matchedIntention !== null);
    if (sessionsWithMatch.length > 0) {
      const matchedCount = sessionsWithMatch.filter(s => s.matchedIntention === 'Yes').length;
      const matchPercentage = (matchedCount / sessionsWithMatch.length) * 100;
      document.getElementById('intentionMatch').textContent = matchPercentage.toFixed(0) + '%';
    }
  }
}

function updateSessionDuration() {
  const data = chrome.storage.local.get(['currentSession']);
  data.then(data => {
    if (data.currentSession) {
      const duration = Date.now() - data.currentSession.startTime;
      document.getElementById('sessionDuration').textContent = formatDuration(duration);
    }
  });
}

async function endSession() {
  // Send message to content script to show exit reflection
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab.url && tab.url.includes('youtube.com')) {
    chrome.tabs.sendMessage(tab.id, { action: 'showExitReflection' }).catch(() => {
      // Content script might not be loaded
    });
  }
  
  window.close();
}

function openDashboard() {
  chrome.tabs.create({ url: 'dashboard.html' });
  window.close();
}

function openSettings() {
  chrome.tabs.create({ url: 'options.html' });
  window.close();
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Clean up interval when popup closes
window.addEventListener('beforeunload', () => {
  if (sessionUpdateInterval) {
    clearInterval(sessionUpdateInterval);
  }
});
