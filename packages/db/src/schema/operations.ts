import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { users } from './users';
import { PROVIDERS } from './billing';
import { createdAt, id, json, nullableIso } from './_shared';

/**
 * Idempotent webhook ledger. The natural key is provider + external event id:
 * the handler INSERTs before processing; a conflict means "already seen" and
 * returns 200 without re-applying side effects.
 */
export const webhookEvents = sqliteTable(
  'webhook_events',
  {
    id: id(),
    academyId: text('academy_id').references(() => academies.id, { onDelete: 'cascade' }),
    provider: text('provider', { enum: PROVIDERS }).notNull(),
    externalEventId: text('external_event_id').notNull(),
    eventType: text('event_type').notNull(), // normalised domain event
    signatureValid: integer('signature_valid', { mode: 'boolean' }).notNull().default(false),
    payload: json<Record<string, unknown>>('payload').notNull(),
    status: text('status', {
      enum: ['received', 'processing', 'processed', 'failed', 'ignored'],
    })
      .notNull()
      .default('received'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    processedAt: nullableIso('processed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('webhook_event_uq').on(t.provider, t.externalEventId),
    index('webhook_status_idx').on(t.status, t.createdAt),
  ],
);

/** Cron-driven notification queue: missed class, belt eligibility, dunning. */
export const notificationJobs = sqliteTable(
  'notification_jobs',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    type: text('type', {
      enum: [
        'booking_reminder',
        'missed_class',
        'belt_eligibility',
        'payment_failed',
        'waiver_expiring',
        'freeze_ending',
      ],
    }).notNull(),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['sms', 'email', 'push'] }).notNull(),
    payload: json<Record<string, unknown>>('payload').notNull(),
    /** Stable key (e.g. "belt:<userId>:<rankId>") prevents duplicate nightly alerts. */
    dedupeKey: text('dedupe_key').unique(),
    scheduledAt: text('scheduled_at').notNull(),
    sentAt: nullableIso('sent_at'),
    status: text('status', { enum: ['pending', 'sent', 'failed', 'cancelled'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [index('notification_due_idx').on(t.status, t.scheduledAt)],
);
