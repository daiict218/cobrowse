/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { inject, remove, onEndClick, showPointer, removePointer } from '../../src/indicator.js';

describe('indicator', () => {
  beforeEach(() => {
    // Clean up any leftover elements
    document.documentElement.innerHTML = '<head></head><body></body>';
  });

  afterEach(() => {
    remove();
  });

  describe('inject', () => {
    it('creates the banner element', () => {
      inject();
      const banner = document.getElementById('__cobrowse_banner__');
      expect(banner).toBeTruthy();
      expect(banner.style.position).toBe('fixed');
    });

    it('is idempotent (calling twice does not create duplicates)', () => {
      inject();
      inject();
      const banners = document.querySelectorAll('#__cobrowse_banner__');
      expect(banners.length).toBe(1);
    });

    it('creates banner with shadow DOM', () => {
      const host = inject();
      expect(host._shadow).toBeTruthy();
    });
  });

  describe('remove', () => {
    it('removes the banner', () => {
      inject();
      remove();
      expect(document.getElementById('__cobrowse_banner__')).toBeNull();
    });

    it('does not throw when no banner exists', () => {
      expect(() => remove()).not.toThrow();
    });
  });

  describe('onEndClick', () => {
    it('wires the callback to the end button', () => {
      inject();
      const callback = vi.fn();
      onEndClick(callback);

      // Get the shadow DOM button
      const host = document.getElementById('__cobrowse_banner__');
      const btn = host._shadow.getElementById('end-btn');
      btn.click();

      expect(callback).toHaveBeenCalledOnce();
    });

    it('does not throw when no banner exists', () => {
      expect(() => onEndClick(vi.fn())).not.toThrow();
    });
  });

  describe('showPointer', () => {
    it('creates the pointer element on first call', () => {
      showPointer(0.5, 0.5);
      const pointer = document.getElementById('__cobrowse_pointer__');
      expect(pointer).toBeTruthy();
    });

    it('positions the pointer correctly', () => {
      // jsdom has default innerWidth=1024, innerHeight=768
      showPointer(0.5, 0.5);
      const pointer = document.getElementById('__cobrowse_pointer__');
      expect(pointer.style.left).toBe(`${0.5 * window.innerWidth}px`);
      expect(pointer.style.top).toBe(`${0.5 * window.innerHeight}px`);
    });

    it('updates position on subsequent calls', () => {
      showPointer(0.1, 0.1);
      showPointer(0.9, 0.9);
      const pointer = document.getElementById('__cobrowse_pointer__');
      expect(pointer.style.left).toBe(`${0.9 * window.innerWidth}px`);
    });
  });

  describe('removePointer', () => {
    it('removes the pointer element', () => {
      showPointer(0.5, 0.5);
      removePointer();
      expect(document.getElementById('__cobrowse_pointer__')).toBeNull();
    });

    it('does not throw when no pointer exists', () => {
      expect(() => removePointer()).not.toThrow();
    });
  });
});
