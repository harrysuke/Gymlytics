import { z } from 'zod';
import { uuidSchema } from './common';

export const DISCIPLINE_VALUES = [
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

export const createProgramSchema = z.object({
  name: z.string().min(2).max(120),
  discipline: z.enum(DISCIPLINE_VALUES),
  description: z.string().max(2_000).optional(),
  ageGroup: z.enum(['adult', 'kids', 'all']).default('all'),
  defaultCapacity: z.number().int().min(1).max(300).default(20),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type CreateProgramInput = z.infer<typeof createProgramSchema>;

export const createBeltRankSchema = z.object({
  name: z.string().min(1).max(60),
  slug: z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/).optional(),
  system: z.enum(['ibjjf_adult', 'ibjjf_kids', 'custom']).default('custom'),
  orderIndex: z.number().int().min(0).max(50),
  maxStripes: z.number().int().min(0).max(10).default(4),
  minMonthsInRank: z.number().int().min(0).max(240).default(0),
  minClassesInRank: z.number().int().min(0).max(5_000).default(0),
  minMatHours: z.number().int().min(0).max(20_000).default(0),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  stripeColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});
export type CreateBeltRankInput = z.infer<typeof createBeltRankSchema>;

export const createTechniqueSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.enum(['submission', 'sweep', 'guard', 'pass', 'takedown', 'strike', 'escape', 'other']),
  description: z.string().max(2_000).optional(),
  videoUrl: z.string().url().optional(),
});
export type CreateTechniqueInput = z.infer<typeof createTechniqueSchema>;

export const techniqueRequirementSchema = z.object({
  beltRankId: uuidSchema,
  techniqueId: uuidSchema,
  requiredStripeLevel: z.number().int().min(0).max(10).default(0),
  isRequired: z.boolean().default(true),
});
export type TechniqueRequirementInput = z.infer<typeof techniqueRequirementSchema>;
