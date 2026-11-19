import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { academies } from './tenancy';
import { users } from './users';
import { programs, beltRanks } from './programs';
import { createdAt, id, nullableIso } from './_shared';

/**
 * Immutable promotion history. `classesSincePromotion` / `matHoursSincePromotion`
 * are snapshots at promotion time; live eligibility is computed from
 * attendanceLogs + this table's latest row (see shared/domain/promotion.ts).
 */
export const promotions = sqliteTable(
  'promotions',
  {
    id: id(),
    academyId: text('academy_id')
      .notNull()
      .references(() => academies.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    programId: text('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'restrict' }),
    fromBeltRankId: text('from_belt_rank_id').references(() => beltRanks.id, {
      onDelete: 'set null',
    }),
    toBeltRankId: text('to_belt_rank_id')
      .notNull()
      .references(() => beltRanks.id, { onDelete: 'restrict' }),
    fromStripes: integer('from_stripes').notNull().default(0),
    toStripes: integer('to_stripes').notNull().default(0),
    promotedAt: text('promoted_at').notNull(),
    effectiveAt: nullableIso('effective_at'),
    promotedBy: text('promoted_by').references(() => users.id, { onDelete: 'set null' }),
    classesSincePromotion: integer('classes_since_promotion').notNull().default(0),
    matHoursSincePromotion: integer('mat_hours_since_promotion').notNull().default(0),
    notes: text('notes'),
    certificateUrl: text('certificate_url'),
    createdAt: createdAt(),
  },
  (t) => [
    index('promotions_user_program_idx').on(t.userId, t.programId, t.promotedAt),
    uniqueIndex('promotions_idempotency_uq').on(
      t.userId,
      t.programId,
      t.toBeltRankId,
      t.toStripes,
      t.promotedAt,
    ),
  ],
);
