'use strict';

/**
 * Agent Console — Demo Application
 *
 * Follows the documented agent integration flow:
 *   1. Agent clicks "Start Co-Browse"
 *   2. Frontend calls backend → backend calls CoBrowse API (POST /api/v1/sessions)
 *   3. Backend mints a JWT and returns { sessionId, viewerUrl }
 *   4. Frontend opens viewerUrl in a new window
 *
 * In this demo, the browser simulates the "vendor backend" step by calling
 * the CoBrowse API directly (with the demo secret key) and using the
 * /api/v1/admin/demo-jwt endpoint for JWT generation.
 *
 * In production, the secret key and JWT signing happen server-side only.
 */

// ─── Config ───────────────────────────────────────────────────────────────────
const _demo = window.COBROWSE_DEMO_CONFIG || {};
const CONFIG = {
  serverUrl: _demo.serverUrl || 'http://localhost:4000',
  secretKey: _demo.secretKey || '',
};

// ─── State ────────────────────────────────────────────────────────────────────
let sessionId      = null;
let viewerUrl      = null;
let viewerWindow   = null;
let agentId        = null;
let timerInterval  = null;
let startTime      = null;
let pollInterval   = null;
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

// ─── API helper (simulates vendor backend calls to CoBrowse API) ─────────────
async function apiCall(method, path, body) {
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

// ─── Start session (documented flow) ─────────────────────────────────────────
async function startSession() {
  const agentIdInput    = document.getElementById('input-agent-id').value.trim();
  const customerIdInput = document.getElementById('input-customer-id').value.trim();

  if (!agentIdInput || !customerIdInput) {
    showToast('Agent ID and Customer ID are required', 'error');
    return;
  }

  if (!CONFIG.secretKey) {
    showToast('Secret key not configured. Set DEMO_SECRET_KEY in your server .env file.', 'error');
    return;
  }

  agentId = agentIdInput;
  setButtonState('btn-start', true, '⏳ Starting…');

  // ── Reserve the viewer window NOW while we're in the user-gesture context ──
  // Browsers block window.open() from async callbacks (popup blocker).
  // We open it with about:blank first, then navigate to the viewer URL once
  // session + JWT are ready. The viewer shows "Connecting to session…" until
  // the customer accepts — then transitions to live view automatically.
  viewerWindow = window.open('about:blank', 'cobrowse-viewer', 'width=1024,height=768');

  try {
    // ── Step 1: Create session via CoBrowse API ─────────────────────────────
    logEvent('api', 'Creating session via POST /api/v1/sessions…');

    const sessionBody = {
      customerId: customerIdInput,
      agentId: agentIdInput,
    };

    const session = await apiCall('POST', '/api/v1/sessions', sessionBody);
    sessionId = session.sessionId;

    logEvent('session', `Session ${sessionId.slice(0, 8)}… created`);

    // ── Step 2: Get JWT for the embed viewer ────────────────────────────────
    logEvent('api', 'Requesting JWT for viewer authentication…');

    const jwtRes = await apiCall('POST', '/api/v1/admin/demo-jwt', {
      agentId: agentIdInput,
      agentName: 'Sarah Mitchell',
    });

    logEvent('session', `JWT received (expires in ${jwtRes.expiresIn})`);

    // ── Step 3: Construct the viewer URL ────────────────────────────────────
    viewerUrl = `${CONFIG.serverUrl}/embed/session/${sessionId}?token=${encodeURIComponent(jwtRes.jwt)}`;

    logEvent('viewer', 'Viewer URL ready');

    // ── Navigate the reserved window to the viewer ──────────────────────────
    // The embed viewer handles the full lifecycle: shows "Connecting…" while
    // pending, transitions to live view when customer accepts, shows "Session
    // Ended" when done. No extra agent action needed.
    if (viewerWindow && !viewerWindow.closed) {
      viewerWindow.location.href = viewerUrl;
      logEvent('viewer', 'Viewer window opened');
      document.getElementById('info-placeholder').classList.add('hidden');
      document.getElementById('viewer-status').classList.remove('hidden');

      // Detect when viewer window is closed by the agent
      const checkClosed = setInterval(() => {
        if (viewerWindow && viewerWindow.closed) {
          clearInterval(checkClosed);
          viewerWindow = null;
          logEvent('viewer', 'Viewer window closed');
          document.getElementById('viewer-status').classList.add('hidden');
          document.getElementById('info-placeholder').classList.remove('hidden');
        }
      }, 1000);
    }

    // ── Show session info ───────────────────────────────────────────────────
    showSessionSection(session);
    startTimer();
    startSessionPoll();

  } catch (err) {
    logEvent('error', err.message);
    showToast('Failed to start session: ' + err.message, 'error');
    // Close the reserved window on error
    if (viewerWindow && !viewerWindow.closed) viewerWindow.close();
    viewerWindow = null;
  } finally {
    setButtonState('btn-start', false, '🚀 Start Co-Browse');
  }
}

// ─── Open viewer in new window ──────────────────────────────────────────────
function openViewer() {
  if (!viewerUrl) return;

  viewerWindow = window.open(viewerUrl, 'cobrowse-viewer', 'width=1024,height=768');

  if (viewerWindow) {
    logEvent('viewer', 'Viewer window opened');
    document.getElementById('info-placeholder').classList.add('hidden');
    document.getElementById('viewer-status').classList.remove('hidden');

    // Detect when viewer window is closed
    const checkClosed = setInterval(() => {
      if (viewerWindow && viewerWindow.closed) {
        clearInterval(checkClosed);
        viewerWindow = null;
        logEvent('viewer', 'Viewer window closed');
        document.getElementById('viewer-status').classList.add('hidden');
        document.getElementById('info-placeholder').classList.remove('hidden');
      }
    }, 1000);
  }
}

// ─── Session status polling ─────────────────────────────────────────────────
function startSessionPoll() {
  let sessionActive = false;

  pollInterval = setInterval(async () => {
    if (!sessionId) return;

    try {
      const res = await apiCall('GET', `/api/v1/sessions/${sessionId}`);

      if (res.status === 'active' && !sessionActive) {
        sessionActive = true;
        logEvent('success', 'Customer connected');
        updateStatus('active', 'Session Active');
      } else if (res.status === 'ended') {
        clearInterval(pollInterval);
        logEvent('session', `Session ended. Reason: ${res.endReason || 'unknown'}`);
        teardown('ended');
      }
    } catch { /* non-fatal */ }
  }, 2000);
}

// ─── End session ──────────────────────────────────────────────────────────────
async function endSession() {
  if (!sessionId) return;
  setButtonState('btn-end', true, '⏳ Ending…');
  try {
    await apiCall('DELETE', `/api/v1/sessions/${sessionId}`);
    logEvent('session', 'Session ended by agent');
    // Notify viewer window to show clean end state before closing
    if (viewerWindow && !viewerWindow.closed) {
      viewerWindow.postMessage({ action: 'sessionEndedByAgent' }, '*');
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
  clearInterval(pollInterval);

  if (viewerWindow && !viewerWindow.closed) {
    viewerWindow.close();
  }
  viewerWindow = null;

  sessionId = null;
  viewerUrl = null;
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
