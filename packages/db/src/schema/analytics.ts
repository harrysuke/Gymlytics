/**
 * Analytics source tables.
 *
 * Most metrics are derived from existing facts (attendance, promotions,
 * transactions). These two tables capture the few events that had nowhere to
 * live before: the acquisition funnel and on-mat safety incidents.
 */
import { relations } from 'drizzle-orm';
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { users } from './users';
import { programs } from './programs';
import { classes } from './classes';
import { createdAt, deletedAt, flag, id, nullableIso, updatedAt } from './_shared';

export const LEAD_SOURCES = [
  'walk_in',
  'social_media',
  'ads',
  'member_referral',
  'website',
  'other',
] as const;

export const LEAD_STATUSES = [
  'new',
  'contacted',
  'trial_scheduled',
  'trial_attended',
  'converted',
  'lost',
] as const;

/**
 * One prospect, from first contact through trial and (optionally) membership.
 * `convertedMembershipId` is intentionally untyped to avoid a schema cycle
 * with billing; the id is still validated by the API when it is written.
 */
export const leads = sqliteTable(
  'leads',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    source: text('source', { enum: LEAD_SOURCES }).notNull().default('walk_in'),
    referredByUserId: text('referred_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: LEAD_STATUSES }).notNull().default('new'),
    trialAttendedAt: nullableIso('trial_attended_at'),
    convertedAt: nullableIso('converted_at'),
    convertedMembershipId: text('converted_membership_id'),
    lastContactAt: nullableIso('last_contact_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('leads_academy_status_idx').on(t.academyId, t.status),
    index('leads_academy_source_idx').on(t.academyId, t.source),
    uniqueIndex('leads_academy_email_idx').on(t.academyId, t.email),
  ],
);

export const INCIDENT_TYPES = ['injury', 'near_miss', 'equipment', 'other'] as const;
export const INCIDENT_SEVERITIES = ['minor', 'moderate', 'severe'] as const;
export const INCIDENT_STATUSES = ['open', 'follow_up', 'closed'] as const;

/** Formal, immutable-in-spirit record of an on-mat safety event. */
export const incidents = sqliteTable(
  'incidents',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    programId: text('program_id').references(() => programs.id, { onDelete: 'set null' }),
    classId: text('class_id').references(() => classes.id, { onDelete: 'set null' }),
    occurredAt: text('occurred_at').notNull(),
    location: text('location'),
    type: text('type', { enum: INCIDENT_TYPES }).notNull().default('injury'),
    severity: text('severity', { enum: INCIDENT_SEVERITIES }).notNull().default('minor'),
    description: text('description').notNull(),
    actionTaken: text('action_taken'),
    witnessName: text('witness_name'),
    reportedByUserId: text('reported_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    followUpRequired: flag('follow_up_required', false),
    followUpCompletedAt: nullableIso('follow_up_completed_at'),
    status: text('status', { enum: INCIDENT_STATUSES }).notNull().default('open'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('incidents_academy_date_idx').on(t.academyId, t.occurredAt),
    index('incidents_academy_status_idx').on(t.academyId, t.status),
  ],
);

export const leadsRelations = relations(leads, ({ one }) => ({
  academy: one(academies, { fields: [leads.academyId], references: [academies.id] }),
  referrer: one(users, { fields: [leads.referredByUserId], references: [users.id] }),
}));

export const incidentsRelations = relations(incidents, ({ one }) => ({
  academy: one(academies, { fields: [incidents.academyId], references: [academies.id] }),
  member: one(users, { fields: [incidents.userId], references: [users.id] }),
  program: one(programs, { fields: [incidents.programId], references: [programs.id] }),
  class: one(classes, { fields: [incidents.classId], references: [classes.id] }),
}));
