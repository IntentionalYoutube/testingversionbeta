// Dashboard script for Intentional YouTube
// Displays reflection data and statistics

document.addEventListener('DOMContentLoaded', initializeDashboard);

async function initializeDashboard() {
  await loadDashboardData();
  
  document.getElementById('openSettings').addEventListener('click', () => {
    chrome.tabs.create({ url: 'options.html' });
  });
  
  document.getElementById('clearData').addEventListener('click', clearAllData);
}

async function loadDashboardData() {
  const data = await chrome.storage.local.get(['sessions', 'settings', 'reflectionResponses']);
  const sessions = data.sessions || [];
  const settings = data.settings || {};
  const reflectionResponses = data.reflectionResponses || [];
  
  if (sessions.length === 0 && reflectionResponses.length === 0) {
    showEmptyState();
    return;
  }
  
  // Calculate and display summary stats
  displaySummaryStats(sessions);
  
  // Display new intervention statistics
  displayInterventionStats(sessions);
  
  // Display charts
  displaySatisfactionChart(sessions);
  displaySessionLengthChart(sessions);
  
  // Display intention breakdown
  displayIntentionBreakdown(sessions);
  
  // Display reflection trends
  displayReflectionTrends(reflectionResponses);
  
  // Display recent sessions
  displayRecentSessions(sessions);

  // Display pathway timeline (defaults to most recent session with pathway data)
  displayPathwayTimeline(sessions);
}

function showEmptyState() {
  document.getElementById('totalSessions').textContent = '0';
  document.getElementById('avgSessionLength').textContent = '-';
  document.getElementById('avgSatisfaction').textContent = '-';
  document.getElementById('intentionMatch').textContent = '-';
  
  document.getElementById('interventionStats').innerHTML = '<p>No intervention data yet</p>';
  document.getElementById('intentionBreakdown').innerHTML = '<p>No session data yet. Start using YouTube to begin tracking your reflections.</p>';
  document.getElementById('sessionsList').innerHTML = '<p>No sessions recorded yet</p>';
}

function displaySummaryStats(sessions) {
  // Total sessions
  document.getElementById('totalSessions').textContent = sessions.length;
  
  // Average session length
  const sessionsWithDuration = sessions.filter(s => s.duration !== null);
  if (sessionsWithDuration.length > 0) {
    const avgDuration = sessionsWithDuration.reduce((sum, s) => sum + s.duration, 0) / sessionsWithDuration.length;
    document.getElementById('avgSessionLength').textContent = formatDuration(avgDuration);
  }
  
  // Average satisfaction
  const sessionsWithSatisfaction = sessions.filter(s => s.satisfaction !== null);
  if (sessionsWithSatisfaction.length > 0) {
    const avgSatisfaction = sessionsWithSatisfaction.reduce((sum, s) => sum + s.satisfaction, 0) / sessionsWithSatisfaction.length;
    document.getElementById('avgSatisfaction').textContent = avgSatisfaction.toFixed(1) + '/5';
  }
  
  // Intention match percentage
  const sessionsWithMatch = sessions.filter(s => s.matchedIntention !== null);
  if (sessionsWithMatch.length > 0) {
    const matchedCount = sessionsWithMatch.filter(s => s.matchedIntention === 'Yes').length;
    const matchPercentage = (matchedCount / sessionsWithMatch.length) * 100;
    document.getElementById('intentionMatch').textContent = matchPercentage.toFixed(0) + '%';
  }
}

