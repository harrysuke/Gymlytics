import { GENESIS_HLC } from '@gymlytics/shared';
import { resolveRemoteChange, shouldFlagConflict } from './conflict';
import { HybridLogicalClock } from './hlc';
import { Outbox } from './outbox';
import type { HlcClock, SyncEngineOptions, SyncState } from './types';

/**
 * Drive the two halves of delta sync:
 *   PUSH  — drain local outbox in bounded batches, honour server acks
 *   PULL  — fetch changes since our HLC cursor, apply LWW, advance cursor
 *
 * Both loops are safe to call concurrently and safe to interrupt: the kiosk
 * can be powered off at any point and resumes from durable local state.
 */
export class SyncEngine {
  private readonly db: NonNullable<SyncEngineOptions['db']>;
  private readonly transport: NonNullable<SyncEngineOptions['transport']>;
  private readonly clock: HlcClock;
  private readonly outbox: Outbox;
  private readonly academyId: string;
  private readonly deviceId: string;
  private readonly batchSize: number;
  private readonly pushIntervalMs: number;
  private readonly pullIntervalMs: number;
  private readonly onStateChange?: SyncEngineOptions['onStateChange'];
  private readonly isOnline: () => boolean;

  private timers: ReturnType<typeof setInterval>[] = [];
  private controller: AbortController | null = null;
  private pushing = false;
  private pulling = false;
  private started = false;
  private state: SyncState;

  constructor(options: SyncEngineOptions) {
    this.db = options.db;
    this.transport = options.transport;
    this.academyId = options.academyId;
    this.deviceId = options.deviceId;
    this.clock = options.clock ?? new HybridLogicalClock(options.deviceId);
    this.outbox = new Outbox(
      this.db,
      this.academyId,
      this.deviceId,
      this.clock,
      options.backoffBaseMs,
      options.backoffMaxMs,
    );
    this.batchSize = options.batchSize ?? 100;
    this.pushIntervalMs = options.pushIntervalMs ?? 5_000;
    this.pullIntervalMs = options.pullIntervalMs ?? 15_000;
    this.onStateChange = options.onStateChange;
    this.isOnline =
      options.isOnline ??
      (() => {
        const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
        return nav?.onLine ?? true;
      });
    this.state = {
      online: this.isOnline(),
      queued: 0,
      conflicts: 0,
      pushing: false,
      lastSyncedAt: null,
      lastError: null,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.timers.push(setInterval(() => void this.push(), this.pushIntervalMs));
    this.timers.push(setInterval(() => void this.pull(), this.pullIntervalMs));

    const target = browserEvents();
    if (target) {
      target.addEventListener('online', this.handleOnline);
      target.addEventListener('offline', this.handleOffline);
      this.handleOnline();
    }
    void this.refreshCounters();
  }

  stop(): void {
    this.started = false;
    this.timers.forEach(clearInterval);
    this.timers = [];
    this.controller?.abort();
    const target = browserEvents();
    if (target) {
      target.removeEventListener('online', this.handleOnline);
      target.removeEventListener('offline', this.handleOffline);
    }
  }

  /** Force a full cycle — useful for the "Sync now" button on the kiosk. */
  async syncNow(): Promise<SyncState> {
    await this.push();
    await this.pull();
    await this.refreshCounters();
    return this.getState();
  }

  getState(): SyncState {
    return { ...this.state };
  }

  getOutbox(): Outbox {
    return this.outbox;
  }

  getClock(): HlcClock {
    return this.clock;
  }

  private handleOnline = (): void => {
    this.state = { ...this.state, online: true };
    this.emit();
    void this.syncNow();
  };

  private handleOffline = (): void => {
    this.state = { ...this.state, online: false, pushing: false };
    this.emit();
  };

  private async push(): Promise<void> {
    if (this.pushing || !this.isOnline()) return;
    this.pushing = true;
    this.state = { ...this.state, pushing: true };
    this.emit();
    this.controller = new AbortController();

    try {
      await this.outbox.drain(this.transport, this.batchSize, this.controller.signal, this.isOnline);
      this.state = {
        ...this.state,
        pushing: false,
        lastSyncedAt: new Date().toISOString(),
        lastError: null,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        pushing: false,
        lastError: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.pushing = false;
      this.emit();
    }
  }

  private async pull(): Promise<void> {
    if (this.pulling || !this.isOnline()) return;
    this.pulling = true;

    try {
      const since = (await this.db.getCursor()) || GENESIS_HLC;
      const result = await this.transport.pull(this.academyId, this.deviceId, since);
      this.clock.observe(result.serverHlc);

      for (const change of result.changes) {
        const local = await this.db.getStoredVersion(change.entity, change.entityId);
        const outcome = resolveRemoteChange(local, change);
        if (outcome === 'applied') {
          await this.db.applyRemote(change);
        } else if (shouldFlagConflict(change.entity, outcome, Boolean(local))) {
          // The conflict is recorded on the outbox row; admin UI can resolve.
          await this.db.markConflict(change.entityId, `Remote ${change.entity} lost LWW comparison`);
        }
        this.clock.observe(change.hlc);
      }

      await this.db.setCursor(result.serverHlc);
      this.state = { ...this.state, lastError: null };
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.pulling = false;
      this.emit();
    }
  }

  private async refreshCounters(): Promise<void> {
    this.state = {
      ...this.state,
      online: this.isOnline(),
      queued: await this.db.pendingCount(),
      conflicts: await this.db.conflictCount(),
    };
    this.emit();
  }

  private emit(): void {
    this.onStateChange?.({ ...this.state });
  }
}

/**
 * Minimal structural type for the browser global that emits `online` / `offline`.
 *
 * Written against `globalThis` rather than `window` so this module compiles in a
 * Node-only project (the API imports it for its appliers) without pulling in the
 * DOM lib. Returns null on Node / React Native, where the engine simply relies
 * on `isOnline` being injected.
 */
interface EventSourceLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

function browserEvents(): EventSourceLike | null {
  const candidate = (globalThis as { addEventListener?: unknown }).addEventListener;
  if (typeof candidate !== 'function') return null;
  return globalThis as unknown as EventSourceLike;
}
