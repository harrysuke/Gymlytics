import { GENESIS_HLC } from '@gymlytics/shared';
import type { ApplyOutcome, LocalDatabase, OutboxEntry, PullChange, StoredVersion } from '../types';

/**
 * Minimal async SQL surface shared by @sqlite.org/sqlite-wasm (kiosk),
 * better-sqlite3 (tests) and expo-sqlite (mobile). No browser globals here.
 */
export interface SqlExecutor {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

const OUTBOX_SELECT = `
  SELECT mutation_id AS mutationId, academy_id AS academyId, device_id AS deviceId,
         entity, entity_id AS entityId, operation, payload, hlc, version,
         status, attempts, next_attempt_at AS nextAttemptAt,
         last_error AS lastError, created_at AS createdAt
  FROM sync_outbox`;

/** Whitelist prevents SQL injection from server-controlled entity names. */
const ENTITY_TABLE: Record<string, string> = {
  attendance_log: 'attendance_logs',
  booking: 'bookings',
  waiver: 'waivers',
  dropin_user: 'users',
  member: 'users',
  retail_transaction: 'transactions',
};

const SYNC_COLUMNS: Record<string, string> = {
  attendance_log: 'attendance_logs',
  waiver: 'waivers',
};

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export class SqliteLocalDatabase implements LocalDatabase {
  constructor(private readonly sql: SqlExecutor) {}

  /** NOTE: not re-entrant — the engine serialises push and pull itself. */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.sql.execute('BEGIN IMMEDIATE');
    try {
      const result = await fn();
      await this.sql.execute('COMMIT');
      return result;
    } catch (error) {
      await this.sql.execute('ROLLBACK');
      throw error;
    }
  }

  async enqueue(entry: OutboxEntry): Promise<void> {
    await this.sql.execute(
      `INSERT INTO sync_outbox
       (id, mutation_id, academy_id, device_id, entity, entity_id, operation,
        payload, hlc, version, status, attempts, next_attempt_at, last_error,
        idempotency_key, origin_device_id, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(mutation_id) DO NOTHING`,
      [
        entry.mutationId,
        entry.mutationId,
        entry.academyId,
        entry.deviceId,
        entry.entity,
        entry.entityId,
        entry.operation,
        JSON.stringify(entry.payload),
        entry.hlc,
        entry.version,
        'pending',
        0,
        entry.nextAttemptAt,
        null,
        entry.mutationId,
        entry.deviceId,
        entry.createdAt,
      ],
    );
  }

  async claimBatch(limit: number, nowIso: string): Promise<OutboxEntry[]> {
    return this.transaction(async () => {
      const rows = await this.sql.query<OutboxEntry>(
        `${OUTBOX_SELECT}
         WHERE status IN ('pending','failed') AND next_attempt_at <= ?
         ORDER BY created_at ASC LIMIT ?`,
        [nowIso, limit],
      );
      if (rows.length > 0) {
        const placeholders = rows.map(() => '?').join(',');
        await this.sql.execute(
          `UPDATE sync_outbox SET status='inflight' WHERE mutation_id IN (${placeholders})`,
          rows.map((row) => row.mutationId),
        );
      }
      return rows.map((row) => ({ ...row, payload: parsePayload(row.payload) }));
    });
  }

  async markInflight(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.sql.execute(
      `UPDATE sync_outbox SET status='inflight' WHERE mutation_id IN (${placeholders})`,
      ids,
    );
  }

  async ack(mutationId: string, serverHlc: string): Promise<void> {
    await this.transaction(async () => {
      const row = await this.sql.query<{ entity: string; entity_id: string }>(
        'SELECT entity, entity_id FROM sync_outbox WHERE mutation_id = ?',
        [mutationId],
      );
      await this.sql.execute(
        `UPDATE sync_outbox SET status='acked', acked_at=?, hlc=? WHERE mutation_id=?`,
        [new Date().toISOString(), serverHlc, mutationId],
      );
      const entity = row[0];
      const table = entity ? SYNC_COLUMNS[entity.entity] : undefined;
      if (table && entity) {
        await this.sql.execute(
          `UPDATE ${table} SET sync_status='synced', synced_at=?, hlc=? WHERE mutation_id=?`,
          [new Date().toISOString(), serverHlc, mutationId],
        );
      }
    });
  }

  async releaseFailed(mutationId: string, nextAttemptAt: string, error: string): Promise<void> {
    await this.sql.execute(
      `UPDATE sync_outbox
       SET status='failed', attempts=attempts+1, next_attempt_at=?, last_error=?
       WHERE mutation_id=?`,
      [nextAttemptAt, error.slice(0, 1_000), mutationId],
    );
  }

  async markConflict(mutationId: string, error: string): Promise<void> {
    await this.sql.execute(
      `UPDATE sync_outbox SET status='failed', last_error=? WHERE mutation_id=?`,
      [`CONFLICT: ${error}`.slice(0, 1_000), mutationId],
    );
  }

  async pendingCount(): Promise<number> {
    const rows = await this.sql.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM sync_outbox WHERE status IN ('pending','failed')`,
    );
    return rows[0]?.count ?? 0;
  }

  async conflictCount(): Promise<number> {
    const rows = await this.sql.query<{ count: number }>(
      `SELECT COUNT(*) AS count FROM sync_outbox WHERE last_error LIKE 'CONFLICT:%' AND status <> 'acked'`,
    );
    return rows[0]?.count ?? 0;
  }

  async getStoredVersion(entity: string, entityId: string): Promise<StoredVersion | null> {
    const table = SYNC_COLUMNS[entity];
    if (!table) return null;
    const rows = await this.sql.query<StoredVersion>(
      `SELECT hlc, version, origin_device_id AS deviceId FROM ${table} WHERE id = ?`,
      [entityId],
    );
    return rows[0] ?? null;
  }

  /**
   * Generic upsert for remote changes. In production each entity gets a
   * generated applier that also cascades to local child rows; the whitelist
   * and key filtering here are the security boundary in the meantime.
   */
  async applyRemote(change: PullChange): Promise<ApplyOutcome> {
    const table = ENTITY_TABLE[change.entity];
    if (!table) return 'duplicate';

    const entries = Object.entries(change.payload).filter(
      ([key, value]) =>
        /^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) &&
        value !== undefined &&
        typeof value !== 'object',
    );
    if (entries.length === 0) return 'duplicate';

    const columns = entries.map(([key]) => snake(key));
    const params = entries.map(([, value]) => (typeof value === 'boolean' ? Number(value) : value));
    const placeholders = columns.map(() => '?').join(',');
    const updates = columns.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`);
    if (updates.length === 0) return 'duplicate';

    if (change.operation === 'delete') {
      await this.sql.execute(`DELETE FROM ${table} WHERE id = ?`, [change.entityId]);
      return 'applied';
    }

    await this.sql.execute(
      `INSERT INTO ${table} (${columns.join(',')})
       VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updates.join(',')}`,
      params,
    );
    return 'applied';
  }

  async getCursor(): Promise<string> {
    const rows = await this.sql.query<{ value: string }>(
      `SELECT value FROM local_sync_meta WHERE key = 'sync_cursor'`,
    );
    return rows[0]?.value ?? GENESIS_HLC;
  }

  async setCursor(hlc: string): Promise<void> {
    await this.sql.execute(
      `INSERT INTO local_sync_meta (key, value, updated_at) VALUES ('sync_cursor', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      [hlc, new Date().toISOString()],
    );
  }
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return (value ?? {}) as Record<string, unknown>;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
