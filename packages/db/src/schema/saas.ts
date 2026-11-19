/**
 * SaaS / network-layer tables.
 *
 * Tenant isolation is unchanged: every row still carries `academy_id` and the
 * API derives that id from the auth token, never from a request body. Network
 * rollups are an explicit, permission-checked read across descendant academy
 * ids — they never widen writes.
 */
import { relations, sql } from 'drizzle-orm';
import { index, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { users } from './users';
import { classes } from './classes';
import { programs } from './programs';
import { createdAt, counter, deletedAt, flag, id, iso, json, nullableIso, updatedAt } from './_shared';

export const SAAS_PLAN_SLUGS = ['starter', 'growth', 'network'] as const;
export const SAAS_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'cancelled',
] as const;
export const IMPORT_TYPES = ['members', 'belt_ranks', 'billing_mandates'] as const;
export const IMPORT_STATUSES = ['pending', 'completed', 'failed'] as const;
export const WIDGET_KINDS = ['schedule', 'trial_form', 'waiver_link'] as const;
export const PASS_STATUSES = ['requested', 'approved', 'checked_in', 'expired'] as const;

/** Catalogue of purchasable modules. Feature keys are stable API identifiers. */
export const saasPlans = sqliteTable(
  'saas_plans',
  {
    id: id(),
    slug: text('slug', { enum: SAAS_PLAN_SLUGS }).notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    priceCents: counter('price_cents'),
    currency: text('currency').notNull().default('MYR'),
    features: json<string[]>('features').notNull().$defaultFn(() => []),
    sortOrder: counter('sort_order'),
    isPublic: flag('is_public', true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('saas_plans_sort_idx').on(t.sortOrder)],
);

export const academySubscriptions = sqliteTable(
  'academy_subscriptions',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .unique()
      .references(() => academies.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => saasPlans.id),
    status: text('status', { enum: SAAS_SUBSCRIPTION_STATUSES })
      .notNull()
      .default('trialing'),
    trialEndsAt: nullableIso('trial_ends_at'),
    currentPeriodEnd: nullableIso('current_period_end'),
    provider: text('provider'),
    providerSubscriptionId: text('provider_subscription_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('academy_subscriptions_status_idx').on(t.status)],
);

export const ONBOARDING_STEPS = [
  'profile',
  'locations',
  'programs',
  'members',
  'billing',
  'team',
] as const;

/** Self-serve setup checklist. Steps are idempotent and can be revisited. */
export const onboardingProgress = sqliteTable(
  'onboarding_progress',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .unique()
      .references(() => academies.id, { onDelete: 'cascade' }),
    currentStep: text('current_step').notNull().default('profile'),
    completedSteps: json<string[]>('completed_steps').notNull().$defaultFn(() => []),
    completedAt: nullableIso('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
);

export interface ImportRowError {
  row: number;
  message: string;
}

export const importJobs = sqliteTable(
  'import_jobs',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    type: text('type', { enum: IMPORT_TYPES }).notNull(),
    status: text('status', { enum: IMPORT_STATUSES }).notNull().default('pending'),
    fileName: text('file_name'),
    totalRows: counter('total_rows'),
    importedRows: counter('imported_rows'),
    errors: json<ImportRowError[]>('errors').notNull().$defaultFn(() => []),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [index('import_jobs_academy_created_idx').on(t.academyId, t.createdAt)],
);

export interface WidgetConfig {
  programId?: string;
  limit?: number;
  title?: string;
  accentColor?: string;
  redirectUrl?: string;
  beltSlug?: string;
}

/** Public embed tokens are random, revocable, and scoped to one academy. */
export const widgets = sqliteTable(
  'widgets',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: WIDGET_KINDS }).notNull(),
    token: text('token').notNull().unique(),
    label: text('label').notNull(),
    config: json<WidgetConfig>('config').notNull().$defaultFn(() => ({})),
    enabled: flag('enabled', true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('widgets_academy_kind_idx').on(t.academyId, t.kind)],
);

export const curriculumVideos = sqliteTable(
  'curriculum_videos',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    programId: text('program_id').references(() => programs.id, { onDelete: 'cascade' }),
    beltSlug: text('belt_slug'),
    title: text('title').notNull(),
    description: text('description'),
    url: text('url').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    durationSeconds: counter('duration_seconds'),
    sortOrder: counter('sort_order'),
    published: flag('published', true),
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('curriculum_videos_academy_belt_idx').on(t.academyId, t.beltSlug),
    index('curriculum_videos_academy_program_idx').on(t.academyId, t.programId),
  ],
);

