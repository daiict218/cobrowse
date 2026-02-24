'use strict';

/**
 * Agent Console — Demo Application
 *
 * Simulates the "Care Consult" panel inside a CRM (e.g. Sprinklr).
 * In production, this panel is embedded as an iframe/web component inside the CRM UI.
 *
 * Flow:
 *   1. Agent fills in agentId + customerId and clicks "Start Co-Browse"
 *   2. App calls POST /api/v1/sessions with the secret API key
 *   3. Server publishes an invite to the customer's Ably invite channel
 *   4. App displays the invite URL (in production: sent via SMS/WhatsApp)
 *   5. Customer consents → session becomes active
 *   6. App fetches the DOM snapshot and starts the rrweb replayer
 *   7. Incremental DOM events stream in via Ably → replayer renders them
 *   8. Agent can move their pointer — the overlay appears on the customer's screen
 */

// ─── Config ───────────────────────────────────────────────────────────────────
// When served from the Fastify server (/demo/agent/), window.COBROWSE_DEMO_CONFIG
// is pre-populated by /demo/config.js with the correct server URL and secret key.
// When opened directly in local dev (localhost:3002), falls back to hardcoded values.
const _demo = window.COBROWSE_DEMO_CONFIG || {};
const CONFIG = {
  serverUrl: _demo.serverUrl || 'http://localhost:4000',
  secretKey: _demo.secretKey || 'cb_sk_b03c32546465cbb2f1d3ada34495ec5805dc803f56bc6a6b',
};

// ─── State ────────────────────────────────────────────────────────────────────
let sessionId    = null;
let tenantId     = null;
let agentId      = null;
let ablyClient   = null;
let replayer     = null;
let timerInterval = null;
let startTime    = null;
let pointerMode  = false;
let snapshotPollInterval = null;
let domEventPollInterval = null;
let domEventSeq  = 0;

// ─── Session start ─────────────────────────────────────────────────────────────
async function startSession() {
  const agentIdInput    = document.getElementById('input-agent-id').value.trim();
  const customerIdInput = document.getElementById('input-customer-id').value.trim();
  const channelRef      = document.getElementById('input-channel-ref').value.trim();

  if (!agentIdInput || !customerIdInput) {
    alert('Agent ID and Customer ID are required');
    return;
  }

  if (!CONFIG.secretKey || CONFIG.secretKey === 'PASTE_YOUR_SECRET_KEY_HERE') {
    alert('Please set your SECRET KEY in app.js (CONFIG.secretKey)');
    return;
  }

  agentId = agentIdInput;
  document.getElementById('agent-name-display').textContent = `Agent: ${agentId}`;
  setButtonState('btn-start', true, '⏳ Starting…');

  try {
    const res = await apiCall('POST', '/api/v1/sessions', {
      agentId,
      customerId: customerIdInput,
      channelRef: channelRef || undefined,
    });

    sessionId = res.sessionId;
    tenantId  = res.tenantId;  // returned directly by the server

    logEvent('session.created', `Session ${sessionId.slice(0,8)}… created`);

    showSessionSection(res);
    startTimer();

    // Start polling for session status + snapshot as a reliable fallback.
    // This works even if the Ably connection is slow or blocked.
    startSessionPoll();

    // Connect to Ably in the background (non-blocking) for real-time events.
    // If Ably connects, events arrive faster. If not, polling handles everything.
    connectToSession(res).catch((err) => {
      logEvent('warn', `Ably connection issue: ${err.message} — using polling fallback`);
    });

  } catch (err) {
    logEvent('error', err.message);
    alert(`Failed to start session: ${err.message}`);
  } finally {
    setButtonState('btn-start', false, '🚀 Start Co-Browse');
  }
}

// ─── Connect to Ably session channels ─────────────────────────────────────────
async function connectToSession({ sessionId: sid }) {
  // Use authUrl so Ably fetches and refreshes the token automatically.
  // The server returns a TokenRequest; Ably exchanges it with its own auth servers.
  ablyClient = new Ably.Realtime({
    authUrl:     `${CONFIG.serverUrl}/api/v1/ably-auth?role=agent&sessionId=${sid}`,
    authMethod:  'GET',
    authHeaders: { 'X-API-Key': CONFIG.secretKey },
  });

  await new Promise((resolve, reject) => {
    ablyClient.connection.once('connected', resolve);
    ablyClient.connection.once('failed',    reject);
  });

  logEvent('connected', 'Connected to Ably relay');

  // Subscribe to sys channel for lifecycle events
  const sysCh = ablyClient.channels.get(`session:${tenantId}:${sid}:sys`);
  sysCh.subscribe((msg) => handleSysEvent(msg.name, msg.data));

  // Subscribe to dom channel for rrweb events
  const domCh = ablyClient.channels.get(`session:${tenantId}:${sid}:dom`);
  domCh.subscribe('events', (msg) => handleDomEvents(msg.data));
}

