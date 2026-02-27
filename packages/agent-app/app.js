'use strict';

/**
 * Agent Console — Demo Application
 *
 * Uses the CoBrowse Agent SDK for session management.
 * The viewer opens in a separate browser window (embed viewer).
 *
 * Supports two auth modes:
 *   1. API Key mode (default) — uses the secret key from demo config
 *   2. JWT Demo Mode — fetches a demo JWT from the server, uses Agent SDK with JWT auth
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const _demo = window.COBROWSE_DEMO_CONFIG || {};
const CONFIG = {
  serverUrl: _demo.serverUrl || 'http://localhost:4000',
  secretKey: _demo.secretKey || '',
};

// ─── State ────────────────────────────────────────────────────────────────────
let agent        = null; // CoBrowseAgent SDK instance
let sessionId    = null;
let agentId      = null;
let timerInterval = null;
let startTime    = null;
let sessionPollInterval = null;
let currentInviteUrl = null;

// ─── Toast notifications ─────────────────────────────────────────────────────
function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      toast.classList.add('visible');
    });
  });

  setTimeout(function () {
    toast.classList.remove('visible');
    setTimeout(function () { toast.remove(); }, 200);
  }, 3500);
}

// ─── Session start ─────────────────────────────────────────────────────────────
async function startSession() {
  const agentIdInput    = document.getElementById('input-agent-id').value.trim();
  const customerIdInput = document.getElementById('input-customer-id').value.trim();
  const jwtMode         = document.getElementById('chk-jwt-mode').checked;

  if (!agentIdInput || !customerIdInput) {
    showToast('Agent ID and Customer ID are required', 'error');
    return;
  }

  agentId = agentIdInput;
  setButtonState('btn-start', true, '⏳ Starting…');

  try {
    // Initialize Agent SDK with appropriate auth
    if (jwtMode) {
      logEvent('api', 'Requesting demo JWT from server…');
      const jwtRes = await apiCallRaw('POST', '/api/v1/admin/demo-jwt', { agentId: agentIdInput, agentName: 'Sarah Mitchell' });
      logEvent('session', `JWT received (expires in ${jwtRes.expiresIn})`);

      agent = CoBrowseAgent.init({
        serverUrl: CONFIG.serverUrl,
        jwt: jwtRes.jwt,
      });
    } else {
      if (!CONFIG.secretKey) {
        showToast('Secret key not configured. Set DEMO_SECRET_KEY in your server .env file, or use JWT Demo Mode.', 'error');
        return;
      }

      agent = CoBrowseAgent.init({
        serverUrl: CONFIG.serverUrl,
        secretKey: CONFIG.secretKey,
      });
    }

    // Wire up SDK event listeners
    agent.on('session.created', (data) => logEvent('session', `Session ${data.sessionId.slice(0,8)}…`));
    agent.on('session.ended', (data) => logEvent('session', `Session ${data.sessionId} ended`));
    agent.on('viewer.opened', (data) => {
      logEvent('viewer', `Viewer window opened for ${data.sessionId.slice(0,8)}…`);
      document.getElementById('info-placeholder').classList.add('hidden');
      document.getElementById('viewer-status').classList.remove('hidden');
    });
    agent.on('viewer.closed', (data) => {
      logEvent('viewer', `Viewer window closed for ${data.sessionId.slice(0,8)}…`);
      document.getElementById('viewer-status').classList.add('hidden');
      document.getElementById('info-placeholder').classList.remove('hidden');
    });

    // Create session
    const res = await agent.createSession(customerIdInput, {
      agentId: agentIdInput,
    });

    sessionId = res.sessionId;

    showSessionSection(res);
    startTimer();
    startSessionPoll();

  } catch (err) {
    logEvent('error', err.message);
    showToast('Failed to start session: ' + err.message, 'error');
  } finally {
    setButtonState('btn-start', false, '🚀 Start Co-Browse');
  }
}

// ─── Open viewer in new window ──────────────────────────────────────────────
function openViewer() {
  if (!agent || !sessionId) return;
  agent.openViewer(sessionId);
}

// ─── Session status polling ─────────────────────────────────────────────────
function startSessionPoll() {
  let sessionActive = false;

  sessionPollInterval = setInterval(async () => {
    if (!sessionId || !agent) return;

    try {
      const res = await agent.getSession(sessionId);

      if (res.status === 'active' && !sessionActive) {
        sessionActive = true;
        logEvent('success', 'Customer connected');
        updateStatus('active', 'Session Active');
        openViewer();
      } else if (res.status === 'ended') {
        clearInterval(sessionPollInterval);
        logEvent('session', `Session ended. Reason: ${res.endReason || 'unknown'}`);
        teardown('ended');
      }
    } catch { /* non-fatal */ }
  }, 2000);
}

