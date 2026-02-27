/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger to silence output during tests
vi.mock('../../src/logger.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('Transport channel rewind configuration', () => {
  let Transport;
  let channelNames;

  beforeEach(async () => {
    channelNames = [];

    // Set up window.Ably mock before each test
    window.Ably = {
      Realtime: function () {
        this.connection = {
          once: function (event, cb) {
            if (event === 'connected') cb();
          },
          close: function () {},
        };
        this.channels = {
          get: function (name) {
            channelNames.push(name);
            return { subscribe: function () {}, publish: function () {} };
          },
        };
      },
    };

    // Mock fetch for HTTP relay
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });

    const mod = await import('../../src/transport.js');
    Transport = mod.Transport;
  });

  afterEach(() => {
    delete window.Ably;
    vi.restoreAllMocks();
  });

  it('sys channel name includes [?rewind=1] prefix', async () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:4000',
      sessionId: 'sess_123',
      customerToken: 'tok_abc',
    });

    await transport.connect('tenant_1');

    const sysChannel = channelNames.find((n) => n.includes(':sys'));
    expect(sysChannel).toBe('[?rewind=1]session:tenant_1:sess_123:sys');

    transport.disconnect();
  });

  it('dom channel does NOT use rewind', async () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:4000',
      sessionId: 'sess_456',
      customerToken: 'tok_def',
    });

    await transport.connect('tenant_2');

    const domChannel = channelNames.find((n) => n.includes(':dom'));
    expect(domChannel).toBe('session:tenant_2:sess_456:dom');
    expect(domChannel).not.toContain('[?rewind=');

    transport.disconnect();
  });

  it('ctrl channel does NOT use rewind', async () => {
    const transport = new Transport({
      serverUrl: 'http://localhost:4000',
      sessionId: 'sess_789',
      customerToken: 'tok_ghi',
    });

    await transport.connect('tenant_3');

    const ctrlChannel = channelNames.find((n) => n.includes(':ctrl'));
    expect(ctrlChannel).toBe('session:tenant_3:sess_789:ctrl');
    expect(ctrlChannel).not.toContain('[?rewind=');

    transport.disconnect();
  });
});
