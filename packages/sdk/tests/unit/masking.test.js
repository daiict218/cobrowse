import { describe, it, expect } from 'vitest';
import { buildMaskSelector, sanitiseEvent } from '../../src/masking.js';

describe('buildMaskSelector', () => {
  it('returns default selectors when no rules provided', () => {
    const selector = buildMaskSelector();
    expect(selector).toContain('input[type="password"]');
    expect(selector).toContain('input[autocomplete*="cc-"]');
    expect(selector).toContain('input[name*="cvv"]');
    expect(selector).toContain('input[name*="otp"]');
  });

  it('returns default selectors for empty rules', () => {
    const selector = buildMaskSelector({});
    expect(selector).toContain('input[type="password"]');
  });

  it('includes custom selectors from rules', () => {
    const selector = buildMaskSelector({ selectors: ['input[name="ssn"]', '#secret-field'] });
    expect(selector).toContain('input[name="ssn"]');
    expect(selector).toContain('#secret-field');
  });

  it('includes custom maskTypes as input selectors', () => {
    const selector = buildMaskSelector({ maskTypes: ['email', 'tel'] });
    expect(selector).toContain('input[type="email"]');
    expect(selector).toContain('input[type="tel"]');
  });

  it('deduplicates selectors', () => {
    const selector = buildMaskSelector({
      selectors: ['input[type="password"]'], // already in defaults
    });
    const parts = selector.split(', ');
    const passwordCount = parts.filter(s => s === 'input[type="password"]').length;
    expect(passwordCount).toBe(1);
  });

  it('combines all selectors with comma-space separator', () => {
    const selector = buildMaskSelector();
    expect(selector).toContain(', ');
    // Every item should be separated by ', '
    const parts = selector.split(', ');
    expect(parts.length).toBeGreaterThan(1);
  });
});

describe('sanitiseEvent', () => {
  it('masks 16-digit card numbers in strings', () => {
    const event = { data: { text: 'My card is 4111 1111 1111 1111 ok' } };
    const safe = sanitiseEvent(event);
    expect(safe.data.text).not.toContain('4111');
    expect(safe.data.text).toContain('████');
  });

  it('masks card numbers without spaces', () => {
    const event = { data: { value: '4111111111111111' } };
    const safe = sanitiseEvent(event);
    expect(safe.data.value).toContain('████');
    expect(safe.data.value).not.toContain('4111111111111111');
  });

  it('masks card numbers with dashes', () => {
    const event = { data: { value: '4111-1111-1111-1111' } };
    const safe = sanitiseEvent(event);
    expect(safe.data.value).toContain('████');
  });

  it('preserves structural keys (type, id, timestamp)', () => {
    const event = { type: 3, id: 42, timestamp: 1234567890, data: { text: '4111111111111111' } };
    const safe = sanitiseEvent(event);
    expect(safe.type).toBe(3);
    expect(safe.id).toBe(42);
    expect(safe.timestamp).toBe(1234567890);
  });

  it('handles nested objects', () => {
    const event = { data: { child: { deep: '4111 1111 1111 1111' } } };
    const safe = sanitiseEvent(event);
    expect(safe.data.child.deep).toContain('████');
  });

  it('handles arrays', () => {
    const event = { data: ['4111 1111 1111 1111', 'safe text'] };
    const safe = sanitiseEvent(event);
    expect(safe.data[0]).toContain('████');
    expect(safe.data[1]).toBe('safe text');
  });

  it('returns event as-is when no patterns match', () => {
    const event = { type: 3, data: { text: 'Hello world' } };
    const safe = sanitiseEvent(event);
    expect(safe.data.text).toBe('Hello world');
  });

  it('applies custom patterns from rules', () => {
    const event = { data: { text: 'SSN: 123-45-6789' } };
    const safe = sanitiseEvent(event, { patterns: ['\\d{3}-\\d{2}-\\d{4}'] });
    expect(safe.data.text).toContain('████');
    expect(safe.data.text).not.toContain('123-45-6789');
  });

  it('is a no-op without patterns (all defaults empty)', () => {
    // Default patterns include the card number pattern, which won't match plain text
    const event = { type: 3, data: { value: 'normal text' } };
    const safe = sanitiseEvent(event);
    expect(safe.data.value).toBe('normal text');
  });

  it('does not mutate the original event', () => {
    const event = { data: { text: '4111 1111 1111 1111' } };
    const original = JSON.parse(JSON.stringify(event));
    sanitiseEvent(event);
    expect(event).toEqual(original);
  });

  it('handles non-object/non-string values (numbers, booleans, null)', () => {
    const event = { data: { count: 42, flag: true, empty: null } };
    const safe = sanitiseEvent(event);
    expect(safe.data.count).toBe(42);
    expect(safe.data.flag).toBe(true);
    expect(safe.data.empty).toBeNull();
  });
});
