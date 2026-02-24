/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the SDK source directly (not the built bundle)
import SDK from '../src/index.js';

describe('CoBrowse Agent SDK', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('init()', () => {
    it('requires serverUrl', () => {
      expect(() => SDK.init({ jwt: 'test' })).toThrow('serverUrl is required');
    });

    it('requires jwt or secretKey', () => {
      expect(() => SDK.init({ serverUrl: 'http://localhost' })).toThrow('jwt or secretKey');
    });

    it('initializes with jwt', () => {
      const agent = SDK.init({ serverUrl: 'http://localhost', jwt: 'test-jwt' });
      expect(agent).toBeTruthy();
      agent.destroy();
    });

    it('initializes with secretKey', () => {
      const agent = SDK.init({ serverUrl: 'http://localhost', secretKey: 'cb_sk_test' });
      expect(agent).toBeTruthy();
      agent.destroy();
    });
  });

  describe('createSession()', () => {
    it('calls correct endpoint with Authorization header for JWT', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ sessionId: 'sess-123', status: 'pending', inviteUrl: '/consent/sess-123' }),
      });

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'my-jwt' });

      const result = await agent.createSession('cust_001');

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:4000/api/v1/sessions');
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer my-jwt');
      expect(JSON.parse(opts.body)).toEqual({ customerId: 'cust_001' });
      expect(result.sessionId).toBe('sess-123');

      agent.destroy();
    });

    it('calls correct endpoint with X-API-Key header for secretKey', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ sessionId: 'sess-456', status: 'pending' }),
      });

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', secretKey: 'cb_sk_test' });

      await agent.createSession('cust_002', { agentId: 'agent_a', channelRef: 'ref_1' });

      const [, opts] = fetchMock.mock.calls[0];
      expect(opts.headers['X-API-Key']).toBe('cb_sk_test');
      expect(JSON.parse(opts.body)).toEqual({
        customerId: 'cust_002',
        agentId: 'agent_a',
        channelRef: 'ref_1',
      });

      agent.destroy();
    });
  });

  describe('endSession()', () => {
    it('calls DELETE endpoint', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 204, json: () => Promise.resolve({}) });

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'jwt-test' });
      await agent.endSession('sess-789');

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toBe('http://localhost:4000/api/v1/sessions/sess-789');
      expect(opts.method).toBe('DELETE');

      agent.destroy();
    });
  });

  describe('openViewer()', () => {
    it('calls window.open with correct URL', () => {
      const mockWin = { closed: false, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(mockWin);

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'my-jwt' });
      const win = agent.openViewer('sess-abc');

      expect(window.open).toHaveBeenCalledOnce();
      const [url, name] = window.open.mock.calls[0];
      expect(url).toContain('/embed/session/sess-abc');
      expect(url).toContain('token=my-jwt');
      expect(name).toBe('cobrowse_viewer_sess-abc');
      expect(win).toBe(mockWin);

      agent.destroy();
    });
  });

  describe('event emitter', () => {
    it('on/off works', () => {
      const agent = SDK.init({ serverUrl: 'http://localhost', jwt: 'test' });
      const cb = vi.fn();

      agent.on('test.event', cb);
      agent._emit('test.event', { data: 1 });
      expect(cb).toHaveBeenCalledWith({ data: 1 });

      agent.off('test.event', cb);
      agent._emit('test.event', { data: 2 });
      expect(cb).toHaveBeenCalledTimes(1); // not called again

      agent.destroy();
    });
  });

  describe('destroy()', () => {
    it('closes all viewer windows', () => {
      const mockWin = { closed: false, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(mockWin);

      const agent = SDK.init({ serverUrl: 'http://localhost:4000', jwt: 'jwt' });
      agent.openViewer('sess-1');
      agent.openViewer('sess-2');

      agent.destroy();

      expect(mockWin.close).toHaveBeenCalledTimes(2);
    });
  });
});
