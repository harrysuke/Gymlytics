import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { curriculumTechniques, programs } from './programs';
import { users } from './users';
import { createdAt, deletedAt, flag, id, nullableIso, updatedAt } from './_shared';

/** Recurring schedule template. RRULE keeps complex schedules data-driven. */
export const classTemplates = sqliteTable(
  'class_templates',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    coachId: text('coach_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    dayOfWeek: integer('day_of_week').notNull(), // 0 = Sunday
    startTime: text('start_time').notNull(), // 'HH:mm' in academy timezone
    durationMinutes: integer('duration_minutes').notNull().default(90),
    capacity: integer('capacity').notNull().default(20),
    location: text('location'),
    recurrenceRule: text('recurrence_rule').notNull().default('FREQ=WEEKLY;INTERVAL=1'),
    effectiveFrom: text('effective_from'),
    effectiveUntil: text('effective_until'),
    isActive: flag('is_active', true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('class_templates_academy_idx').on(t.academyId, t.dayOfWeek)],
);

/** Concrete class instance (materialised from a template). */
export const classes = sqliteTable(
  'classes',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'restrict' }),
    templateId: text('template_id').references(() => classTemplates.id, { onDelete: 'set null' }),
    coachId: text('coach_id').references(() => users.id, { onDelete: 'set null' }),
    substituteCoachId: text('substitute_coach_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    startsAt: text('starts_at').notNull(), // ISO-8601 UTC
    endsAt: text('ends_at').notNull(),
    capacity: integer('capacity').notNull().default(20),
    bookedCount: integer('booked_count').notNull().default(0), // denormalised counter
    checkedInCount: integer('checked_in_count').notNull().default(0),
    location: text('location'),
    notes: text('notes'),
    status: text('status', {
      enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
    })
      .notNull()
      .default('scheduled'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('classes_academy_starts_idx').on(t.academyId, t.startsAt),
    index('classes_program_starts_idx').on(t.programId, t.startsAt),
  ],
);

export const BOOKING_STATUS = [
  'booked',
  'waitlisted',
  'checked_in',
  'attended',
  'no_show',
  'cancelled',
] as const;

export const bookings = sqliteTable(
  'bookings',
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
    status: text('status', { enum: BOOKING_STATUS }).notNull().default('booked'),
    source: text('source', { enum: ['web', 'mobile', 'kiosk', 'admin'] })
      .notNull()
      .default('web'),
    bookedAt: text('booked_at').notNull().$defaultFn(() => new Date().toISOString()),
    cancelledAt: nullableIso('cancelled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('bookings_active_uq')
      .on(t.classId, t.userId)
      .where(sql`status <> 'cancelled'`),
    index('bookings_user_idx').on(t.userId, t.bookedAt),
    index('bookings_class_status_idx').on(t.classId, t.status),
  ],
);

/** What a coach actually taught in a given class (curriculum tracker). */
export const classTechniques = sqliteTable(
  'class_techniques',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    techniqueId: text('technique_id')
      .notNull()
      .references(() => curriculumTechniques.id, { onDelete: 'cascade' }),
    taughtBy: text('taught_by').notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('class_technique_uq').on(t.classId, t.techniqueId)],
);
