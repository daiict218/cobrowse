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
  const channelRef      = document.getElementById('input-channel-ref').value.trim();

  if (!agentIdInput || !customerIdInput) {
    alert('Agent ID and Customer ID are required');
    return;
  }

  if (!CONFIG.secretKey) {
    alert('Secret key not configured. Set DEMO_SECRET_KEY in your server .env file.');
    return;
  }

  agentId = agentIdInput;
  document.getElementById('agent-name-display').textContent = `Agent: ${agentId}`;
  setButtonState('btn-start', true, '⏳ Starting…');

  try {
    // ── Step 1: Create session via CoBrowse API ─────────────────────────────
    // In production, this call is made by YOUR backend (never from the browser).
    // The secret key stays on the server.
    logEvent('api', 'Creating session via POST /api/v1/sessions…');

    const sessionBody = {
      customerId: customerIdInput,
      agentId: agentIdInput,
    };
    if (channelRef) sessionBody.channelRef = channelRef;

    const session = await apiCall('POST', '/api/v1/sessions', sessionBody);
    sessionId = session.sessionId;

    logEvent('session.created', `Session ${sessionId.slice(0, 8)}… created`);

    // ── Step 2: Get JWT for the embed viewer ────────────────────────────────
    // In production, your backend signs a JWT with your private key.
    // This demo uses the /api/v1/admin/demo-jwt endpoint to simulate that.
    logEvent('jwt', 'Requesting JWT for viewer authentication…');

    const jwtRes = await apiCall('POST', '/api/v1/admin/demo-jwt', {
      agentId: agentIdInput,
      agentName: agentIdInput,
    });

    logEvent('jwt', `JWT received (expires in ${jwtRes.expiresIn})`);

    // ── Step 3: Construct the viewer URL ────────────────────────────────────
    // The embed viewer is a self-contained page hosted by CoBrowse.
    // It handles Ably connection, rrweb rendering, and real-time updates.
    viewerUrl = `${CONFIG.serverUrl}/embed/session/${sessionId}?token=${encodeURIComponent(jwtRes.jwt)}`;

    logEvent('viewer', 'Viewer URL ready');

    // ── Show session info ───────────────────────────────────────────────────
    showSessionSection(session);
    startTimer();
    startSessionPoll();

  } catch (err) {
    logEvent('error', err.message);
    alert(`Failed to start session: ${err.message}`);
  } finally {
    setButtonState('btn-start', false, '🚀 Start Co-Browse');
  }
}

// ─── Open viewer in new window ──────────────────────────────────────────────
function openViewer() {
  if (!viewerUrl) return;

  // Open the embed viewer — same as documented:
  // window.open(viewerUrl, 'cobrowse-viewer', 'width=1024,height=768');
  viewerWindow = window.open(viewerUrl, 'cobrowse-viewer', 'width=1024,height=768');

  if (viewerWindow) {
    logEvent('viewer', 'Viewer window opened');
    document.getElementById('info-placeholder').style.display = 'none';
    document.getElementById('viewer-status').style.display = 'flex';

    // Detect when viewer window is closed
    const checkClosed = setInterval(() => {
      if (viewerWindow && viewerWindow.closed) {
        clearInterval(checkClosed);
        viewerWindow = null;
        logEvent('viewer', 'Viewer window closed');
        document.getElementById('viewer-status').style.display = 'none';
        document.getElementById('info-placeholder').style.display = 'flex';
      }
    }, 1000);
  }
}

// ─── Session status polling ─────────────────────────────────────────────────
function startSessionPoll() {
  let alreadyActive = false;

  pollInterval = setInterval(async () => {
    if (!sessionId || alreadyActive) return;

    try {
      // Poll session status via CoBrowse API
      const res = await apiCall('GET', `/api/v1/sessions/${sessionId}`);

      if (res.status === 'active' && !alreadyActive) {
        alreadyActive = true;
        clearInterval(pollInterval);
        logEvent('customer.joined', 'Customer connected');
        updateStatus('active', 'Session Active');
        // Auto-open the viewer window as soon as customer consents
        openViewer();
      } else if (res.status === 'ended') {
        clearInterval(pollInterval);
        logEvent('session.ended', `Session ended. Reason: ${res.endReason || 'unknown'}`);
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
    // In production: your frontend calls YOUR backend, which calls CoBrowse API.
    // DELETE /api/v1/sessions/:id ends the session.
    await apiCall('DELETE', `/api/v1/sessions/${sessionId}`);
    logEvent('session.ended', 'Session ended by agent');
    teardown('agent');
  } catch (err) {
    logEvent('error', err.message);
  } finally {
    setButtonState('btn-end', false, '⏹ End Session');
  }
}

// ─── Teardown ─────────────────────────────────────────────────────────────────
function teardown(reason) {
  clearInterval(timerInterval);
  clearInterval(pollInterval);

  // Close the viewer window if still open
  if (viewerWindow && !viewerWindow.closed) {
    viewerWindow.close();
  }
  viewerWindow = null;

  sessionId = null;
  viewerUrl = null;

  updateStatus('ended', `Ended (${reason})`);

  document.getElementById('viewer-status').style.display = 'none';
  document.getElementById('info-placeholder').style.display = 'flex';
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
  document.getElementById('section-setup').style.display  = 'none';
  document.getElementById('section-status').style.display = 'block';
  document.getElementById('info-session-id').textContent  = session.sessionId.slice(0, 12) + '…';
  document.getElementById('info-customer-id').textContent = document.getElementById('input-customer-id').value;
  document.getElementById('info-agent-id').textContent    = agentId;
  document.getElementById('invite-link-box').textContent  = session.inviteUrl;
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

function logEvent(type, message) {
  const log  = document.getElementById('event-log');
  const time = new Date().toLocaleTimeString('en', { hour12: false });
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${type}: ${message}</span>`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

// ─── UI event listeners ───────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', startSession);
document.getElementById('btn-end').addEventListener('click', endSession);
document.getElementById('btn-open-viewer').addEventListener('click', openViewer);
