import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { SqlExecutor } from '@gymlytics/sync';

/**
 * OPFS-backed SQLite inside the browser. The kiosk keeps the SAME DDL subset
 * as the server (generated from packages/db), so a pulled row can be applied
 * with a generic upsert and no field-name drift.
 *
 * If OPFS is unavailable (dev on a locked-down browser), fall back to an
 * in-memory DB: check-ins still work for the session, they just don't survive
 * a reboot. Production kiosks must run in a context with OPFS enabled.
 */
const KIOSK_DDL = `
CREATE TABLE IF NOT EXISTS sync_outbox (
  id TEXT PRIMARY KEY, mutation_id TEXT NOT NULL UNIQUE, academy_id TEXT NOT NULL,
  device_id TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, payload TEXT NOT NULL, hlc TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  last_error TEXT, idempotency_key TEXT NOT NULL UNIQUE, origin_device_id TEXT NOT NULL,
  created_at TEXT NOT NULL, acked_at TEXT
);
CREATE INDEX IF NOT EXISTS outbox_status_next_idx ON sync_outbox(status, next_attempt_at);
CREATE TABLE IF NOT EXISTS local_sync_meta (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attendance_logs (
  id TEXT PRIMARY KEY, academy_id TEXT NOT NULL, class_id TEXT NOT NULL, user_id TEXT NOT NULL,
  booking_id TEXT, checked_in_at TEXT NOT NULL, checked_out_at TEXT, method TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'checked_in', kiosk_id TEXT, drop_in_transaction_id TEXT,
  notes TEXT, version INTEGER NOT NULL DEFAULT 1, hlc TEXT NOT NULL,
  origin_device_id TEXT NOT NULL, sync_status TEXT NOT NULL DEFAULT 'local',
  mutation_id TEXT NOT NULL, synced_at TEXT, conflict_of_id TEXT, last_error TEXT,
  deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_mutation_uq ON attendance_logs(mutation_id);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_once_per_class_uq
  ON attendance_logs(class_id, user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS attendance_hlc_idx ON attendance_logs(hlc);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, academy_id TEXT, role TEXT, status TEXT, first_name TEXT NOT NULL,
  last_name TEXT NOT NULL, email TEXT, phone TEXT, pin_hash TEXT, qr_token TEXT,
  hlc TEXT, version INTEGER DEFAULT 1, origin_device_id TEXT, sync_status TEXT,
  mutation_id TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
  -- Kiosk-only denormalised fields so the tablet can decide eligibility offline.
  waiver_valid INTEGER DEFAULT 0, waiver_expires_at TEXT, membership_status TEXT,
  membership_plan_type TEXT, classes_per_week INTEGER, class_pack_count INTEGER
);
CREATE INDEX IF NOT EXISTS users_pin_idx ON users(pin_hash);
CREATE INDEX IF NOT EXISTS users_qr_idx ON users(qr_token);
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY, academy_id TEXT, program_id TEXT, program_name TEXT, title TEXT,
  starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, capacity INTEGER NOT NULL,
  booked_count INTEGER DEFAULT 0, location TEXT, deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS classes_starts_idx ON classes(starts_at);
CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY, academy_id TEXT, class_id TEXT, user_id TEXT, status TEXT,
  source TEXT, booked_at TEXT, cancelled_at TEXT, hlc TEXT, version INTEGER DEFAULT 1,
  origin_device_id TEXT, sync_status TEXT, mutation_id TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS waivers (
  id TEXT PRIMARY KEY, academy_id TEXT, user_id TEXT, waiver_type TEXT, document_version INTEGER,
  signature_data TEXT, signer_name TEXT, signed_at TEXT, status TEXT, expires_at TEXT,
  hlc TEXT, version INTEGER DEFAULT 1, origin_device_id TEXT, sync_status TEXT,
  mutation_id TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY, academy_id TEXT, type TEXT, status TEXT, user_id TEXT,
  total_cents INTEGER, currency TEXT, provider TEXT, provider_transaction_id TEXT,
  idempotency_key TEXT, failure_code TEXT, processed_at TEXT, hlc TEXT,
  version INTEGER DEFAULT 1, origin_device_id TEXT, sync_status TEXT,
  mutation_id TEXT, created_at TEXT, updated_at TEXT
);
`;

interface DbHandle {
  exec(options: {
    sql: string;
    bind?: unknown[];
    rowMode?: string;
    callback?: (row: unknown) => void;
  }): void;
}

let executor: Promise<SqlExecutor> | null = null;

export function getKioskSql(): Promise<SqlExecutor> {
  executor ??= createExecutor();
  return executor;
}

async function createExecutor(): Promise<SqlExecutor> {
  const sqlite3 = (await sqlite3InitModule()) as any; // sqlite-wasm ships no types
  let handle: DbHandle;
  try {
    handle = new sqlite3.oo1.OpfsDb('/gymlytics-kiosk.sqlite3', 'ct') as DbHandle;
  } catch {
    handle = new sqlite3.oo1.DB(':memory:', 'ct') as DbHandle;
  }

  handle.exec({ sql: KIOSK_DDL });

  return {
    async execute(sql, params = []) {
      handle.exec({ sql, bind: params });
    },
    async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      const rows: T[] = [];
      handle.exec({
        sql,
        bind: params,
        rowMode: 'object',
        callback: (row) => rows.push(row as T),
      });
      return rows;
    },
  };
}
