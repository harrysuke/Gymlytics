import type { SyncAck, SyncMutation } from '@gymlytics/shared';
import type { HlcClock, LocalDatabase, OutboxEntry, PushOutcome, SyncTransport } from './types';

const EMPTY: PushOutcome = { sent: 0, accepted: 0, conflicts: 0, deferred: 0 };

export interface EnqueueInput {
  entity: SyncMutation['entity'];
  entityId: string;
  operation: SyncMutation['operation'];
  payload: Record<string, unknown>;
  hlc?: string;
  version?: number;
  academyId?: string;
}

export class Outbox {
  constructor(
    private readonly db: LocalDatabase,
    private readonly academyId: string,
    private readonly deviceId: string,
    private readonly clock: HlcClock,
    private readonly backoffBaseMs = 1_000,
    private readonly backoffMaxMs = 60_000,
  ) {}

  /**
   * Called INSIDE the same local SQLite transaction as the check-in write.
   * If the transaction rolls back, the outbox row disappears with it — there
   * is no window where attendance exists locally but is invisible to sync.
   */
  async enqueue(input: EnqueueInput): Promise<OutboxEntry> {
    const entry: OutboxEntry = {
      mutationId: crypto.randomUUID(),
      academyId: input.academyId ?? this.academyId,
      deviceId: this.deviceId,
      entity: input.entity,
      entityId: input.entityId,
      operation: input.operation,
      payload: input.payload,
      hlc: input.hlc ?? this.clock.tick(),
      version: input.version ?? 1,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    await this.db.enqueue(entry);
    return entry;
  }

  async drain(
    transport: SyncTransport,
    limit: number,
    signal: AbortSignal | undefined,
    isOnline: () => boolean,
  ): Promise<PushOutcome> {
    if (!isOnline()) return EMPTY;

    const batch = await this.db.claimBatch(limit, new Date().toISOString());
    if (batch.length === 0) return EMPTY;

    const outcome: PushOutcome = { sent: batch.length, accepted: 0, conflicts: 0, deferred: 0 };
    await this.db.markInflight(batch.map((e) => e.mutationId));

    try {
      const mutations: SyncMutation[] = batch.map((entry) => ({
        mutationId: entry.mutationId,
        academyId: entry.academyId,
        deviceId: entry.deviceId,
        entity: entry.entity,
        entityId: entry.entityId,
        operation: entry.operation,
        payload: entry.payload,
        hlc: entry.hlc,
        version: entry.version,
      }));

      const result = await transport.push(this.academyId, this.deviceId, mutations, signal);
      const acks = new Map<string, SyncAck>(result.acks.map((a) => [a.mutationId, a]));
      this.clock.observe(result.serverHlc);

      for (const entry of batch) {
        const ack = acks.get(entry.mutationId);
        if (!ack) {
          outcome.deferred += 1;
          await this.defer(entry, 'No ack received from server');
          continue;
        }
        this.clock.observe(ack.serverHlc);
        if (ack.conflict) {
          outcome.conflicts += 1;
          await this.db.markConflict(entry.mutationId, ack.reason ?? 'Server reported a conflict');
        } else {
          outcome.accepted += 1;
          await this.db.ack(entry.mutationId, ack.serverHlc);
        }
      }
      return outcome;
    } catch (error) {
      // Network dropped mid-flight: every row goes back to pending with
      // exponential backoff. Nothing is lost; the UI still shows "Queued".
      const message = error instanceof Error ? error.message : String(error);
      for (const entry of batch) await this.defer(entry, message);
      return { ...EMPTY, deferred: batch.length };
    }
  }

  private async defer(entry: OutboxEntry, error: string): Promise<void> {
    const delay = Math.min(this.backoffMaxMs, this.backoffBaseMs * 2 ** entry.attempts);
    const jitter = Math.floor(Math.random() * Math.min(1_000, delay / 2));
    await this.db.releaseFailed(
      entry.mutationId,
      new Date(Date.now() + delay + jitter).toISOString(),
      error,
    );
  }
}
