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

// ─── Utilities ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ─── Toast notifications ─────────────────────────────────────────────────────
function showToast(message, type) {
  type = type || 'info';
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast toast-' + type;
  toast.textContent = message;
  container.appendChild(toast);

  // Trigger entrance animation
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      toast.classList.add('visible');
    });
  });

  // Auto-dismiss
  setTimeout(function () {
    toast.classList.remove('visible');
    setTimeout(function () { toast.remove(); }, 200);
  }, 3500);
}

// ─── Inline field validation ─────────────────────────────────────────────────
function showFieldError(inputEl, message) {
  clearFieldError(inputEl);
  // For hidden inputs inside a custom-select, style the trigger button
  var container = inputEl.closest('.custom-select');
  if (container) {
    container.querySelector('.custom-select-trigger').classList.add('input-error-trigger');
  } else {
    inputEl.classList.add('input-error');
  }
  var err = document.createElement('div');
  err.className = 'field-error';
  err.textContent = message;
  inputEl.parentNode.appendChild(err);
}

function clearFieldError(inputEl) {
  var container = inputEl.closest('.custom-select');
  if (container) {
    container.querySelector('.custom-select-trigger').classList.remove('input-error-trigger');
  } else {
    inputEl.classList.remove('input-error');
  }
  var existing = inputEl.parentNode.querySelector('.field-error');
  if (existing) existing.remove();
}

// ─── Custom DOM-based select (visible to rrweb, unlike native <select>) ──────
class CustomSelect {
  constructor(containerEl) {
    this.container = containerEl;
    this.trigger = containerEl.querySelector('.custom-select-trigger');
    this.valueDisplay = containerEl.querySelector('.custom-select-value');
    this.optionsList = containerEl.querySelector('.custom-select-options');
    this.hiddenInput = containerEl.querySelector('input[type="hidden"]');
    this.options = Array.from(this.optionsList.querySelectorAll('li[role="option"]'));
    this.focusedIndex = -1;
    this.isOpen = false;

    // Set initial placeholder style
    this.valueDisplay.classList.add('placeholder');

    // Bind methods
    this._onTriggerClick = this._onTriggerClick.bind(this);
    this._onDocumentClick = this._onDocumentClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onOptionClick = this._onOptionClick.bind(this);

    // Attach listeners
    this.trigger.addEventListener('click', this._onTriggerClick);
    this.trigger.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('click', this._onDocumentClick);

    this.options.forEach(function (opt) {
      opt.addEventListener('click', this._onOptionClick);
    }, this);
  }

  _onTriggerClick(e) {
    e.stopPropagation();
    this.toggle();
  }

  _onDocumentClick() {
    if (this.isOpen) this.close();
  }

  _onKeyDown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!this.isOpen) { this.open(); }
        this._moveFocus(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!this.isOpen) { this.open(); }
        this._moveFocus(-1);
        break;
      case 'Enter':
        e.preventDefault();
        if (this.isOpen && this.focusedIndex >= 0) {
          this.select(this.options[this.focusedIndex]);
        } else if (!this.isOpen) {
          this.open();
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.close();
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  _onOptionClick(e) {
    e.stopPropagation();
    this.select(e.currentTarget);
  }

  _moveFocus(direction) {
    // Clear previous focus
    if (this.focusedIndex >= 0) {
      this.options[this.focusedIndex].classList.remove('focused');
    }

    this.focusedIndex += direction;
    if (this.focusedIndex < 0) this.focusedIndex = this.options.length - 1;
    if (this.focusedIndex >= this.options.length) this.focusedIndex = 0;

    this.options[this.focusedIndex].classList.add('focused');
    this.options[this.focusedIndex].scrollIntoView({ block: 'nearest' });
  }

  open() {
    this.isOpen = true;
    this.container.classList.add('open');
    this.trigger.setAttribute('aria-expanded', 'true');
  }

  close() {
    this.isOpen = false;
    this.container.classList.remove('open');
    this.trigger.setAttribute('aria-expanded', 'false');
    // Clear keyboard focus highlight
    if (this.focusedIndex >= 0) {
      this.options[this.focusedIndex].classList.remove('focused');
      this.focusedIndex = -1;
    }
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  select(optionEl) {
    // Update display text (safe — uses textContent, never innerHTML)
    this.valueDisplay.textContent = optionEl.textContent;
    this.valueDisplay.classList.remove('placeholder');

    // Update hidden input
    this.hiddenInput.value = optionEl.getAttribute('data-value');

    // Update ARIA selected states
    this.options.forEach(function (opt) {
      opt.setAttribute('aria-selected', 'false');
    });
    optionEl.setAttribute('aria-selected', 'true');

    // Fire change event on hidden input so validation listeners work
    this.hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));

    this.close();
  }

  getValue() {
    return this.hiddenInput.value;
  }

  getInputElement() {
    return this.hiddenInput;
  }

  destroy() {
    this.trigger.removeEventListener('click', this._onTriggerClick);
    this.trigger.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('click', this._onDocumentClick);
    this.options.forEach(function (opt) {
      opt.removeEventListener('click', this._onOptionClick);
    }, this);
  }
}