function displayInterventionStats(sessions) {
  // Calculate intervention statistics from session data
  let totalInterventions = 0;
  let totalContinuations = 0;
  let totalEnds = 0;
  let totalIntentionChanges = 0;
  const reasonCounts = {};
  
  sessions.forEach(session => {
    if (session.interruptionsTriggered) {
      totalInterventions += session.interruptionsTriggered;
    }
    if (session.continuationCount) {
      totalContinuations += session.continuationCount;
    }
    if (session.endCount) {
      totalEnds += session.endCount;
    }
    if (session.intentionChanges) {
      totalIntentionChanges += session.intentionChanges;
    }
    
    // Count reasons from check-in decisions
    if (session.checkInDecisions) {
      session.checkInDecisions.forEach(decision => {
        if (decision.reason) {
          reasonCounts[decision.reason] = (reasonCounts[decision.reason] || 0) + 1;
        }
      });
    }
  });
  
  // Find most common reason
  let mostCommonReason = 'None yet';
  let maxCount = 0;
  for (const [reason, count] of Object.entries(reasonCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonReason = reason;
    }
  }
  
  const statsHTML = `
    <div class="intervention-stats-grid">
      <div class="intervention-stat-item">
        <div class="intervention-stat-value">${totalInterventions}</div>
        <div class="intervention-stat-label">Total Interventions</div>
      </div>
      <div class="intervention-stat-item">
        <div class="intervention-stat-value">${totalContinuations}</div>
        <div class="intervention-stat-label">Times Continued</div>
      </div>
      <div class="intervention-stat-item">
        <div class="intervention-stat-value">${totalEnds}</div>
        <div class="intervention-stat-label">Sessions Ended</div>
      </div>
      <div class="intervention-stat-item">
        <div class="intervention-stat-value">${totalIntentionChanges}</div>
        <div class="intervention-stat-label">Intention Changes</div>
      </div>
    </div>
    <div class="most-common-reason">
      <strong>Most common reason for continuing:</strong> ${mostCommonReason}
    </div>
  `;
  
  document.getElementById('interventionStats').innerHTML = statsHTML;
}

