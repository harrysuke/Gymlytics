import { z } from 'zod';
import { moneyCentsSchema, percentageSchema, uuidSchema } from './common';

export const posLineItemSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().positive().max(100),
  unitPriceCents: moneyCentsSchema.optional(), // server re-prices if omitted
});
export const posSaleSchema = z.object({
  academyId: uuidSchema,
  customerUserId: uuidSchema.optional(), // omit for walk-in
  lineItems: z.array(posLineItemSchema).min(1),
  paymentMethodId: uuidSchema.optional(), // charge card on file
  provider: z.enum(['stripe', 'billplz', 'ipay88', 'manual']),
  discountCents: moneyCentsSchema.default(0),
  idempotencyKey: uuidSchema,
});
export type PosSaleInput = z.infer<typeof posSaleSchema>;

export const dayPassSchema = z.object({
  academyId: uuidSchema,
  visitorId: uuidSchema,
  programId: uuidSchema.optional(),
  priceCents: moneyCentsSchema,
  currency: z.string().length(3),
  provider: z.enum(['stripe', 'billplz', 'ipay88', 'manual']),
  waiverSigned: z.literal(true), // hard gate: no mat access without waiver
  waiverId: uuidSchema,
  idempotencyKey: uuidSchema,
});
export type DayPassInput = z.infer<typeof dayPassSchema>;

export const familyBillingSchema = z.object({
  academyId: uuidSchema,
  guardianId: uuidSchema,
  dependentIds: z.array(uuidSchema).min(1).max(12),
  planId: uuidSchema,
  applyDiscount: z.boolean().default(true),
});
export type FamilyBillingInput = z.infer<typeof familyBillingSchema>;

export const createPlanSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1_000).optional(),
  planType: z.enum(['unlimited', 'weekly_limit', 'class_pack', 'dropin_pack', 'family']),
  billingInterval: z.enum(['monthly', 'quarterly', 'annual', 'one_time']).default('monthly'),
  priceCents: moneyCentsSchema,
  currency: z.string().length(3).default('MYR'),
  classesPerWeek: z.number().int().positive().max(21).optional(),
  classPackCount: z.number().int().positive().max(500).optional(),
  familyDiscountPercent: percentageSchema.default(0),
  maxDependents: z.number().int().min(0).max(12).default(0),
  freezeAllowed: z.boolean().default(true),
  freezeMaxDaysPerYear: z.number().int().min(0).max(365).default(30),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const createMembershipSchema = z.object({
  userId: uuidSchema,
  planId: uuidSchema,
  startDate: z.string().date().optional(),
  provider: z.enum(['stripe', 'billplz', 'ipay88', 'manual']).default('manual'),
  paymentMethodId: uuidSchema.optional(),
});
export type CreateMembershipInput = z.infer<typeof createMembershipSchema>;

export const freezeMembershipSchema = z.object({
  days: z.number().int().min(1).max(180),
  reason: z.string().max(300).optional(),
});
export type FreezeMembershipInput = z.infer<typeof freezeMembershipSchema>;

export const refundSchema = z.object({
  academyId: uuidSchema,
  transactionId: uuidSchema,
  amountCents: moneyCentsSchema.optional(),
  reason: z.string().min(3).max(300),
  idempotencyKey: uuidSchema,
});

export const taxRateSchema = z.object({
  label: z.string(),
  rateBps: z.number().int().min(0).max(10_000), // basis points
  inclusive: z.boolean().default(false),
});
export type TaxRate = z.infer<typeof taxRateSchema>;

export const priceBreakdownSchema = z.object({
  subtotalCents: moneyCentsSchema,
  discountCents: moneyCentsSchema,
  taxCents: moneyCentsSchema,
  totalCents: moneyCentsSchema,
  currency: z.string().length(3),
  effectiveDiscountPercent: percentageSchema,
});
export type PriceBreakdown = z.infer<typeof priceBreakdownSchema>;