// ─── System event handler ──────────────────────────────────────────────────────
function handleSysEvent(type, data) {
  switch (type) {
    case 'customer.joined':
      clearInterval(sessionPollInterval); // stop polling — Ably is working
      logEvent('customer.joined', 'Customer connected — fetching snapshot…');
      updateStatus('active', 'Session Active');
      startSnapshotPoll();
      break;

    case 'snapshot.updated':
      logEvent('snapshot.updated', `Customer navigated — refreshing view…`);
      refreshReplayer();
      break;

    case 'session.ended':
      logEvent('session.ended', `Session ended. Reason: ${data?.reason || 'unknown'}`);
      teardown('ended');
      break;

    case 'session.idle_warned':
      logEvent('idle_warning', `Idle warning — ${data?.secondsRemaining}s remaining`);
      break;

    default:
      logEvent(type, JSON.stringify(data));
  }
}

// ─── Session status polling (fallback when Ably is slow/blocked) ─────────────
// Polls the session status API every 2 seconds. When the session becomes active
// (customer consented), starts snapshot polling. Works independently of Ably.
let sessionPollInterval = null;

function startSessionPoll() {
  let alreadyActive = false;

  sessionPollInterval = setInterval(async () => {
    if (!sessionId || alreadyActive) return;

    try {
      const res = await apiCall('GET', `/api/v1/sessions/${sessionId}`, null);

      if (res.status === 'active' && !alreadyActive) {
        alreadyActive = true;
        clearInterval(sessionPollInterval);
        logEvent('customer.joined', 'Customer connected (detected via polling)');
        updateStatus('active', 'Session Active');
        startSnapshotPoll();
      } else if (res.status === 'ended') {
        clearInterval(sessionPollInterval);
        logEvent('session.ended', `Session ended. Reason: ${res.endReason || 'unknown'}`);
        teardown('ended');
      }
    } catch { /* non-fatal */ }
  }, 2000);
}

// ─── Snapshot polling ─────────────────────────────────────────────────────────
// Poll for the snapshot until the customer SDK uploads it (HTTP, not Ably)
function startSnapshotPoll() {
  let attempts = 0;
  const MAX    = 30;

  snapshotPollInterval = setInterval(async () => {
    attempts++;
    if (attempts > MAX) {
      clearInterval(snapshotPollInterval);
      logEvent('error', 'Snapshot not received after 30 attempts');
      return;
    }

    try {
      const res = await apiCall('GET', `/api/v1/snapshots/${sessionId}`, null);
      if (res.snapshot) {
        clearInterval(snapshotPollInterval);
        logEvent('snapshot', 'Snapshot received — rendering customer view');
        initReplayer(res.snapshot);
      }
    } catch {
      // Not available yet — keep polling
    }
  }, 1000);
}

// ─── DOM event polling (HTTP fallback when Ably WebSocket is blocked) ────────
// Polls the server for incremental DOM events that the customer SDK posted via
// HTTP. This ensures the agent sees typing, scrolling, and clicks even when
// Ably WebSocket connections are blocked (e.g. Brave browser shields).
function startDomEventPoll() {
  domEventSeq = 0;

  domEventPollInterval = setInterval(async () => {
    if (!sessionId || !replayer) return;

    try {
      const res = await apiCall('GET', `/api/v1/dom-events/${sessionId}?since=${domEventSeq}`, null);
      if (res.events && res.events.length > 0) {
        logEvent('dom-http', `Received ${res.events.length} event(s) via HTTP relay (seq: ${domEventSeq} → ${res.nextSeq})`);
        for (const event of res.events) {
          replayer.addEvent(event);
          // Track URL changes
          if (event.type === 4 /* META */ && event.data?.href) {
            document.getElementById('url-display').textContent = event.data.href;
          }
        }
        domEventSeq = res.nextSeq;
      }
    } catch {
      // Non-fatal — will retry next poll
    }
  }, 150); // Poll ~7x/sec for near-real-time feel
}

// ─── Refresh replayer on navigation ──────────────────────────────────────────
// Called when the server signals that the customer navigated (snapshot.updated).
// Feeds the new [meta, fullSnapshot] into the existing live replayer so the agent
// sees the new page without re-initialising (which would destroy the Replayer instance).
async function refreshReplayer() {
  try {
    const res = await apiCall('GET', `/api/v1/snapshots/${sessionId}`, null);
    if (!res.snapshot) return;
    const events = Array.isArray(res.snapshot) ? res.snapshot : [res.snapshot];
    if (replayer) {
      // Feed new snapshot into the live replayer — rrweb re-renders the page in-place
      for (const event of events) {
        replayer.addEvent(event);
      }
      logEvent('replayer', `View refreshed for navigation (${events.length} events)`);
    } else {
      // Replayer not yet initialised — init now
      initReplayer(res.snapshot);
    }
  } catch (err) {
    logEvent('error', `refreshReplayer: ${err.message}`);
  }
}

