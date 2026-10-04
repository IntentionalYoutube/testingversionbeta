// Options page script for Intentional YouTube
// Handles onboarding and settings

document.addEventListener('DOMContentLoaded', initializeOptions);

async function initializeOptions() {
  const data = await chrome.storage.local.get(['settings']);
  const settings = data.settings || {};
  
  const onboardingSection = document.getElementById('onboardingSection');
  const settingsSection = document.getElementById('settingsSection');
  
  // Always show settings; keep onboarding visible if not completed
  if (settings.hasCompletedOnboarding) {
    onboardingSection.classList.add('hidden');
  } else {
    onboardingSection.classList.remove('hidden');
  }
  settingsSection.classList.remove('hidden');
  loadSettings(settings);
  
  // Set up event listeners
  document.getElementById('completeOnboarding').addEventListener('click', completeOnboarding);
  document.getElementById('saveSettings').addEventListener('click', saveSettings);
  document.getElementById('viewDashboard').addEventListener('click', openDashboard);
}

function loadSettings(settings) {
  // Load reflection interval
  document.getElementById('reflectionInterval').value = settings.reflectionInterval || 15;
  
  // Load interface toggles
  document.getElementById('hideShorts').checked = settings.hideShorts || false;
  document.getElementById('hideHomepageRecs').checked = settings.hideHomepageRecs || false;
  document.getElementById('hideSidebarRecs').checked = settings.hideSidebarRecs || false;
  document.getElementById('disableAutoplay').checked = settings.disableAutoplay || false;
  document.getElementById('blurThumbnails').checked = settings.blurThumbnails || false;
  
  // Load purpose
  document.getElementById('updatePurpose').value = settings.usualPurpose || '';
}

async function completeOnboarding() {
  const usualPurpose = document.getElementById('usualPurpose').value;
  const supportLevel = document.querySelector('input[name="supportLevel"]:checked').value;
  
  if (!usualPurpose) {
    alert('Please select your usual purpose when opening YouTube.');
    return;
  }
  
  const settings = {
    usualPurpose,
    supportLevel,
    hasCompletedOnboarding: true,
    hideShorts: supportLevel !== 'low',
    hideHomepageRecs: supportLevel === 'high',
    hideSidebarRecs: supportLevel === 'high',
    disableAutoplay: supportLevel === 'high',
    blurThumbnails: supportLevel !== 'low',
    reflectionInterval: supportLevel === 'high' ? 10 : 15
  };
  
  try {
    await chrome.storage.local.set({ settings, pendingIntentCheckpoint: true });
  } catch (e) {
    alert('Failed to save settings. Please try again.');
    return;
  }
  
  // Switch to settings view
  document.getElementById('onboardingSection').classList.add('hidden');
  document.getElementById('settingsSection').classList.remove('hidden');
  loadSettings(settings);
  
  showNotification('Setup complete! Your preferences have been saved.');
}

async function saveSettings() {
  const data = await chrome.storage.local.get(['settings']);
  const existing = data.settings || {};
  
  const settings = {
    ...existing,
    reflectionInterval: parseInt(document.getElementById('reflectionInterval').value) || 15,
    hideShorts: document.getElementById('hideShorts').checked,
    hideHomepageRecs: document.getElementById('hideHomepageRecs').checked,
    hideSidebarRecs: document.getElementById('hideSidebarRecs').checked,
    disableAutoplay: document.getElementById('disableAutoplay').checked,
    blurThumbnails: document.getElementById('blurThumbnails').checked,
    usualPurpose: document.getElementById('updatePurpose').value
  };
  
  // Validate reflection interval
  if (settings.reflectionInterval < 2 || settings.reflectionInterval > 120) {
    alert('Reflection interval must be between 2 and 120 minutes.');
    return;
  }
  
  try {
    await chrome.storage.local.set({ settings });
  } catch (e) {
    alert('Failed to save settings. Please try again.');
    return;
  }
  
  showNotification('Settings saved successfully!');

  // Notify YouTube tabs to apply updated interface changes
  try {
    const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'applyInterfaceChanges' }).catch(() => {});
    }
  } catch (e) {}
}

function openDashboard() {
  chrome.tabs.create({ url: 'dashboard.html' });
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.classList.add('show');
  }, 10);
  
  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}