/** Coach recap posted against a specific scheduled class session. */
export const classRecaps = sqliteTable(
  'class_recaps',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    coachId: text('coach_id').references(() => users.id, { onDelete: 'set null' }),
    summary: text('summary').notNull(),
    videoUrl: text('video_url'),
    techniques: json<string[]>('techniques').notNull().$defaultFn(() => []),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('class_recaps_class_uq').on(t.classId)],
);

/** Trusted neighbouring academies for cross-training verification. */
export const affiliations = sqliteTable(
  'affiliations',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    contactEmail: text('contact_email'),
    verificationCode: text('verification_code').notNull().unique(),
    verifiedAt: nullableIso('verified_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('affiliations_academy_idx').on(t.academyId)],
);

export const crossTrainingPasses = sqliteTable(
  'cross_training_passes',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    affiliationId: text('affiliation_id').references(() => affiliations.id, {
      onDelete: 'set null',
    }),
    qrToken: text('qr_token').notNull().unique(),
    passDate: text('pass_date').notNull(),
    status: text('status', { enum: PASS_STATUSES }).notNull().default('requested'),
    waiverId: text('waiver_id'),
    checkedInAt: nullableIso('checked_in_at'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [
    index('cross_training_passes_academy_date_idx').on(t.academyId, t.passDate),
    index('cross_training_passes_status_idx').on(t.academyId, t.status),
  ],
);

/**
 * All descendant academy ids for a network root, including the root itself.
 * Implemented as a recursive CTE so deep franchise trees cost one query.
 */
export function networkDescendantIds(db: {
  all: <T>(query: ReturnType<typeof sql>) => T[];
}, rootId: string): string[] {
  const rows = db.all<{ id: string }>(sql`
    WITH RECURSIVE tree(id) AS (
      SELECT id FROM academies WHERE id = ${rootId}
      UNION ALL
      SELECT a.id FROM academies a JOIN tree t ON a.parent_academy_id = t.id
      WHERE a.deleted_at IS NULL
    )
    SELECT id FROM tree
  `);
  return rows.map((row) => row.id);
}

export const saasRelations = relations(academySubscriptions, ({ one }) => ({
  academy: one(academies, {
    fields: [academySubscriptions.academyId],
    references: [academies.id],
  }),
  plan: one(saasPlans, { fields: [academySubscriptions.planId], references: [saasPlans.id] }),
}));

export const curriculumVideoRelations = relations(curriculumVideos, ({ one }) => ({
  program: one(programs, { fields: [curriculumVideos.programId], references: [programs.id] }),
  academy: one(academies, { fields: [curriculumVideos.academyId], references: [academies.id] }),
}));

export const classRecapRelations = relations(classRecaps, ({ one }) => ({
  class: one(classes, { fields: [classRecaps.classId], references: [classes.id] }),
  coach: one(users, { fields: [classRecaps.coachId], references: [users.id] }),
}));

export const crossTrainingPassRelations = relations(crossTrainingPasses, ({ one }) => ({
  visitor: one(users, { fields: [crossTrainingPasses.userId], references: [users.id] }),
  affiliation: one(affiliations, {
    fields: [crossTrainingPasses.affiliationId],
    references: [affiliations.id],
  }),
}));
