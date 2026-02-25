'use strict';

/**
 * Customer Demo App — ShieldLife Insurance Claim Form
 *
 * Simulates a client's website with the CoBrowse SDK embedded.
 * In production, the client adds 3 lines to their website:
 *
 *   <script src="https://cdn.cobrowse.io/cobrowse.js"></script>
 *   <script>
 *     CoBrowse.init({ serverUrl, publicKey, customerId });
 *   </script>
 *
 * The SDK:
 *   - Subscribes to the customer's Ably invite channel on load
 *   - Shows a consent overlay when the agent sends an invite
 *   - Starts DOM capture after customer approves
 *   - Masks sensitive fields (OTP, card numbers, phone) before transmitting
 */

// ─── Config ────────────────────────────────────────────────────────────────────
// When served from the Fastify server (/demo/customer/), window.COBROWSE_DEMO_CONFIG
// is pre-populated by /demo/config.js with the correct server URL and keys.
// Keys must come from server-injected config — never hardcode secrets or keys.
const _demo = window.COBROWSE_DEMO_CONFIG || {};
const CONFIG = {
  serverUrl:  _demo.serverUrl  || 'http://localhost:4000',
  publicKey:  _demo.publicKey  || '',
  customerId: _demo.customerId || 'cust_demo_001',  // In production: authenticated user ID
};

// ─── SDK Initialisation ────────────────────────────────────────────────────────
async function initSDK() {
  setStatus('initialising', 'Initialising…');

  if (!CONFIG.publicKey || CONFIG.publicKey === 'PASTE_YOUR_PUBLIC_KEY_HERE') {
    setStatus('error', 'Set PUBLIC KEY in app.js');
    return;
  }

  if (typeof CoBrowse === 'undefined') {
    setStatus('error', 'SDK not loaded');
    console.error('[Demo] CoBrowse SDK failed to load. Is the server running?');
    return;
  }

  try {
    await CoBrowse.init({
      serverUrl:  CONFIG.serverUrl,
      publicKey:  CONFIG.publicKey,
      customerId: CONFIG.customerId,
      onStateChange(state) {
        switch (state) {
          case 'idle':
            setStatus('idle', `Ready (ID: ${CONFIG.customerId})`);
            break;
          case 'invited':
            setStatus('invited', 'Invite received…');
            break;
          case 'consenting':
            setStatus('consenting', 'Waiting for consent…');
            break;
          case 'active':
            setStatus('active', 'Session active 🟢');
            break;
          case 'ended':
            setStatus('idle', 'Session ended');
            break;
        }
      },
    });

    setStatus('idle', `Ready (Customer: ${CONFIG.customerId})`);
    console.info(`[Demo] CoBrowse SDK ready. Customer ID: ${CONFIG.customerId}`);

  } catch (err) {
    setStatus('error', `SDK error: ${err.message}`);
    console.error('[Demo] SDK init failed:', err);
  }
}

// ─── Status bar helpers ────────────────────────────────────────────────────────
function setStatus(state, text) {
  const bar  = document.getElementById('sdk-status-bar');
  const dot  = document.getElementById('sdk-dot');
  const txt  = document.getElementById('sdk-status-text');

  bar.classList.remove('hidden');
  txt.textContent = `CoBrowse: ${text}`;
  dot.classList.toggle('active', state === 'active');
}

// ─── Form interactivity ────────────────────────────────────────────────────────

function showOtp() {
  const section = document.getElementById('otp-section');
  section.style.display = 'block';
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function submitClaim() {
  const claimType = document.getElementById('claim-type').value;
  if (!claimType) {
    alert('Please select a claim type');
    document.getElementById('claim-type').focus();
    return;
  }

  const date = document.getElementById('incident-date').value;
  if (!date) {
    alert('Please enter the date of incident');
    document.getElementById('incident-date').focus();
    return;
  }

  // Simulate progress — in a real app this would navigate to step 3
  alert('Step 2 complete! Navigating to Document Upload…\n\n(In a real app, this would load the next page while the co-browse session continues)');
}

document.getElementById('file-input').addEventListener('change', function () {
  const list = document.getElementById('file-list');
  const files = Array.from(this.files);
  if (!files.length) { list.innerHTML = ''; return; }
  list.innerHTML = files.map((f) =>
    `<div style="padding:4px 0;">📎 ${f.name} (${(f.size / 1024).toFixed(1)}KB)</div>`
  ).join('');
});

// ─── UI event listeners ───────────────────────────────────────────────────────
document.getElementById('file-upload-area').addEventListener('click', () => {
  document.getElementById('file-input').click();
});
document.getElementById('btn-prev-step').addEventListener('click', () => {
  alert('Navigating back…');
});
document.getElementById('btn-request-otp').addEventListener('click', showOtp);
document.getElementById('btn-submit-claim').addEventListener('click', submitClaim);

// ─── Boot ─────────────────────────────────────────────────────────────────────
initSDK();
