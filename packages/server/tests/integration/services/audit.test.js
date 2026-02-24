import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';

vi.mock('ably', () => ({
  default: { Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn() }) }; } } },
  Rest: class { constructor() { this.auth = { createTokenRequest: vi.fn().mockResolvedValue({}) }; this.channels = { get: () => ({ publish: vi.fn() }) }; } },
}));

vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { setupDatabase, cleanup, teardown, getTestTenantId, createTestSession } from '../helpers/setup.js';
import { logEvent, getSessionEvents, exportTenantEvents } from '../../../src/services/audit.js';

beforeAll(async () => {
  await setupDatabase();
});

afterEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await teardown();
});

describe('audit service', () => {
  describe('logEvent', () => {
    it('inserts an audit event', async () => {
      const session = await createTestSession();
      await logEvent({
        sessionId: session.id,
        tenantId: getTestTenantId(),
        eventType: 'session.created',
        actor: 'agent',
        metadata: { agentId: 'agent_1' },
      });

      const events = await getSessionEvents(session.id, getTestTenantId());
      expect(events.length).toBe(1);
      expect(events[0].event_type).toBe('session.created');
      expect(events[0].actor).toBe('agent');
    });

    it('does not throw on DB errors (swallows failures)', async () => {
      // Pass invalid session ID (will fail FK constraint)
      await expect(
        logEvent({
          sessionId: '00000000-0000-0000-0000-000000000000',
          tenantId: getTestTenantId(),
          eventType: 'test.event',
        })
      ).resolves.not.toThrow();
    });
  });

  describe('getSessionEvents', () => {
    it('returns events ordered by timestamp ASC', async () => {
      const session = await createTestSession();
      await logEvent({ sessionId: session.id, tenantId: getTestTenantId(), eventType: 'first' });
      await logEvent({ sessionId: session.id, tenantId: getTestTenantId(), eventType: 'second' });
      await logEvent({ sessionId: session.id, tenantId: getTestTenantId(), eventType: 'third' });

      const events = await getSessionEvents(session.id, getTestTenantId());
      expect(events.length).toBe(3);
      expect(events[0].event_type).toBe('first');
      expect(events[2].event_type).toBe('third');
    });

    it('returns empty array for unknown session', async () => {
      const events = await getSessionEvents('00000000-0000-0000-0000-000000000000', getTestTenantId());
      expect(events).toEqual([]);
    });
  });

  describe('exportTenantEvents', () => {
    it('exports events within date range', async () => {
      const session = await createTestSession();
      await logEvent({ sessionId: session.id, tenantId: getTestTenantId(), eventType: 'export.test' });

      const from = new Date(Date.now() - 60_000);
      const to = new Date(Date.now() + 60_000);
      const rows = await exportTenantEvents(getTestTenantId(), from, to);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]).toHaveProperty('session_id');
      expect(rows[0]).toHaveProperty('event_type');
      expect(rows[0]).toHaveProperty('agent_id');
    });

    it('respects limit parameter', async () => {
      const session = await createTestSession();
      for (let i = 0; i < 5; i++) {
        await logEvent({ sessionId: session.id, tenantId: getTestTenantId(), eventType: `event_${i}` });
      }

      const rows = await exportTenantEvents(getTestTenantId(), new Date(0), new Date(), 2);
      expect(rows.length).toBe(2);
    });

    it('returns empty for future date range', async () => {
      const session = await createTestSession();
      await logEvent({ sessionId: session.id, tenantId: getTestTenantId(), eventType: 'past' });

      const future = new Date(Date.now() + 86_400_000);
      const rows = await exportTenantEvents(getTestTenantId(), future, new Date(future.getTime() + 1000));
      expect(rows).toEqual([]);
    });
  });
});
