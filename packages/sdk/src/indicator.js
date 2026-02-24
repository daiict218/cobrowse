/**
 * Indicator — injects a persistent "session active" banner into the customer's page.
 *
 * Design goals:
 *   - Always visible — tells the customer the session is live
 *   - Non-intrusive — small banner, doesn't block content
 *   - Non-removable by customer JS (uses Shadow DOM to isolate styles)
 *   - Shows agent pointer highlight when agent moves their cursor
 */

const BANNER_ID  = '__cobrowse_banner__';
const POINTER_ID = '__cobrowse_pointer__';

let _bannerObserver = null;

function inject() {
  if (document.getElementById(BANNER_ID)) return; // already injected

  const host = document.createElement('div');
  host.id = BANNER_ID;
  host.style.cssText = [
    'position: fixed !important',
    'top: 0 !important',
    'left: 0 !important',
    'right: 0 !important',
    'z-index: 2147483647 !important',
    'pointer-events: none',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'display: block !important',
    'visibility: visible !important',
    'opacity: 1 !important',
  ].join(';');
  document.documentElement.appendChild(host);

  // Re-inject banner if page JS removes it (consent transparency protection)
  _bannerObserver = new MutationObserver(() => {
    if (!document.getElementById(BANNER_ID)) {
      document.documentElement.appendChild(host);
    }
  });
  _bannerObserver.observe(document.documentElement, { childList: true });

  // Shadow DOM prevents page styles from leaking in or out
  const shadow = host.attachShadow({ mode: 'closed' });

  shadow.innerHTML = `
    <style>
      .banner {
        background: linear-gradient(90deg, #1a1a2e 0%, #4f6ef7 100%);
        color: #fff;
        font-size: 12px;
        padding: 6px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        pointer-events: all;
      }
      .left { display: flex; align-items: center; gap: 8px; }
      .dot  {
        width: 8px; height: 8px;
        background: #4ade80;
        border-radius: 50%;
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0%,100% { opacity: 1; }
        50%      { opacity: 0.4; }
      }
      .label { font-weight: 600; letter-spacing: 0.2px; }
      .end-btn {
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.3);
        color: #fff;
        font-size: 11px;
        padding: 3px 10px;
        border-radius: 4px;
        cursor: pointer;
      }
      .end-btn:hover { background: rgba(255,255,255,0.25); }
    </style>
    <div class="banner">
      <div class="left">
        <div class="dot"></div>
        <span class="label">🔍 Screen sharing is active</span>
      </div>
      <button class="end-btn" id="end-btn">End Session</button>
    </div>
  `;

  // The end-session button is wired up by the session module after injection
  host._shadow = shadow;
  return host;
}

function remove() {
  // Stop the observer first so removal isn't re-injected
  if (_bannerObserver) {
    _bannerObserver.disconnect();
    _bannerObserver = null;
  }
  const el = document.getElementById(BANNER_ID);
  if (el) el.remove();
  removePointer();
}

function onEndClick(callback) {
  const host = document.getElementById(BANNER_ID);
  if (!host || !host._shadow) return;
  const btn = host._shadow.getElementById('end-btn');
  if (btn) btn.addEventListener('click', callback);
}

// ─── Agent pointer overlay ────────────────────────────────────────────────────

/**
 * Show the agent's pointer at normalised coordinates (0–1 relative to viewport).
 * The pointer is a pulsing ring that moves to follow the agent's cursor.
 */
function showPointer(normX, normY) {
  let pointer = document.getElementById(POINTER_ID);

  if (!pointer) {
    pointer = document.createElement('div');
    pointer.id = POINTER_ID;
    pointer.style.cssText = [
      'position: fixed',
      'width: 32px',
      'height: 32px',
      'border-radius: 50%',
      'border: 3px solid #4f6ef7',
      'box-shadow: 0 0 0 2px rgba(79,110,247,0.3)',
      'pointer-events: none',
      'z-index: 2147483646',
      'transform: translate(-50%, -50%)',
      'transition: left 0.08s ease, top 0.08s ease',
    ].join(';');

    const label = document.createElement('div');
    label.style.cssText = [
      'position: absolute',
      'top: 36px',
      'left: 50%',
      'transform: translateX(-50%)',
      'background: #1a1a2e',
      'color: #fff',
      'font-size: 10px',
      'padding: 2px 6px',
      'border-radius: 4px',
      'white-space: nowrap',
      'font-family: -apple-system, sans-serif',
    ].join(';');
    label.textContent = 'Agent';
    pointer.appendChild(label);

    document.documentElement.appendChild(pointer);
  }

  pointer.style.left = `${normX * window.innerWidth}px`;
  pointer.style.top  = `${normY * window.innerHeight}px`;
}

function removePointer() {
  const pointer = document.getElementById(POINTER_ID);
  if (pointer) pointer.remove();
}

export { inject, remove, onEndClick, showPointer, removePointer };
