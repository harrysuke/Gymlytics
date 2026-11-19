import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { bookings, classes } from './classes';
import { users } from './users';
import { transactions } from './commerce';
import { createdAt, deletedAt, id, json, nullableIso, updatedAt } from './_shared';

export const CHECK_IN_METHODS = ['pin', 'qr', 'name_search', 'admin', 'mobile', 'guardian'] as const;
export const SYNC_STATUS = ['local', 'pending', 'synced', 'conflict'] as const;
export const MUTATION_ORIGINS = ['kiosk', 'web', 'mobile', 'server'] as const;

/**
 * ATTENDANCE — the offline-critical table.
 *
 * The kiosk generates `id` (UUIDv7) and `mutationId` BEFORE network access,
 * so a check-in can be committed locally and replayed safely any number of
 * times. `version` + `hlc` drive optimistic concurrency; `syncStatus` drives
 * the kiosk UI ("Queued 3"). Conflict rows are flagged, never silently lost.
 */
export const attendanceLogs = sqliteTable(
  'attendance_logs',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'set null' }),

    checkedInAt: text('checked_in_at').notNull(),
    checkedOutAt: nullableIso('checked_out_at'),
    method: text('method', { enum: CHECK_IN_METHODS }).notNull(),
    status: text('status', {
      enum: ['checked_in', 'checked_out', 'no_show', 'cancelled'],
    })
      .notNull()
      .default('checked_in'),
    kioskId: text('kiosk_id'),
    dropInTransactionId: text('drop_in_transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),

    // ---- sync / CRDT metadata ----
    version: integer('version').notNull().default(1),
    hlc: text('hlc').notNull(), // Hybrid Logical Clock: "2026-11-19T10:12:33.001Z-0001-kiosk-a"
    originDeviceId: text('origin_device_id').notNull(),
    syncStatus: text('sync_status', { enum: SYNC_STATUS }).notNull().default('local'),
    mutationId: text('mutation_id').notNull(),
    syncedAt: nullableIso('synced_at'),
    conflictOfId: text('conflict_of_id'),
    lastError: text('last_error'),
    deletedAt: deletedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('attendance_mutation_uq').on(t.mutationId),
    uniqueIndex('attendance_once_per_class_uq')
      .on(t.classId, t.userId)
      .where(sql`deleted_at IS NULL`),
    index('attendance_sync_queue_idx').on(t.academyId, t.syncStatus),
    index('attendance_hlc_idx').on(t.hlc),
    index('attendance_user_date_idx').on(t.userId, t.checkedInAt),
  ],
);

/**
 * LOCAL-ONLY table (kiosk SQLite / OPFS). Mirrored here so Drizzle generates
 * the exact same DDL on device and server — no schema drift between them.
 */
export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: id(), // equals the client mutation id
    academyId: text('academy_id').notNull(),
    entity: text('entity', {
      enum: ['attendance_log', 'booking', 'waiver', 'dropin_user', 'member', 'retail_transaction'],
    }).notNull(),
    entityId: text('entity_id').notNull(),
    operation: text('operation', { enum: ['insert', 'update', 'delete'] }).notNull(),
    payload: json<Record<string, unknown>>('payload').notNull(),
    status: text('status', { enum: ['pending', 'inflight', 'failed', 'acked'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at').notNull(),
    lastError: text('last_error'),
    hlc: text('hlc').notNull(),
    originDeviceId: text('origin_device_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    createdAt: createdAt(),
    ackedAt: nullableIso('acked_at'),
  },
  (t) => [
    index('outbox_status_next_idx').on(t.status, t.nextAttemptAt),
    index('outbox_entity_idx').on(t.entity, t.entityId),
  ],
);

/** Server-side pull cursor per kiosk device. */
export const syncCursors = sqliteTable(
  'sync_cursors',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    lastServerHlc: text('last_server_hlc').notNull().default('1970-01-01T00:00:00.000Z-0000'),
    lastPulledAt: text('last_pulled_at').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sync_cursor_uq').on(t.academyId, t.deviceId)],
);

/** Kiosk-local key/value store for the pull cursor and device settings. */
export const localSyncMeta = sqliteTable('local_sync_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});

/** Server idempotency ledger: replayed mutations return the original result. */
export const appliedMutations = sqliteTable('applied_mutations', {
  mutationId: text('mutation_id').primaryKey(),
  academyId: text('academy_id').notNull(),
  deviceId: text('device_id').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  resultJson: json<Record<string, unknown>>('result_json').notNull(),
  createdAt: createdAt(),
});

/**
 * Unified server change feed. Every write that a kiosk may need — whether it
 * arrived through /v1/sync/push or an admin REST route — appends one row here.
 * Pull becomes a single indexed query instead of N table scans, and adding a
 * new synced entity needs no new cursor column.
 */
export const syncChanges = sqliteTable(
  'sync_changes',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    entity: text('entity', {
      enum: ['attendance_log', 'booking', 'waiver', 'dropin_user', 'member', 'retail_transaction'],
    }).notNull(),
    entityId: text('entity_id').notNull(),
    operation: text('operation', { enum: ['insert', 'update', 'delete'] }).notNull(),
    payload: json<Record<string, unknown>>('payload').notNull(),
    hlc: text('hlc').notNull(),
    version: integer('version').notNull().default(1),
    originDeviceId: text('origin_device_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('sync_changes_pull_idx').on(t.academyId, t.hlc),
    index('sync_changes_entity_idx').on(t.entity, t.entityId),
  ],
);
