import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { createdAt, deletedAt, flag, id, updatedAt } from './_shared';

export const DISCIPLINES = [
  'gi_bjj',
  'nogi_bjj',
  'kids_bjj',
  'muay_thai',
  'wrestling',
  'judo',
  'kyokushin_karate',
  'mma',
  'custom',
] as const;

export const BELT_SYSTEMS = ['ibjjf_adult', 'ibjjf_kids', 'custom'] as const;

/** A martial-art discipline offered by the academy. */
export const programs = sqliteTable(
  'programs',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    discipline: text('discipline', { enum: DISCIPLINES }).notNull(),
    description: text('description'),
    ageGroup: text('age_group', { enum: ['adult', 'kids', 'all'] })
      .notNull()
      .default('all'),
    colorHex: text('color_hex').default('#1D4ED8'),
    iconKey: text('icon_key'),
    defaultCapacity: integer('default_capacity').notNull().default(20),
    isActive: flag('is_active', true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('programs_academy_slug_uq').on(t.academyId, t.slug),
    index('programs_academy_active_idx').on(t.academyId, t.isActive),
  ],
);

/**
 * Customisable belt ladder per program. Eligibility thresholds live here so
 * coaches can tweak "min months" without touching code.
 */
export const beltRanks = sqliteTable(
  'belt_ranks',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    system: text('system', { enum: BELT_SYSTEMS }).notNull().default('custom'),
    orderIndex: integer('order_index').notNull(),
    maxStripes: integer('max_stripes').notNull().default(4),
    minMonthsInRank: integer('min_months_in_rank').notNull().default(0),
    minClassesInRank: integer('min_classes_in_rank').notNull().default(0),
    minMatHours: integer('min_mat_hours').notNull().default(0),
    colorHex: text('color_hex').default('#FFFFFF'),
    stripeColorHex: text('stripe_color_hex').default('#111827'),
    isActive: flag('is_active', true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('belt_ranks_program_slug_uq').on(t.programId, t.slug),
    uniqueIndex('belt_ranks_program_order_uq').on(t.programId, t.orderIndex),
  ],
);

/** Technique library mapped to belt requirements (the curriculum tracker). */
export const curriculumTechniques = sqliteTable(
  'curriculum_techniques',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    category: text('category', {
      enum: ['submission', 'sweep', 'guard', 'pass', 'takedown', 'strike', 'escape', 'other'],
    }).notNull(),
    description: text('description'),
    videoUrl: text('video_url'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('curriculum_program_slug_uq').on(t.programId, t.slug)],
);

export const curriculumRequirements = sqliteTable(
  'curriculum_requirements',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    beltRankId: text('belt_rank_id')
      .notNull()
      .references(() => beltRanks.id, { onDelete: 'cascade' }),
    techniqueId: text('technique_id')
      .notNull()
      .references(() => curriculumTechniques.id, { onDelete: 'cascade' }),
    requiredStripeLevel: integer('required_stripe_level').notNull().default(0),
    isRequired: flag('is_required', true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('curriculum_req_uq').on(t.beltRankId, t.techniqueId, t.requiredStripeLevel),
  ],
);

