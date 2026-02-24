import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn().mockResolvedValue(undefined) }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, getTestTenantId, createTestSession, getPool } from '../helpers/setup.js';
import * as sessionService from '../../../src/services/session.js';

beforeAll(async () => {
  await setupDatabase();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await teardown();
});

describe('session service', () => {
  describe('createSession', () => {
    it('creates a pending session', async () => {
      const { session, inviteUrl } = await sessionService.createSession({
        tenantId: getTestTenantId(),
        agentId: 'agent_1',
        customerId: 'cust_1',
        serverBaseUrl: 'http://localhost:3000',
      });

      expect(session).toBeTruthy();
      expect(session.status).toBe('pending');
      expect(session.agent_id).toBe('agent_1');
      expect(session.customer_id).toBe('cust_1');
      expect(inviteUrl).toContain('/consent/');
    });

    it('auto-ends stale sessions for the same agent', async () => {
      const first = await sessionService.createSession({
        tenantId: getTestTenantId(),
        agentId: 'agent_1',
        customerId: 'cust_1',
        serverBaseUrl: 'http://localhost:3000',
      });

      const second = await sessionService.createSession({
        tenantId: getTestTenantId(),
        agentId: 'agent_1',
        customerId: 'cust_2',
        serverBaseUrl: 'http://localhost:3000',
      });

      // First session should be ended
      const pool = getPool();
      const result = await pool.query('SELECT status FROM sessions WHERE id = $1', [first.session.id]);
      expect(result.rows[0].status).toBe('ended');
      expect(second.session.status).toBe('pending');
    });

    it('auto-ends stale pending sessions for the same customer', async () => {
      const first = await sessionService.createSession({
        tenantId: getTestTenantId(),
        agentId: 'agent_1',
        customerId: 'cust_1',
        serverBaseUrl: 'http://localhost:3000',
      });

      const second = await sessionService.createSession({
        tenantId: getTestTenantId(),
        agentId: 'agent_2',
        customerId: 'cust_1',
        serverBaseUrl: 'http://localhost:3000',
      });

      const pool = getPool();
      const result = await pool.query('SELECT status FROM sessions WHERE id = $1', [first.session.id]);
      expect(result.rows[0].status).toBe('ended');
    });
  });

  describe('getSession', () => {
    it('returns the session', async () => {
      const created = await createTestSession();
      const session = await sessionService.getSession(created.id, getTestTenantId());
      expect(session.id).toBe(created.id);
      expect(session.status).toBe('pending');
    });

    it('throws NotFoundError for unknown session', async () => {
      await expect(
        sessionService.getSession('00000000-0000-0000-0000-000000000000', getTestTenantId())
      ).rejects.toThrow('Session not found');
    });

    it('throws NotFoundError for wrong tenant', async () => {
      const session = await createTestSession();
      await expect(
        sessionService.getSession(session.id, '00000000-0000-0000-0000-000000000000')
      ).rejects.toThrow('Session not found');
    });
  });

  describe('recordConsent', () => {
    it('transitions pending to active', async () => {
      const session = await createTestSession();
      const { customerToken, session: updated } = await sessionService.recordConsent({
        sessionId: session.id,
        customerId: session.customer_id,
      });

      expect(customerToken).toBeTruthy();
      expect(updated.status).toBe('active');
    });

    it('is idempotent for active sessions (returns fresh token)', async () => {
      const session = await createTestSession({ status: 'active' });
      // Need to set customer_joined_at for it to be truly active
      const pool = getPool();
      await pool.query('UPDATE sessions SET status = $1 WHERE id = $2', ['active', session.id]);

      const { customerToken } = await sessionService.recordConsent({
        sessionId: session.id,
        customerId: session.customer_id,
      });
      expect(customerToken).toBeTruthy();
    });

    it('rejects consent for ended session', async () => {
      const session = await createTestSession();
      // End the session
      const pool = getPool();
      await pool.query("UPDATE sessions SET status = 'ended' WHERE id = $1", [session.id]);

      await expect(
        sessionService.recordConsent({ sessionId: session.id, customerId: session.customer_id })
      ).rejects.toThrow('session has already ended');
    });

    it('rejects consent with wrong customerId', async () => {
      const session = await createTestSession();
      await expect(
        sessionService.recordConsent({ sessionId: session.id, customerId: 'wrong_customer' })
      ).rejects.toThrow('Customer ID does not match');
    });

    it('throws NotFoundError for unknown session', async () => {
      await expect(
        sessionService.recordConsent({ sessionId: '00000000-0000-0000-0000-000000000000', customerId: 'c' })
      ).rejects.toThrow('not found');
    });
  });

  describe('recordDecline', () => {
    it('ends the session with customer_declined reason', async () => {
      const session = await createTestSession();
      await sessionService.recordDecline({ sessionId: session.id, customerId: session.customer_id });

      const pool = getPool();
      const result = await pool.query('SELECT status, end_reason FROM sessions WHERE id = $1', [session.id]);
      expect(result.rows[0].status).toBe('ended');
      expect(result.rows[0].end_reason).toBe('customer_declined');
    });

    it('rejects decline with wrong customerId', async () => {
      const session = await createTestSession();
      await expect(
        sessionService.recordDecline({ sessionId: session.id, customerId: 'wrong' })
      ).rejects.toThrow('Customer ID mismatch');
    });
  });

  describe('endSession', () => {
    it('ends a pending session', async () => {
      const session = await createTestSession();
      await sessionService.endSession(session.id, getTestTenantId(), 'agent');

      const pool = getPool();
      const result = await pool.query('SELECT status, end_reason FROM sessions WHERE id = $1', [session.id]);
      expect(result.rows[0].status).toBe('ended');
      expect(result.rows[0].end_reason).toBe('agent');
    });

    it('is idempotent (calling twice does not throw)', async () => {
      const session = await createTestSession();
      await sessionService.endSession(session.id, getTestTenantId(), 'agent');
      await sessionService.endSession(session.id, getTestTenantId(), 'agent'); // second call — no-op
    });
  });

  describe('snapshot store/fetch', () => {
    it('stores and fetches a snapshot', async () => {
      const snapshot = [{ type: 4, data: {} }, { type: 2, data: { node: {} } }];
      await sessionService.storeSnapshot('test-session-id', snapshot);
      const fetched = await sessionService.fetchSnapshot('test-session-id');
      expect(fetched).toEqual(snapshot);
    });

    it('returns null for missing snapshot', async () => {
      const fetched = await sessionService.fetchSnapshot('nonexistent');
      expect(fetched).toBeNull();
    });
  });

  describe('bufferDomEvents / getDomEvents', () => {
    it('buffers and retrieves events', async () => {
      const events = [{ type: 3, data: 'mutation1' }, { type: 3, data: 'mutation2' }];
      await sessionService.bufferDomEvents('sess-buffer-test', events);

      const { events: fetched, nextSeq } = await sessionService.getDomEvents('sess-buffer-test', 0);
      expect(fetched.length).toBe(2);
      expect(nextSeq).toBe(2);
    });

    it('returns events since a given sequence', async () => {
      const events = [{ type: 3, data: '1' }, { type: 3, data: '2' }, { type: 3, data: '3' }];
      await sessionService.bufferDomEvents('sess-seq-test', events);

      const { events: fetched, nextSeq } = await sessionService.getDomEvents('sess-seq-test', 1);
      expect(fetched.length).toBe(2);
      expect(nextSeq).toBe(3);
    });

    it('returns empty for no buffered events', async () => {
      const { events, nextSeq } = await sessionService.getDomEvents('nonexistent', 0);
      expect(events).toEqual([]);
      expect(nextSeq).toBe(0);
    });
  });

  describe('recordUrlChange', () => {
    it('appends URL to session urls_visited', async () => {
      const session = await createTestSession();
      await sessionService.recordUrlChange(session.id, getTestTenantId(), 'https://example.com/page1');
      await sessionService.recordUrlChange(session.id, getTestTenantId(), 'https://example.com/page2');

      const pool = getPool();
      const result = await pool.query('SELECT urls_visited FROM sessions WHERE id = $1', [session.id]);
      expect(result.rows[0].urls_visited).toContain('https://example.com/page1');
      expect(result.rows[0].urls_visited).toContain('https://example.com/page2');
    });
  });

  describe('touchSession', () => {
    it('does not throw', () => {
      // touchSession resets idle timer — verify it doesn't crash
      expect(() => sessionService.touchSession('any-session', 'any-tenant')).not.toThrow();
    });
  });
});
