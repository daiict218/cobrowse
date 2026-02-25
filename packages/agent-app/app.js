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
  secretKey: _demo.secretKey || 'cb_sk_b03c32546465cbb2f1d3ada34495ec5805dc803f56bc6a6b',
};

// ─── State ────────────────────────────────────────────────────────────────────
let agent        = null; // CoBrowseAgent SDK instance
let sessionId    = null;
let agentId      = null;
let timerInterval = null;
let startTime    = null;
let sessionPollInterval = null;

// ─── Session start ─────────────────────────────────────────────────────────────
async function startSession() {
  const agentIdInput    = document.getElementById('input-agent-id').value.trim();
  const customerIdInput = document.getElementById('input-customer-id').value.trim();
  const channelRef      = document.getElementById('input-channel-ref').value.trim();
  const jwtMode         = document.getElementById('chk-jwt-mode').checked;

  if (!agentIdInput || !customerIdInput) {
    alert('Agent ID and Customer ID are required');
    return;
  }

  agentId = agentIdInput;
  document.getElementById('agent-name-display').textContent = `Agent: ${agentId}`;
  setButtonState('btn-start', true, '⏳ Starting…');

  try {
    // Initialize Agent SDK with appropriate auth
    if (jwtMode) {
      logEvent('jwt', 'Requesting demo JWT from server…');
      const jwtRes = await apiCallRaw('POST', '/api/v1/admin/demo-jwt', { agentId: agentIdInput, agentName: agentIdInput });
      logEvent('jwt', `JWT received (expires in ${jwtRes.expiresIn})`);

      agent = CoBrowseAgent.init({
        serverUrl: CONFIG.serverUrl,
        jwt: jwtRes.jwt,
      });
    } else {
      if (!CONFIG.secretKey || CONFIG.secretKey === 'PASTE_YOUR_SECRET_KEY_HERE') {
        alert('Please set your SECRET KEY in app.js (CONFIG.secretKey)');
        return;
      }

      agent = CoBrowseAgent.init({
        serverUrl: CONFIG.serverUrl,
        secretKey: CONFIG.secretKey,
      });
    }

    // Wire up SDK event listeners
    agent.on('session.created', (data) => logEvent('session.created', `Session ${data.sessionId.slice(0,8)}…`));
    agent.on('session.ended', (data) => logEvent('session.ended', `Session ${data.sessionId} ended`));
    agent.on('viewer.opened', (data) => {
      logEvent('viewer', `Viewer window opened for ${data.sessionId.slice(0,8)}…`);
      document.getElementById('info-placeholder').style.display = 'none';
      document.getElementById('viewer-status').style.display = 'flex';
    });
    agent.on('viewer.closed', (data) => {
      logEvent('viewer', `Viewer window closed for ${data.sessionId.slice(0,8)}…`);
      document.getElementById('viewer-status').style.display = 'none';
      document.getElementById('info-placeholder').style.display = 'flex';
    });

    // Create session
    const res = await agent.createSession(customerIdInput, {
      agentId: agentIdInput,
      channelRef: channelRef || undefined,
    });

    sessionId = res.sessionId;

    showSessionSection(res);
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
  if (!agent || !sessionId) return;
  agent.openViewer(sessionId);
}

// ─── Session status polling ─────────────────────────────────────────────────
function startSessionPoll() {
  let alreadyActive = false;

  sessionPollInterval = setInterval(async () => {
    if (!sessionId || !agent || alreadyActive) return;

    try {
      const res = await agent.getSession(sessionId);

      if (res.status === 'active' && !alreadyActive) {
        alreadyActive = true;
        clearInterval(sessionPollInterval);
        logEvent('customer.joined', 'Customer connected');
        updateStatus('active', 'Session Active');
        // Auto-open the viewer window as soon as co-browse begins
        openViewer();
      } else if (res.status === 'ended') {
        clearInterval(sessionPollInterval);
        logEvent('session.ended', `Session ended. Reason: ${res.endReason || 'unknown'}`);
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
  clearInterval(sessionPollInterval);

  if (agent) {
    agent.destroy();
    agent = null;
  }
  sessionId = null;

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
