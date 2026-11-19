import { describe, expect, it } from 'vitest';
import type { SyncMutation, SyncPullResult, SyncPushResult } from '@gymlytics/shared';
import { Outbox } from '../outbox';
import type { LocalDatabase, OutboxEntry, PullChange, StoredVersion, SyncTransport } from '../types';

const ACADEMY = '11111111-1111-7111-8111-111111111111';
const DEVICE = 'kiosk-front-desk';

/** In-memory stand-in for the sqlite-wasm kiosk database. */
class FakeDb implements LocalDatabase {
  readonly entries = new Map<string, OutboxEntry>();

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async enqueue(entry: OutboxEntry): Promise<void> {
    this.entries.set(entry.mutationId, { ...entry });
  }

  async claimBatch(limit: number, nowIso: string): Promise<OutboxEntry[]> {
    return [...this.entries.values()]
      .filter((e) => (e.status === 'pending' || e.status === 'failed') && e.nextAttemptAt <= nowIso)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map((e) => ({ ...e }));
  }

  async markInflight(ids: string[]): Promise<void> {
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry) entry.status = 'inflight';
    }
  }

  async ack(mutationId: string): Promise<void> {
    const entry = this.entries.get(mutationId);
    if (entry) entry.status = 'acked';
  }

  async releaseFailed(mutationId: string, nextAttemptAt: string, error: string): Promise<void> {
    const entry = this.entries.get(mutationId);
    if (!entry) return;
    entry.status = 'failed';
    entry.attempts += 1;
    entry.nextAttemptAt = nextAttemptAt;
    entry.lastError = error;
  }

  async markConflict(mutationId: string, error: string): Promise<void> {
    const entry = this.entries.get(mutationId);
    if (!entry) return;
    entry.status = 'failed';
    entry.lastError = error;
  }

  async pendingCount(): Promise<number> {
    return [...this.entries.values()].filter((e) => e.status === 'pending').length;
  }

  async conflictCount(): Promise<number> {
    return [...this.entries.values()].filter((e) => e.status === 'failed').length;
  }

  getStoredVersion(): Promise<StoredVersion | null> {
    throw new Error('not used by the outbox');
  }
  applyRemote(_change: PullChange): Promise<'applied' | 'duplicate' | 'conflict'> {
    throw new Error('not used by the outbox');
  }
  getCursor(): Promise<string> {
    throw new Error('not used by the outbox');
  }
  setCursor(): Promise<void> {
    throw new Error('not used by the outbox');
  }
}

class StubClock {
  ticks = 0;
  observed: string[] = [];
  tick(): string {
    this.ticks += 1;
    return `2026-03-01T10:00:00.000Z-${String(this.ticks).padStart(4, '0')}-${DEVICE}`;
  }
  observe(hlc: string): void {
    this.observed.push(hlc);
  }
}

interface TransportBehaviour {
  /** Which mutation ids get an ack. Omit for "ack everything". */
  ackIds?: Set<string>;
  conflicts?: Set<string>;
  serverHlc?: string;
  fail?: Error;
  onPush?: (mutations: SyncMutation[]) => void;
}

function transport(behaviour: TransportBehaviour = {}): SyncTransport {
  return {
    async push(_academyId, _deviceId, mutations): Promise<SyncPushResult> {
      behaviour.onPush?.(mutations);
      if (behaviour.fail) throw behaviour.fail;
      const serverHlc = behaviour.serverHlc ?? '2026-03-01T10:00:05.000Z-0000-server';
      return {
        acks: mutations
          .filter((m) => !behaviour.ackIds || behaviour.ackIds.has(m.mutationId))
          .map((m) => ({
            mutationId: m.mutationId,
            accepted: !behaviour.conflicts?.has(m.mutationId),
            entityId: m.entityId,
            serverVersion: m.version,
            conflict: behaviour.conflicts?.has(m.mutationId) ?? false,
            serverHlc,
            ...(behaviour.conflicts?.has(m.mutationId) ? { reason: 'Stale version' } : {}),
          })),
        serverHlc,
      };
    },
    pull(): Promise<SyncPullResult> {
      throw new Error('not used by the outbox');
    },
  };
}

function build(db: FakeDb, clock = new StubClock(), backoffBaseMs = 1_000, backoffMaxMs = 60_000) {
  return { outbox: new Outbox(db, ACADEMY, DEVICE, clock, backoffBaseMs, backoffMaxMs), clock };
}

async function seed(outbox: Outbox, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await outbox.enqueue({
      entity: 'attendance_log',
      entityId: `0000000${i}-0000-7000-8000-000000000000`,
      operation: 'insert',
      payload: { studentId: 'student' },
    });
  }
}

describe('Outbox.enqueue', () => {
  it('stamps a client mutation id, device and an HLC', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    const entry = await outbox.enqueue({
      entity: 'attendance_log',
      entityId: '00000000-0000-7000-8000-000000000000',
      operation: 'insert',
      payload: {},
    });

    expect(entry.mutationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.deviceId).toBe(DEVICE);
    expect(entry.academyId).toBe(ACADEMY);
    expect(entry.status).toBe('pending');
    expect(entry.attempts).toBe(0);
    expect(entry.hlc).toContain(DEVICE);
  });

  it('lets a caller override the academy for a shared-device tenant switch', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    const entry = await outbox.enqueue({
      entity: 'booking',
      entityId: '00000000-0000-7000-8000-000000000000',
      operation: 'update',
      payload: {},
      academyId: '22222222-2222-7222-8222-222222222222',
    });
    expect(entry.academyId).toBe('22222222-2222-7222-8222-222222222222');
  });
});