// ─── Progress bar ────────────────────────────────────────────────────────────
function advanceProgressBar(stepNumber) {
  var steps = document.querySelectorAll('.progress-bar .step');
  steps.forEach(function (stepEl) {
    var num = parseInt(stepEl.getAttribute('data-step'), 10);
    if (num < stepNumber) {
      stepEl.classList.add('done');
      stepEl.classList.remove('active');
      stepEl.querySelector('.step-num').textContent = '✓';
    } else if (num === stepNumber) {
      stepEl.classList.add('active');
      stepEl.classList.remove('done');
    } else {
      stepEl.classList.remove('active', 'done');
    }
  });
}

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
            setStatus('active', 'Session active');
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
  section.classList.add('visible');
  section.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function submitClaim() {
  var valid = true;

  var claimTypeEl = document.getElementById('claim-type');
  if (!claimTypeEl.value) {
    showFieldError(claimTypeEl, 'Please select a claim type');
    valid = false;
  } else {
    clearFieldError(claimTypeEl);
  }

  var dateEl = document.getElementById('incident-date');
  if (!dateEl.value) {
    showFieldError(dateEl, 'Please enter the date of incident');
    valid = false;
  } else {
    clearFieldError(dateEl);
  }

  if (!valid) {
    showToast('Please fix the highlighted fields', 'error');
    return;
  }

  // Advance to step 3 (Documents)
  advanceProgressBar(3);
  showToast('Claim details saved — upload your documents below', 'success');
}

document.getElementById('file-input').addEventListener('change', function () {
  const list = document.getElementById('file-list');
  const files = Array.from(this.files);
  if (!files.length) { list.innerHTML = ''; return; }
  list.innerHTML = files.map(function (f) {
    return '<div class="file-list-item">📎 ' + escapeHtml(f.name) + ' (' + (f.size / 1024).toFixed(1) + 'KB)</div>';
  }).join('');
});

// ─── UI event listeners ───────────────────────────────────────────────────────
document.getElementById('file-upload-area').addEventListener('click', function () {
  document.getElementById('file-input').click();
});
document.getElementById('btn-request-otp').addEventListener('click', showOtp);
document.getElementById('btn-submit-claim').addEventListener('click', submitClaim);

// ─── Initialise custom select ────────────────────────────────────────────────
var claimTypeSelect = new CustomSelect(document.getElementById('claim-type-select'));

// Clear field errors on input change
document.getElementById('claim-type').addEventListener('change', function () {
  clearFieldError(this);
});
document.getElementById('incident-date').addEventListener('change', function () {
  clearFieldError(this);
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
// Pre-fill incident date to today for a "lived-in" demo feel
document.getElementById('incident-date').valueAsDate = new Date();

initSDK();
