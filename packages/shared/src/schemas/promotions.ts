import { z } from 'zod';
import { uuidSchema } from './common';

export const promotionInputSchema = z.object({
  userId: uuidSchema,
  programId: uuidSchema,
  toBeltRankId: uuidSchema,
  toStripes: z.number().int().min(0).max(4).default(0),
  promotedAt: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(1_000).optional(),
});
export type PromotionInput = z.infer<typeof promotionInputSchema>;

export const eligibilityQuerySchema = z.object({
  programId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
});
export type EligibilityQuery = z.infer<typeof eligibilityQuerySchema>;

export const eligibilityRowSchema = z.object({
  userId: uuidSchema,
  memberName: z.string(),
  programId: uuidSchema,
  programName: z.string(),
  currentRankId: uuidSchema.nullable(),
  currentRankName: z.string().nullable(),
  currentStripes: z.number().int(),
  nextRankId: uuidSchema.nullable(),
  nextRankName: z.string().nullable(),
  monthsInRank: z.number(),
  classesSincePromotion: z.number().int(),
  matHoursSincePromotion: z.number().int(),
  techniquesRequired: z.number().int(),
  techniquesCompleted: z.number().int(),
  eligible: z.boolean(),
  stripeEligible: z.boolean(),
  beltEligible: z.boolean(),
  suggestedAction: z.enum(['stripe', 'belt']).nullable(),
  missing: z.array(z.string()),
});
export type EligibilityRow = z.infer<typeof eligibilityRowSchema>;
