/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── Minimal CustomSelect class extracted from customer demo app.js ──────────
// We inline the class here so the test doesn't depend on the demo app's global
// script (which expects a full DOM page). This mirrors the exact implementation.

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

    this.valueDisplay.classList.add('placeholder');

    this._onTriggerClick = this._onTriggerClick.bind(this);
    this._onDocumentClick = this._onDocumentClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onOptionClick = this._onOptionClick.bind(this);

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
    if (this.focusedIndex >= 0) {
      this.options[this.focusedIndex].classList.remove('focused');
    }
    this.focusedIndex += direction;
    if (this.focusedIndex < 0) this.focusedIndex = this.options.length - 1;
    if (this.focusedIndex >= this.options.length) this.focusedIndex = 0;
    this.options[this.focusedIndex].classList.add('focused');
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
    if (this.focusedIndex >= 0) {
      this.options[this.focusedIndex].classList.remove('focused');
      this.focusedIndex = -1;
    }
  }

  toggle() {
    if (this.isOpen) this.close(); else this.open();
  }

  select(optionEl) {
    this.valueDisplay.textContent = optionEl.textContent;
    this.valueDisplay.classList.remove('placeholder');
    this.hiddenInput.value = optionEl.getAttribute('data-value');
    this.options.forEach(function (opt) {
      opt.setAttribute('aria-selected', 'false');
    });
    optionEl.setAttribute('aria-selected', 'true');
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

// ── Test helpers ────────────────────────────────────────────────────────────────

function createSelectDOM() {
  const div = document.createElement('div');
  div.innerHTML = `
    <div class="custom-select" id="claim-type-select">
      <button class="custom-select-trigger" type="button"
        role="combobox" aria-haspopup="listbox" aria-expanded="false">
        <span class="custom-select-value">— Select claim type —</span>
        <span class="custom-select-arrow">▾</span>
      </button>
      <ul class="custom-select-options" role="listbox">
        <li role="option" data-value="water">Water Damage</li>
        <li role="option" data-value="fire">Fire Damage</li>
        <li role="option" data-value="theft">Theft / Burglary</li>
      </ul>
      <input type="hidden" id="claim-type" value="" />
    </div>
  `;
  document.body.appendChild(div);
  return div.querySelector('.custom-select');
}

function keyDown(el, key) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('CustomSelect', () => {
  let container;
  let select;

  beforeEach(() => {
    container = createSelectDOM();
    select = new CustomSelect(container);
  });

  afterEach(() => {
    select.destroy();
    document.body.innerHTML = '';
  });

  describe('open / close', () => {
    it('opens on trigger click', () => {
      select.trigger.click();
      expect(select.isOpen).toBe(true);
      expect(container.classList.contains('open')).toBe(true);
      expect(select.trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('closes on outside click', () => {
      select.open();
      document.body.click();
      expect(select.isOpen).toBe(false);
      expect(container.classList.contains('open')).toBe(false);
    });

    it('closes on Escape key', () => {
      select.open();
      keyDown(select.trigger, 'Escape');
      expect(select.isOpen).toBe(false);
    });

    it('closes on Tab key', () => {
      select.open();
      keyDown(select.trigger, 'Tab');
      expect(select.isOpen).toBe(false);
    });

    it('toggles on repeated trigger clicks', () => {
      select.trigger.click();
      expect(select.isOpen).toBe(true);
      select.trigger.click();
      expect(select.isOpen).toBe(false);
    });
  });

  describe('selection', () => {
    it('selects option on click and updates hidden input', () => {
      select.open();
      select.options[1].click(); // "Fire Damage"

      expect(select.getValue()).toBe('fire');
      expect(select.valueDisplay.textContent).toBe('Fire Damage');
      expect(select.isOpen).toBe(false);
    });

    it('updates aria-selected on the chosen option', () => {
      select.select(select.options[0]);
      expect(select.options[0].getAttribute('aria-selected')).toBe('true');
      expect(select.options[1].getAttribute('aria-selected')).toBe('false');

      select.select(select.options[2]);
      expect(select.options[0].getAttribute('aria-selected')).toBe('false');
      expect(select.options[2].getAttribute('aria-selected')).toBe('true');
    });

    it('removes placeholder class after selection', () => {
      expect(select.valueDisplay.classList.contains('placeholder')).toBe(true);
      select.select(select.options[0]);
      expect(select.valueDisplay.classList.contains('placeholder')).toBe(false);
    });

    it('fires change event on hidden input when option selected', () => {
      let fired = false;
      select.hiddenInput.addEventListener('change', () => { fired = true; });

      select.select(select.options[1]);
      expect(fired).toBe(true);
    });
  });

  describe('keyboard navigation', () => {
    it('ArrowDown opens dropdown and focuses first option', () => {
      keyDown(select.trigger, 'ArrowDown');
      expect(select.isOpen).toBe(true);
      expect(select.focusedIndex).toBe(0);
      expect(select.options[0].classList.contains('focused')).toBe(true);
    });

    it('ArrowDown moves focus to next option', () => {
      select.open();
      keyDown(select.trigger, 'ArrowDown');
      keyDown(select.trigger, 'ArrowDown');
      expect(select.focusedIndex).toBe(1);
      expect(select.options[1].classList.contains('focused')).toBe(true);
      expect(select.options[0].classList.contains('focused')).toBe(false);
    });

    it('ArrowDown wraps from last to first', () => {
      select.open();
      keyDown(select.trigger, 'ArrowDown'); // 0
      keyDown(select.trigger, 'ArrowDown'); // 1
      keyDown(select.trigger, 'ArrowDown'); // 2
      keyDown(select.trigger, 'ArrowDown'); // wraps to 0
      expect(select.focusedIndex).toBe(0);
    });

    it('ArrowUp wraps from first to last', () => {
      select.open();
      keyDown(select.trigger, 'ArrowUp');
      expect(select.focusedIndex).toBe(2); // last option
    });

    it('Enter selects focused option', () => {
      select.open();
      keyDown(select.trigger, 'ArrowDown'); // focus 0
      keyDown(select.trigger, 'Enter');
      expect(select.getValue()).toBe('water');
      expect(select.isOpen).toBe(false);
    });

    it('Enter opens dropdown when closed', () => {
      keyDown(select.trigger, 'Enter');
      expect(select.isOpen).toBe(true);
    });

    it('close clears focused highlight', () => {
      select.open();
      keyDown(select.trigger, 'ArrowDown');
      expect(select.options[0].classList.contains('focused')).toBe(true);

      select.close();
      expect(select.options[0].classList.contains('focused')).toBe(false);
      expect(select.focusedIndex).toBe(-1);
    });
  });

  describe('XSS safety', () => {
    it('uses textContent for display, never innerHTML', () => {
      // The select method sets valueDisplay.textContent — verify no HTML injection
      const maliciousOption = document.createElement('li');
      maliciousOption.setAttribute('role', 'option');
      maliciousOption.setAttribute('data-value', 'xss');
      maliciousOption.textContent = '<img src=x onerror=alert(1)>';

      select.options.push(maliciousOption);
      select.select(maliciousOption);

      // textContent escapes HTML — innerHTML should show escaped text, not a tag
      expect(select.valueDisplay.innerHTML).not.toContain('<img');
      expect(select.valueDisplay.textContent).toBe('<img src=x onerror=alert(1)>');
    });
  });

  describe('getInputElement', () => {
    it('returns the hidden input element', () => {
      const input = select.getInputElement();
      expect(input.type).toBe('hidden');
      expect(input.id).toBe('claim-type');
    });
  });

  describe('destroy', () => {
    it('removes event listeners so clicks no longer open', () => {
      select.destroy();
      select.trigger.click();
      // After destroy, the click handler is removed — isOpen stays false
      expect(select.isOpen).toBe(false);
    });
  });
});