// ─── rrweb replayer ──────────────────────────────────────────────────────────
function initReplayer(snapshotData) {
  const container = document.getElementById('viewer-frame');
  container.style.display = 'block';

  document.getElementById('viewer-placeholder').style.display = 'none';
  document.getElementById('pointer-controls').style.display   = 'flex';
  document.getElementById('url-bar').classList.add('visible');

  // snapshotData is [metaEvent, fullSnapshotEvent] — both required by the Replayer.
  // Meta sets the iframe viewport size; FullSnapshot reconstructs the DOM.
  const events = Array.isArray(snapshotData) ? snapshotData : [snapshotData];

  // Initialise rrweb replayer in live mode.
  // useVirtualDom: false — CRITICAL for live mode.
  // rrweb's virtual-DOM path buffers Input/Scroll changes and only flushes them
  // via a 'Flush' event that is emitted in the 'play' action.  In live mode the
  // state machine never transitions through 'play', so the flush never fires and
  // typed values / scroll position are silently swallowed.  Disabling virtual DOM
  // makes all incremental events apply directly to the real iframe DOM.
  replayer = new rrweb.Replayer(events, {
    root:          container,
    liveMode:      true,
    useVirtualDom: false,
    UNSAFE_replayCanvas: false,
  });

  // IMPORTANT: pass Date.now() (not the snapshot timestamp) as the baseline.
  // rrweb's live timer starts at timeOffset=0. Events have delay = timestamp - baseline.
  // If we use the snapshot's timestamp, events emitted seconds before startLive is called
  // will have small delays but the timer hasn't yet elapsed that much — they queue up
  // and appear frozen. Using Date.now() makes all past events isSync=true (applied
  // immediately) and future Ably events apply in near real-time.
  replayer.startLive(Date.now());

  // Wire up mouse tracking over the viewer for agent pointer
  container.addEventListener('mousemove', (e) => {
    if (!pointerMode) return;
    const rect = container.getBoundingClientRect();
    const normX = (e.clientX - rect.left)  / rect.width;
    const normY = (e.clientY - rect.top)   / rect.height;
    sendPointer(normX, normY);
  });

  logEvent('replayer', 'Live replay started');

  // Start HTTP DOM event polling — works even when Ably WebSocket is blocked.
  // If Ably IS connected, events arrive via both channels; the replayer handles
  // duplicate events gracefully (rrweb deduplicates by timestamp).
  startDomEventPoll();
}

// ─── DOM events from customer ─────────────────────────────────────────────────
let _domEventCount = 0;
function handleDomEvents(events) {
  _domEventCount += (Array.isArray(events) ? events.length : 1);
  logEvent('dom', `Received ${Array.isArray(events) ? events.length : 1} event(s) via Ably (total: ${_domEventCount})`);
  if (!replayer) { logEvent('warn', 'Replayer not ready, dropping events'); return; }
  const eventsArr = Array.isArray(events) ? events : [events];
  for (const event of eventsArr) {
    replayer.addEvent(event);
    // Track URL changes
    if (event.type === 4 /* META */ && event.data?.href) {
      document.getElementById('url-display').textContent = event.data.href;
    }
  }
}

// ─── Agent pointer ─────────────────────────────────────────────────────────────
function togglePointerMode() {
  pointerMode = !pointerMode;
  const btn = document.getElementById('btn-pointer');
  btn.textContent = `🎯 Pointer: ${pointerMode ? 'ON' : 'OFF'}`;
  btn.classList.toggle('active', pointerMode);
}

async function sendPointer(normX, normY) {
  if (!ablyClient || !tenantId) return;
  const ctrlCh = ablyClient.channels.get(`session:${tenantId}:${sessionId}:ctrl`);
  ctrlCh.publish('pointer', { x: normX, y: normY });

  // Also move the local overlay for visual feedback
  const pointer = document.getElementById('agent-pointer');
  const frame   = document.getElementById('viewer-frame');
  const rect    = frame.getBoundingClientRect();
  pointer.style.display = 'block';
  pointer.style.left    = `${rect.left + normX * rect.width}px`;
  pointer.style.top     = `${rect.top  + normY * rect.height}px`;
}

// ─── End session ──────────────────────────────────────────────────────────────
async function endSession() {
  if (!sessionId) return;
  setButtonState('btn-end', true, '⏳ Ending…');
  try {
    await apiCall('DELETE', `/api/v1/sessions/${sessionId}`, null);
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
  clearInterval(snapshotPollInterval);
  clearInterval(sessionPollInterval);
  clearInterval(domEventPollInterval);
  ablyClient?.connection.close();

  replayer = null;
  ablyClient = null;
  sessionId  = null;
  pointerMode = false;
  domEventSeq = 0;

  updateStatus('ended', `Ended (${reason})`);

  // Reset viewer
  document.getElementById('viewer-frame').style.display = 'none';
  document.getElementById('viewer-frame').innerHTML = '';
  document.getElementById('viewer-placeholder').style.display = 'flex';
  document.getElementById('agent-pointer').style.display = 'none';
  document.getElementById('pointer-controls').style.display = 'none';
  document.getElementById('url-bar').classList.remove('visible');
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

// ─── API helper ───────────────────────────────────────────────────────────────
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

