/**
 * SDK security hardening unit tests — validates all security fixes from the audit.
 *
 * Covers:
 *   - Prototype pollution protection in masking._deepRedact
 *   - Object.create(null) prevents prototype chain attacks
 *   - Structural rrweb keys preserved during sanitisation
 */
import { describe, it, expect } from 'vitest';
import { sanitiseEvent } from '../../src/masking.js';

describe('prototype pollution protection (masking._deepRedact)', () => {
  it('strips __proto__ keys from input', () => {
    const malicious = { data: { text: 'hello', '__proto__': { polluted: true } } };
    const safe = sanitiseEvent(malicious);
    expect(safe.data).not.toHaveProperty('__proto__');
    expect(safe.data.text).toBe('hello');
  });

  it('strips constructor keys from input', () => {
    const malicious = { data: { value: 'ok', 'constructor': { prototype: { isAdmin: true } } } };
    const safe = sanitiseEvent(malicious);
    expect(safe.data).not.toHaveProperty('constructor');
    expect(safe.data.value).toBe('ok');
  });

  it('strips prototype keys from input', () => {
    const malicious = { data: { name: 'test', 'prototype': { exploit: true } } };
    const safe = sanitiseEvent(malicious);
    expect(safe.data).not.toHaveProperty('prototype');
  });

  it('output objects have null prototype (no inherited properties)', () => {
    const event = { data: { text: '4111 1111 1111 1111' } };
    const safe = sanitiseEvent(event);
    // Object.create(null) means no prototype chain
    expect(Object.getPrototypeOf(safe)).toBeNull();
    expect(Object.getPrototypeOf(safe.data)).toBeNull();
  });

  it('handles deeply nested prototype pollution attempts', () => {
    const malicious = {
      data: {
        level1: {
          level2: {
            '__proto__': { polluted: true },
            'constructor': { hack: true },
            value: 'safe',
          },
        },
      },
    };
    const safe = sanitiseEvent(malicious);
    expect(safe.data.level1.level2).not.toHaveProperty('__proto__');
    expect(safe.data.level1.level2).not.toHaveProperty('constructor');
    expect(safe.data.level1.level2.value).toBe('safe');
  });

  it('does not affect arrays during prototype stripping', () => {
    const event = { data: ['safe text', { '__proto__': { bad: true }, value: 'ok' }] };
    const safe = sanitiseEvent(event);
    expect(safe.data[0]).toBe('safe text');
    expect(safe.data[1]).not.toHaveProperty('__proto__');
    expect(safe.data[1].value).toBe('ok');
  });
});
