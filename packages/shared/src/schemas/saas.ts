import { z } from 'zod';
import { SUPPORTED_CURRENCIES } from '../constants';
import { uuidSchema } from './common';

export const saasPlanSchema = z.object({
  id: uuidSchema,
  slug: z.enum(['starter', 'growth', 'network']),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  features: z.array(z.string()),
  sortOrder: z.number().int(),
});
export type SaasPlanDto = z.infer<typeof saasPlanSchema>;

export const subscriptionSchema = z.object({
  plan: saasPlanSchema,
  status: z.enum(['trialing', 'active', 'past_due', 'cancelled']),
  currentPeriodEnd: z.string().nullable(),
  features: z.array(z.string()),
});
export type SubscriptionDto = z.infer<typeof subscriptionSchema>;

export const changePlanSchema = z.object({
  planSlug: z.enum(['starter', 'growth', 'network']),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

export const onboardingSchema = z.object({
  currentStep: z.string(),
  completedSteps: z.array(z.string()),
  completedAt: z.string().nullable(),
  progressPercent: z.number().int().min(0).max(100),
});
export type OnboardingDto = z.infer<typeof onboardingSchema>;

export const completeStepSchema = z.object({
  step: z.enum(['profile', 'locations', 'programs', 'members', 'billing', 'team']),
});
export type CompleteStepInput = z.infer<typeof completeStepSchema>;

export const CSV_IMPORT_TYPES = ['members', 'belt_ranks', 'billing_mandates'] as const;

export const csvImportSchema = z.object({
  type: z.enum(CSV_IMPORT_TYPES),
  fileName: z.string().max(180).optional(),
  // 2 MB of CSV is plenty for a small academy and keeps the request bounded.
  csv: z.string().min(1).max(2_000_000),
});
export type CsvImportInput = z.infer<typeof csvImportSchema>;

export const importJobSchema = z.object({
  id: uuidSchema,
  type: z.enum(CSV_IMPORT_TYPES),
  status: z.enum(['pending', 'completed', 'failed']),
  fileName: z.string().nullable(),
  totalRows: z.number().int(),
  importedRows: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), message: z.string() })),
  createdAt: z.string(),
});
export type ImportJobDto = z.infer<typeof importJobSchema>;

export const importResultSchema = importJobSchema.extend({
  skippedRows: z.number().int(),
});
export type ImportResultDto = z.infer<typeof importResultSchema>;

export const WIDGET_KINDS = ['schedule', 'trial_form', 'waiver_link'] as const;

export const widgetConfigSchema = z.object({
  programId: uuidSchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
  title: z.string().max(120).optional(),
  accentColor: z.string().max(30).optional(),
  redirectUrl: z.string().max(300).optional(),
  beltSlug: z.string().max(60).optional(),
});
export type WidgetConfigInput = z.infer<typeof widgetConfigSchema>;

export const createWidgetSchema = z.object({
  kind: z.enum(WIDGET_KINDS),
  label: z.string().min(2).max(120),
  config: widgetConfigSchema.default({}),
});
export type CreateWidgetInput = z.infer<typeof createWidgetSchema>;

export const updateWidgetSchema = createWidgetSchema.partial().extend({
  enabled: z.boolean().optional(),
});
export type UpdateWidgetInput = z.infer<typeof updateWidgetSchema>;

export const widgetDtoSchema = z.object({
  id: uuidSchema,
  kind: z.enum(WIDGET_KINDS),
  label: z.string(),
  token: z.string(),
  config: widgetConfigSchema,
  enabled: z.boolean(),
  embedCode: z.string(),
});
export type WidgetDto = z.infer<typeof widgetDtoSchema>;

export const publicTrialSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional(),
  phone: z.string().min(6).max(30).optional(),
  notes: z.string().max(500).optional(),
});
export type PublicTrialInput = z.infer<typeof publicTrialSchema>;

export const curriculumVideoSchema = z.object({
  programId: uuidSchema.optional(),
  beltSlug: z.string().max(60).optional(),
  title: z.string().min(2).max(160),
  description: z.string().max(2_000).optional(),
  url: z.string().url().max(500),
  thumbnailUrl: z.string().url().max(500).optional(),
  durationSeconds: z.number().int().nonnegative().default(0),
  sortOrder: z.number().int().nonnegative().default(0),
  published: z.boolean().default(true),
});
export type CurriculumVideoInput = z.infer<typeof curriculumVideoSchema>;

export const classRecapSchema = z.object({
  summary: z.string().min(2).max(4_000),
  videoUrl: z.string().url().max(500).optional(),
  techniques: z.array(z.string().max(160)).max(40).default([]),
});
export type ClassRecapInput = z.infer<typeof classRecapSchema>;

export const affiliationSchema = z.object({
  name: z.string().min(2).max(120),
  contactEmail: z.string().email().optional(),
  notes: z.string().max(1_000).optional(),
});
export type AffiliationInput = z.infer<typeof affiliationSchema>;

export const crossTrainingPassSchema = z.object({
  visitorId: uuidSchema,
  affiliationId: uuidSchema.optional(),
  passDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(500).optional(),
});
export type CrossTrainingPassInput = z.infer<typeof crossTrainingPassSchema>;

export const linkWaiverSchema = z.object({ waiverId: uuidSchema });
export type LinkWaiverInput = z.infer<typeof linkWaiverSchema>;

export const passCheckInSchema = z.object({
  classId: uuidSchema,
  mutationId: uuidSchema,
  hlc: z.string(),
  deviceId: z.string().min(3).max(80),
  checkedInAt: z.string().datetime({ offset: true }),
});
export type PassCheckInInput = z.infer<typeof passCheckInSchema>;

export const networkLocationSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  city: z.string().max(80).optional(),
  state: z.string().max(80).optional(),
  timezone: z.string().max(80).default('Asia/Kuala_Lumpur'),
  currency: z.enum(SUPPORTED_CURRENCIES).default('MYR'),
});
export type NetworkLocationInput = z.infer<typeof networkLocationSchema>;