function displaySatisfactionChart(sessions) {
  const canvas = document.getElementById('satisfactionChart');
  const ctx = canvas.getContext('2d');
  
  // Filter sessions with satisfaction data
  const sessionsWithSatisfaction = sessions.filter(s => s.satisfaction !== null).slice(-20); // Last 20 sessions
  
  if (sessionsWithSatisfaction.length === 0) {
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('No satisfaction data yet', canvas.width / 2, canvas.height / 2);
    return;
  }
  
  // Set canvas size
  canvas.width = canvas.parentElement.clientWidth - 40;
  canvas.height = 200;
  
  const padding = 40;
  const chartWidth = canvas.width - padding * 2;
  const chartHeight = canvas.height - padding * 2;
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Draw axes
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();
  
  // Draw y-axis labels (1-5)
  ctx.fillStyle = '#666';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 1; i <= 5; i++) {
    const y = canvas.height - padding - ((i - 1) / 4) * chartHeight;
    ctx.fillText(i.toString(), padding - 10, y + 4);
    
    // Draw grid line
    ctx.strokeStyle = '#eee';
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(canvas.width - padding, y);
    ctx.stroke();
  }
  
  // Draw data points and line
  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  
  sessionsWithSatisfaction.forEach((session, index) => {
    const x = padding + (index / (sessionsWithSatisfaction.length - 1)) * chartWidth;
    const y = canvas.height - padding - ((session.satisfaction - 1) / 4) * chartHeight;
    
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
  
  // Draw points
  sessionsWithSatisfaction.forEach((session, index) => {
    const x = padding + (index / (sessionsWithSatisfaction.length - 1)) * chartWidth;
    const y = canvas.height - padding - ((session.satisfaction - 1) / 4) * chartHeight;
    
    ctx.fillStyle = '#4a90d9';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function displaySessionLengthChart(sessions) {
  const canvas = document.getElementById('sessionLengthChart');
  const ctx = canvas.getContext('2d');
  
  // Filter sessions with duration data
  const sessionsWithDuration = sessions.filter(s => s.duration !== null);
  
  if (sessionsWithDuration.length === 0) {
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('No duration data yet', canvas.width / 2, canvas.height / 2);
    return;
  }
  
  // Set canvas size
  canvas.width = canvas.parentElement.clientWidth - 40;
  canvas.height = 200;
  
  const padding = 40;
  const chartWidth = canvas.width - padding * 2;
  const chartHeight = canvas.height - padding * 2;
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Create bins for session lengths
  const bins = [
    { label: '< 5m', count: 0, maxMs: 5 * 60 * 1000 },
    { label: '5-15m', count: 0, maxMs: 15 * 60 * 1000 },
    { label: '15-30m', count: 0, maxMs: 30 * 60 * 1000 },
    { label: '30-60m', count: 0, maxMs: 60 * 60 * 1000 },
    { label: '> 60m', count: 0, maxMs: Infinity }
  ];
  
  sessionsWithDuration.forEach(session => {
    for (let i = 0; i < bins.length; i++) {
      if (session.duration < bins[i].maxMs) {
        bins[i].count++;
        break;
      }
    }
  });
  
  const maxCount = Math.max(...bins.map(b => b.count));
  
  // Draw axes
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();
  
  // Draw bars
  const barWidth = chartWidth / bins.length - 20;
  
  bins.forEach((bin, index) => {
    const x = padding + index * (chartWidth / bins.length) + 10;
    const barHeight = maxCount > 0 ? (bin.count / maxCount) * chartHeight : 0;
    const y = canvas.height - padding - barHeight;
    
    // Draw bar
    ctx.fillStyle = '#4a90d9';
    ctx.fillRect(x, y, barWidth, barHeight);
    
    // Draw count on top
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    if (bin.count > 0) {
      ctx.fillText(bin.count.toString(), x + barWidth / 2, y - 5);
    }
    
    // Draw label
    ctx.fillText(bin.label, x + barWidth / 2, canvas.height - padding + 20);
  });
}

function displayIntentionBreakdown(sessions) {
  const intentionCounts = {};
  
  sessions.forEach(session => {
    const intention = session.intention || 'Unknown';
    intentionCounts[intention] = (intentionCounts[intention] || 0) + 1;
  });
  
  const breakdown = document.getElementById('intentionBreakdown');
  
  if (Object.keys(intentionCounts).length === 0) {
    breakdown.innerHTML = '<p>No intention data yet</p>';
    return;
  }
  
  const total = sessions.length;
  let html = '';
  
  for (const [intention, count] of Object.entries(intentionCounts)) {
    const percentage = (count / total) * 100;
    html += `
      <div class="intention-item">
        <span class="intention-name">${intention}</span>
        <div class="intention-bar">
          <div class="intention-fill" style="width: ${percentage}%"></div>
        </div>
        <span class="intention-count">${count} (${percentage.toFixed(0)}%)</span>
      </div>
    `;
  }
  
  breakdown.innerHTML = html;
}

function displayReflectionTrends(reflectionResponses) {
  const trendsSection = document.getElementById('reflectionTrends');
  
  if (reflectionResponses.length === 0) {
    trendsSection.innerHTML = '<p>No reflection responses yet</p>';
    return;
  }
  
  // Group responses by stage
  const byStage = {
    beforeBrowsing: [],
    duringBrowsing: [],
    endOfSession: []
  };
  
  reflectionResponses.forEach(response => {
    if (byStage[response.stage]) {
      byStage[response.stage].push(response);
    }
  });
  
  let html = '<div class="reflection-trends-grid">';
  
  // Display each stage
  for (const [stage, responses] of Object.entries(byStage)) {
    const stageLabel = stage.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    html += `
      <div class="reflection-stage">
        <h4>${stageLabel}</h4>
        <p class="stage-count">${responses.length} responses</p>
        <div class="recent-responses">
    `;
    
    // Show last 3 responses for this stage
    const recentResponses = responses.slice(-3).reverse();
    recentResponses.forEach(response => {
      const date = new Date(response.timestamp);
      const dateStr = date.toLocaleDateString();
      html += `
        <div class="reflection-response-item">
          <p class="response-question">${response.question.substring(0, 80)}${response.question.length > 80 ? '...' : ''}</p>
          <p class="response-answer">${response.answer.substring(0, 100)}${response.answer.length > 100 ? '...' : ''}</p>
          <p class="response-date">${dateStr}</p>
        </div>
      `;
    });
    
    html += '</div></div>';
  }
  
  html += '</div>';
  trendsSection.innerHTML = html;
}

function buildForkPointsHTML(session) {
  const fps = session.forkPoints || [];
  const res = session.recoveryEvents || [];
  if (fps.length === 0 && res.length === 0) return '';
  let html = '<div class="session-pathway">';
  if (fps.length > 0) {
    fps.forEach(fp => {
      const elapsed = fp.sessionElapsedMs ? Math.round(fp.sessionElapsedMs / 60000) : null;
      const timeStr = elapsed !== null ? ` at ${elapsed} min in` : '';
      html += `<div class="session-fork-item"><span class="fork-icon">⤵</span> Attention shifted from <strong>${fp.previousState}</strong> to <strong>${fp.newState}</strong>${timeStr} (${fp.alignmentBefore}% aligned)</div>`;
    });
  }
  if (res.length > 0) {
    res.forEach(re => {
      html += `<div class="session-recovery-item"><span class="recovery-icon">↩</span> ${re.reason}</div>`;
    });
  }
  html += '</div>';
  return html;
}

function displayRecentSessions(sessions) {
  const sessionsList = document.getElementById('sessionsList');
  const recentSessions = sessions.slice(-10).reverse();
  
  if (recentSessions.length === 0) {
    sessionsList.innerHTML = '<p>No sessions recorded yet</p>';
    return;
  }
  
  let html = '';
  
  recentSessions.forEach((session, idx) => {
    const date = new Date(session.startTime);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const duration = session.duration ? formatDuration(session.duration) : 'In progress';
    const satisfaction = session.satisfaction !== null ? `${session.satisfaction}/5` : '-';
    const matched = session.matchedIntention || '-';
    const forkHTML = buildForkPointsHTML(session);
    const sessionIndex = sessions.length - 1 - idx;
    
    html += `
      <div class="session-item ${session.autoEnded ? 'auto-ended' : ''}">
        <div class="session-header">
          <span class="session-date">${dateStr}</span>
          <span class="session-duration">${duration}</span>
          ${session.autoEnded ? '<span class="auto-ended-badge">Auto-ended</span>' : ''}
        </div>
        <div class="session-details">
          <p><strong>Intention:</strong> ${session.intention}</p>
          ${session.goal ? `<p><strong>Goal:</strong> ${session.goal}</p>` : ''}
          <p><strong>Satisfaction:</strong> ${satisfaction}</p>
          <p><strong>Matched intention:</strong> ${matched}</p>
        </div>
        ${forkHTML}
        ${(session.pathway && session.pathway.length > 0) ? `<button class="view-pathway-btn" data-session-index="${sessionIndex}">View pathway timeline</button>` : ''}
      </div>
    `;
  });
  
  sessionsList.innerHTML = html;

  document.querySelectorAll('.view-pathway-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.sessionIndex);
      displayPathwayTimeline(sessions, idx);
      document.getElementById('pathwayTimeline').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

function displayPathwayTimeline(sessions, targetIndex) {
  const container = document.getElementById('pathwayTimeline');
  // Default to most recent session that has pathway data
  const sessionsWithPathway = sessions.map((s, i) => ({ s, i })).filter(x => x.s.pathway && x.s.pathway.length > 0);
  if (sessionsWithPathway.length === 0) {
    container.innerHTML = '<p class="muted">No pathway data recorded yet. Pathway data is collected during active sessions.</p>';
    return;
  }
  const target = targetIndex !== undefined
    ? { s: sessions[targetIndex], i: targetIndex }
    : sessionsWithPathway[sessionsWithPathway.length - 1];
  const session = target.s;
  if (!session) { container.innerHTML = '<p class="muted">Session not found.</p>'; return; }

  const startTime = session.startTime || 0;
  const endTime = session.endTime || (startTime + (session.duration || 0));
  const totalMs = endTime - startTime || 1;
  const pathway = session.pathway || [];
  const forkPoints = session.forkPoints || [];
  const recoveryEvents = session.recoveryEvents || [];

  const sessionDate = new Date(startTime).toLocaleDateString() + ' ' + new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const STATE_COLORS = {
    'Goal-Oriented Search': '#4a90d9',
    'Sustained Engagement': '#27ae60',
    'Casual Exploration': '#f39c12',
    'Recommendation Loop': '#e67e22',
    'Passive Consumption': '#e74c3c'
  };

  // Build sorted event list combining pathway + forks + recoveries
  const allEvents = pathway.map(e => ({ ...e, _type: e.type }));
  allEvents.sort((a, b) => a.timestamp - b.timestamp);

  let html = `<div class="pathway-timeline">`;
  html += `<div class="pathway-timeline-header">Session on ${sessionDate} &mdash; ${formatDuration(totalMs)}</div>`;
  html += `<div class="pathway-intention">Intention: <strong>${session.originalIntention || session.intention || '—'}</strong>`;
  if (session.goal) html += ` &mdash; Goal: <em>${session.goal}</em>`;
  html += `</div>`;

  // Visual alignment track: one block per meaningful event
  if (allEvents.length > 0) {
    html += `<div class="alignment-track">`;
    allEvents.forEach((evt, i) => {
      const pct = Math.round(((evt.timestamp - startTime) / totalMs) * 100);
      const color = STATE_COLORS[evt.state] || '#999';
      const isFork = evt._type === 'fork_point';
      const isRecovery = evt._type === 'recovery';
      const label = isFork ? '⤵' : isRecovery ? '↩' : evt._type === 'state_transition' ? '→' : evt._type === 'reflection_checkpoint' ? '◉' : evt._type === 'recommendation' ? '▸' : '';
      if (!label) return;
      html += `<div class="track-marker" style="left:${Math.min(96,pct)}%;background:${color};" title="${evt._type}: ${evt.state} (${evt.alignment}%)">${label}</div>`;
    });
    html += `</div>`;
  }

  // Chronological event list
  html += `<div class="pathway-events">`;
  if (allEvents.length === 0) {
    html += '<p class="muted">No events recorded for this session.</p>';
  } else {
    allEvents.forEach(evt => {
      if (!['fork_point','recovery','state_transition','reflection_checkpoint','search','recommendation','intention_change','session_start','session_end'].includes(evt._type)) return;
      const elapsed = Math.round((evt.timestamp - startTime) / 60000);
      const color = STATE_COLORS[evt.state] || '#999';
      const isFork = evt._type === 'fork_point';
      const isRecovery = evt._type === 'recovery';
      let icon = '•';
      if (isFork) icon = '⤵';
      else if (isRecovery) icon = '↩';
      else if (evt._type === 'state_transition') icon = '→';
      else if (evt._type === 'reflection_checkpoint') icon = '◉';
      else if (evt._type === 'search') icon = '🔍';
      else if (evt._type === 'recommendation') icon = '▸';
      else if (evt._type === 'intention_change') icon = '✎';
      let description = evt._type.replace(/_/g, ' ');
      if (isFork) description = `Attention shifted: ${evt.previousState} → ${evt.newState}`;
      else if (isRecovery) description = evt.reason || 'Recovery';
      else if (evt._type === 'state_transition') description = `State: ${evt.previousState} → ${evt.newState}`;
      const alignLabel = evt.alignment !== undefined ? ` (${evt.alignment}% aligned)` : '';
      html += `<div class="pathway-event-item ${isFork ? 'event-fork' : isRecovery ? 'event-recovery' : ''}">` +
        `<span class="event-time">${elapsed}m</span>` +
        `<span class="event-icon" style="color:${color}">${icon}</span>` +
        `<span class="event-desc">${description}${alignLabel}</span>` +
        `</div>`;
    });
  }
  html += `</div></div>`;

  container.innerHTML = html;
}

async function clearAllData() {
  if (confirm('Are you sure you want to clear all session data? This cannot be undone.')) {
    await chrome.storage.local.set({
      sessions: [],
      currentSession: null,
      reflectionResponses: []
    });
    
    showNotification('All data has been cleared.');
    loadDashboardData();
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m`;
  } else {
    return `${seconds}s`;
  }
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