// ─── End session ──────────────────────────────────────────────────────────────
async function endSession() {
  if (!sessionId || !agent) return;
  setButtonState('btn-end', true, '⏳ Ending…');
  try {
    await agent.endSession(sessionId);
    logEvent('session', 'Session ended by agent');
    // Notify viewer window to show clean end state before closing
    // Agent SDK manages the viewer window — get reference via _viewerWindows map
    if (agent._viewerWindows) {
      const viewerWin = agent._viewerWindows.get(sessionId);
      if (viewerWin && !viewerWin.closed) {
        viewerWin.postMessage({ action: 'sessionEndedByAgent' }, '*');
      }
    }
    teardown('agent');
  } catch (err) {
    logEvent('error', err.message);
  } finally {
    setButtonState('btn-end', false, '⏹ End Session');
  }
}

// ─── Teardown ─────────────────────────────────────────────────────────────────
let tornDown = false;
function teardown(reason) {
  if (tornDown) return; // prevent double teardown (Ably + poll race)
  tornDown = true;

  clearInterval(timerInterval);
  clearInterval(sessionPollInterval);

  if (agent) {
    agent.destroy();
    agent = null;
  }
  sessionId = null;
  currentInviteUrl = null;

  updateStatus('ended', `Ended (${reason})`);

  document.getElementById('viewer-status').classList.add('hidden');
  document.getElementById('info-placeholder').classList.remove('hidden');

  // After 2 seconds, return to setup so agent can start a new session
  setTimeout(function () {
    document.getElementById('section-status').classList.add('hidden');
    document.getElementById('section-setup').classList.remove('hidden');
    tornDown = false; // reset for next session
  }, 2000);
}

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  startTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const mins    = String(Math.floor(elapsed / 60000)).padStart(2, '0');
    const secs    = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    document.getElementById('session-timer').textContent = `${mins}:${secs}`;
  }, 1000);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function showSessionSection(session) {
  document.getElementById('section-setup').classList.add('hidden');
  document.getElementById('section-status').classList.remove('hidden');
  document.getElementById('info-session-id').textContent  = session.sessionId.slice(0, 12) + '…';
  document.getElementById('info-customer-id').textContent = 'Alex Johnson';
  document.getElementById('info-agent-id').textContent    = 'Sarah Mitchell';

  // Show truncated invite path
  currentInviteUrl = session.inviteUrl;
  try {
    var url = new URL(session.inviteUrl);
    document.getElementById('invite-link-display').textContent = url.pathname + url.search;
  } catch (e) {
    document.getElementById('invite-link-display').textContent = session.inviteUrl;
  }
}

function updateStatus(status, label) {
  const pill = document.getElementById('status-pill');
  pill.className = `status-pill status-${status}`;
  document.getElementById('status-label').textContent = label;
}

function setButtonState(id, disabled, label) {
  const btn = document.getElementById(id);
  btn.disabled     = disabled;
  btn.textContent  = label;
}

// ─── Safe event logger (no innerHTML — prevents XSS) ─────────────────────────
function logEvent(type, message) {
  const log  = document.getElementById('event-log');
  const time = new Date().toLocaleTimeString('en', { hour12: false });

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = time;

  const msgSpan = document.createElement('span');
  msgSpan.className = 'log-msg';
  msgSpan.textContent = type + ': ' + message;

  // Color-code by event type
  if (type === 'error')        msgSpan.classList.add('log-error');
  else if (type === 'session') msgSpan.classList.add('log-session');
  else if (type === 'success') msgSpan.classList.add('log-success');
  else if (type === 'viewer')  msgSpan.classList.add('log-viewer');

  entry.appendChild(timeSpan);
  entry.appendChild(msgSpan);
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

// ─── Copy invite link ─────────────────────────────────────────────────────────
function copyInviteLink() {
  if (!currentInviteUrl) return;
  navigator.clipboard.writeText(currentInviteUrl).then(function () {
    var btn = document.getElementById('btn-copy-link');
    btn.textContent = '✓';
    setTimeout(function () { btn.textContent = '📋'; }, 1500);
    showToast('Invite link copied to clipboard', 'success');
  });
}

// ─── UI event listeners ───────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', startSession);
document.getElementById('btn-end').addEventListener('click', endSession);
document.getElementById('btn-open-viewer').addEventListener('click', openViewer);
document.getElementById('btn-copy-link').addEventListener('click', copyInviteLink);

// ─── Raw API helper (for demo-jwt endpoint — before SDK is initialized) ──────
async function apiCallRaw(method, path, body) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': CONFIG.secretKey,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${CONFIG.serverUrl}${path}`, options);
  if (res.status === 204) return {};

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}
