import type { SyncAck, SyncMutation, SyncPullResult, SyncPushResult } from '@gymlytics/shared';

export type OutboxStatus = 'pending' | 'inflight' | 'failed' | 'acked';

export interface OutboxEntry {
  mutationId: string;
  academyId: string;
  deviceId: string;
  entity: SyncMutation['entity'];
  entityId: string;
  operation: SyncMutation['operation'];
  payload: Record<string, unknown>;
  hlc: string;
  version: number;
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
}

export interface PullChange {
  entity: string;
  entityId: string;
  operation: 'insert' | 'update' | 'delete';
  payload: Record<string, unknown>;
  hlc: string;
  version: number;
}

export interface StoredVersion {
  hlc: string;
  version: number;
  deviceId: string | null;
}

export type ApplyOutcome = 'applied' | 'duplicate' | 'conflict';

/**
 * Storage contract. Implemented once for the kiosk with sqlite-wasm + OPFS
 * (see adapters/local-sqlite.ts) and once in tests with an in-memory fake.
 * Keeping this interface narrow means the sync engine never imports a
 * browser API and can run in Node tests or even inside a service worker.
 */
export interface LocalDatabase {
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  enqueue(entry: OutboxEntry): Promise<void>;
  claimBatch(limit: number, nowIso: string): Promise<OutboxEntry[]>;
  markInflight(ids: string[]): Promise<void>;
  ack(mutationId: string, serverHlc: string): Promise<void>;
  releaseFailed(mutationId: string, nextAttemptAt: string, error: string): Promise<void>;
  markConflict(mutationId: string, error: string): Promise<void>;
  pendingCount(): Promise<number>;
  conflictCount(): Promise<number>;
  getStoredVersion(entity: string, entityId: string): Promise<StoredVersion | null>;
  applyRemote(change: PullChange): Promise<ApplyOutcome>;
  getCursor(): Promise<string>;
  setCursor(hlc: string): Promise<void>;
}

export interface SyncTransport {
  push(
    academyId: string,
    deviceId: string,
    mutations: SyncMutation[],
    signal?: AbortSignal,
  ): Promise<SyncPushResult>;
  pull(
    academyId: string,
    deviceId: string,
    since: string,
    signal?: AbortSignal,
  ): Promise<SyncPullResult>;
}

export interface SyncState {
  online: boolean;
  queued: number;
  conflicts: number;
  pushing: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

/** Minimal clock contract shared by the engine and outbox. */
export interface HlcClock {
  tick(): string;
  observe(hlc: string): void;
}

export interface SyncEngineOptions {
  db: LocalDatabase;
  transport: SyncTransport;
  academyId: string;
  deviceId: string;
  clock?: HlcClock;
  pushIntervalMs?: number;
  pullIntervalMs?: number;
  batchSize?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  onStateChange?: (state: SyncState) => void;
  isOnline?: () => boolean;
}

export interface PushOutcome {
  sent: number;
  accepted: number;
  conflicts: number;
  deferred: number;
}

export type { SyncAck, SyncMutation, SyncPullResult, SyncPushResult };
