import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Mock Ably with spies we can assert against
const mockPublish = vi.fn().mockResolvedValue(undefined);
const mockCreateTokenRequest = vi.fn().mockResolvedValue({
  keyName: 'app.key',
  timestamp: Date.now(),
  nonce: 'nonce',
  capability: '{}',
  mac: 'mac',
});

vi.mock('ably', () => ({
  default: {
    Rest: class {
      constructor() {
        this.auth = { createTokenRequest: mockCreateTokenRequest };
        this.channels = { get: vi.fn(() => ({ publish: mockPublish })) };
      }
    },
  },
  Rest: class {
    constructor() {
      this.auth = { createTokenRequest: mockCreateTokenRequest };
      this.channels = { get: vi.fn(() => ({ publish: mockPublish })) };
    }
  },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn() },
}));

// We need to mock config before ably service loads
vi.mock('../../../src/config.js', () => ({
  default: {
    ably: { apiKey: 'test:ably_key' },
    session: { maxDurationMinutes: 120 },
    security: { tokenSecret: 'test-secret' },
  },
}));

const { createTokenRequest, publishInvite, publishSysEvent, publishConsentApproved, CHANNEL } = await import('../../../src/services/ably.js');

beforeAll(() => {
  mockPublish.mockClear();
  mockCreateTokenRequest.mockClear();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('Ably service', () => {
  describe('CHANNEL helpers', () => {
    it('formats invite channel correctly', () => {
      expect(CHANNEL.invite('t1', 'c1')).toBe('invite:t1:c1');
    });

    it('formats dom channel correctly', () => {
      expect(CHANNEL.dom('t1', 's1')).toBe('session:t1:s1:dom');
    });

    it('formats ctrl channel correctly', () => {
      expect(CHANNEL.ctrl('t1', 's1')).toBe('session:t1:s1:ctrl');
    });

    it('formats sys channel correctly', () => {
      expect(CHANNEL.sys('t1', 's1')).toBe('session:t1:s1:sys');
    });
  });

  describe('createTokenRequest', () => {
    it('creates invite token request', async () => {
      const result = await createTokenRequest('invite', {
        tenantId: 'tenant1',
        customerId: 'cust1',
        clientId: 'customer:cust1',
      });
      expect(mockCreateTokenRequest).toHaveBeenCalled();
      expect(result).toHaveProperty('keyName');
    });

    it('creates customer token request', async () => {
      await createTokenRequest('customer', {
        tenantId: 'tenant1',
        sessionId: 'sess1',
        clientId: 'customer:cust1',
      });
      const lastCall = mockCreateTokenRequest.mock.lastCall[0];
      expect(lastCall.capability).toHaveProperty('session:tenant1:sess1:dom');
    });

    it('creates agent token request', async () => {
      await createTokenRequest('agent', {
        tenantId: 'tenant1',
        sessionId: 'sess1',
        clientId: 'agent:agent1',
      });
      const lastCall = mockCreateTokenRequest.mock.lastCall[0];
      expect(lastCall.capability).toHaveProperty('session:tenant1:sess1:ctrl');
    });

    it('throws for unknown role', async () => {
      await expect(
        createTokenRequest('unknown', { tenantId: 't', sessionId: 's' })
      ).rejects.toThrow('Unknown Ably token role: unknown');
    });
  });

  describe('publishInvite', () => {
    it('publishes to the invite channel', async () => {
      mockPublish.mockClear();
      await publishInvite('tenant1', 'cust1', { sessionId: 'sess1' });
      expect(mockPublish).toHaveBeenCalledWith('invite', { sessionId: 'sess1' });
    });
  });

  describe('publishSysEvent', () => {
    it('publishes to the sys channel', async () => {
      mockPublish.mockClear();
      await publishSysEvent('tenant1', 'sess1', 'session.ended', { reason: 'agent' });
      expect(mockPublish).toHaveBeenCalledWith('session.ended', {
        type: 'session.ended',
        reason: 'agent',
      });
    });
  });

  describe('publishConsentApproved', () => {
    it('publishes activate event', async () => {
      mockPublish.mockClear();
      await publishConsentApproved('tenant1', 'cust1', 'sess1', 'token123');
      expect(mockPublish).toHaveBeenCalledWith('activate', {
        sessionId: 'sess1',
        customerToken: 'token123',
      });
    });
  });
});