describe('Outbox.drain', () => {
  it('does nothing while offline and leaves the queue intact', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    await seed(outbox, 2);

    const outcome = await outbox.drain(transport(), 10, undefined, () => false);
    expect(outcome).toEqual({ sent: 0, accepted: 0, conflicts: 0, deferred: 0 });
    expect(await db.pendingCount()).toBe(2);
  });

  it('returns an empty outcome when there is nothing to send', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    const outcome = await outbox.drain(transport(), 10, undefined, () => true);
    expect(outcome.sent).toBe(0);
  });

  it('marks accepted mutations as acked and observes the server HLC', async () => {
    const db = new FakeDb();
    const { outbox, clock } = build(db);
    await seed(outbox, 2);

    const outcome = await outbox.drain(transport(), 10, undefined, () => true);

    expect(outcome).toEqual({ sent: 2, accepted: 2, conflicts: 0, deferred: 0 });
    expect([...db.entries.values()].every((e) => e.status === 'acked')).toBe(true);
    expect(clock.observed).toContain('2026-03-01T10:00:05.000Z-0000-server');
  });

  it('honours the batch limit', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    await seed(outbox, 5);

    const outcome = await outbox.drain(transport(), 2, undefined, () => true);
    expect(outcome.sent).toBe(2);
    expect(await db.pendingCount()).toBe(3);
  });

  it('records a server-reported conflict instead of dropping the write', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    await seed(outbox, 1);
    const mutationId = [...db.entries.keys()][0] as string;

    const outcome = await outbox.drain(
      transport({ conflicts: new Set([mutationId]) }),
      10,
      undefined,
      () => true,
    );

    expect(outcome.conflicts).toBe(1);
    expect(outcome.accepted).toBe(0);
    const entry = db.entries.get(mutationId);
    expect(entry?.status).toBe('failed');
    expect(entry?.lastError).toBe('Stale version');
  });

  it('defers a mutation the server never acknowledged', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    await seed(outbox, 2);
    const [first] = [...db.entries.keys()] as string[];

    const outcome = await outbox.drain(
      transport({ ackIds: new Set([first as string]) }),
      10,
      undefined,
      () => true,
    );

    expect(outcome.accepted).toBe(1);
    expect(outcome.deferred).toBe(1);
    const deferred = [...db.entries.values()].find((e) => e.status === 'failed');
    expect(deferred?.lastError).toBe('No ack received from server');
    expect(deferred?.attempts).toBe(1);
  });

  it('returns everything to pending with backoff when the network drops mid-flight', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    await seed(outbox, 3);

    const before = Date.now();
    const outcome = await outbox.drain(
      transport({ fail: new Error('socket hang up') }),
      10,
      undefined,
      () => true,
    );

    expect(outcome).toEqual({ sent: 0, accepted: 0, conflicts: 0, deferred: 3 });
    for (const entry of db.entries.values()) {
      expect(entry.status).toBe('failed');
      expect(entry.lastError).toBe('socket hang up');
      expect(entry.attempts).toBe(1);
      const delay = Date.parse(entry.nextAttemptAt) - before;
      expect(delay).toBeGreaterThanOrEqual(1_000);
      expect(delay).toBeLessThan(1_500);
    }
  });

  it('does not retry before the backoff window elapses', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    await seed(outbox, 1);

    await outbox.drain(transport({ fail: new Error('offline') }), 10, undefined, () => true);
    const second = await outbox.drain(transport(), 10, undefined, () => true);
    expect(second.sent).toBe(0);
  });

  it('grows the backoff exponentially and then caps it', async () => {
    const db = new FakeDb();
    const { outbox } = build(db, new StubClock(), 1_000, 60_000);
    await seed(outbox, 1);
    const mutationId = [...db.entries.keys()][0] as string;
    const entry = db.entries.get(mutationId) as OutboxEntry;

    // Pretend this mutation has already failed 10 times.
    entry.attempts = 10;
    entry.nextAttemptAt = new Date(0).toISOString();

    const before = Date.now();
    await outbox.drain(transport({ fail: new Error('still offline') }), 10, undefined, () => true);

    const delay = Date.parse(entry.nextAttemptAt) - before;
    expect(delay).toBeGreaterThanOrEqual(60_000);
    expect(delay).toBeLessThan(61_000);
  });

  it('sends the exact payload and HLC the caller enqueued', async () => {
    const db = new FakeDb();
    const { outbox } = build(db);
    await outbox.enqueue({
      entity: 'attendance_log',
      entityId: '00000000-0000-7000-8000-000000000000',
      operation: 'insert',
      payload: { classId: 'abc', method: 'pin' },
      hlc: '2026-03-01T09:00:00.000Z-0003-kiosk-a',
      version: 2,
    });

    let captured: SyncMutation[] = [];
    await outbox.drain(
      transport({ onPush: (mutations) => { captured = mutations; } }),
      10,
      undefined,
      () => true,
    );

    expect(captured).toHaveLength(1);
    expect(captured[0]?.payload).toEqual({ classId: 'abc', method: 'pin' });
    expect(captured[0]?.hlc).toBe('2026-03-01T09:00:00.000Z-0003-kiosk-a');
    expect(captured[0]?.version).toBe(2);
  });
});
