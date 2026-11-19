import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { metricSchema } from './analytics';

export const REPORT_SLUGS = [
  'belt-eligibility',
  'daily-roster',
  'instructor-payroll',
  'mia-at-risk',
  'membership-changes',
  'trial-follow-up',
  'failed-payments',
  'revenue-tax',
  'proshop-inventory',
  'waiver-audit',
  'incident-log',
] as const;

export const reportSlugSchema = z.enum(REPORT_SLUGS);
export type ReportSlug = z.infer<typeof reportSlugSchema>;

export const reportGroups = ['Operations', 'Members', 'Finance', 'Compliance'] as const;

export const reportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'money', 'date', 'percent', 'badge', 'link']).default('text'),
});
export type ReportColumn = z.infer<typeof reportColumnSchema>;

export const reportDefinitionSchema = z.object({
  slug: reportSlugSchema,
  title: z.string(),
  group: z.enum(reportGroups),
  description: z.string(),
  cadence: z.string(),
  columns: z.array(reportColumnSchema),
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export const reportRowSchema = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]));
export type ReportRow = z.infer<typeof reportRowSchema>;

export const reportResultSchema = z.object({
  slug: reportSlugSchema,
  title: z.string(),
  generatedAt: z.string(),
  columns: z.array(reportColumnSchema),
  rows: z.array(reportRowSchema),
  summary: z.array(metricSchema),
});
export type ReportResult = z.infer<typeof reportResultSchema>;

export const reportQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  programId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** Intake contracts — the two event types not derivable from existing tables. */
export const leadSources = [
  'walk_in',
  'social_media',
  'ads',
  'member_referral',
  'website',
  'other',
] as const;
export const leadStatuses = [
  'new',
  'contacted',
  'trial_scheduled',
  'trial_attended',
  'converted',
  'lost',
] as const;

export const createLeadSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(160).optional(),
  phone: z.string().trim().max(40).optional(),
  source: z.enum(leadSources).default('walk_in'),
  referredByUserId: uuidSchema.optional(),
  notes: z.string().max(2000).optional(),
  trialAttendedAt: isoDateTimeSchema.optional(),
});
export type CreateLead = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({
  status: z.enum(leadStatuses).optional(),
  source: z.enum(leadSources).optional(),
  lastContactAt: isoDateTimeSchema.optional(),
  trialAttendedAt: isoDateTimeSchema.optional(),
  convertedMembershipId: uuidSchema.optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateLead = z.infer<typeof updateLeadSchema>;

export const incidentTypes = ['injury', 'near_miss', 'equipment', 'other'] as const;
export const incidentSeverities = ['minor', 'moderate', 'severe'] as const;
export const incidentStatuses = ['open', 'follow_up', 'closed'] as const;

export const createIncidentSchema = z.object({
  userId: uuidSchema.optional(),
  programId: uuidSchema.optional(),
  classId: uuidSchema.optional(),
  occurredAt: isoDateTimeSchema,
  location: z.string().trim().max(120).optional(),
  type: z.enum(incidentTypes).default('injury'),
  severity: z.enum(incidentSeverities).default('minor'),
  description: z.string().trim().min(3).max(4000),
  actionTaken: z.string().trim().max(4000).optional(),
  witnessName: z.string().trim().max(160).optional(),
  followUpRequired: z.boolean().default(false),
});
export type CreateIncident = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = z.object({
  status: z.enum(incidentStatuses).optional(),
  actionTaken: z.string().trim().max(4000).optional(),
  followUpRequired: z.boolean().optional(),
  followUpCompletedAt: isoDateTimeSchema.optional(),
});
export type UpdateIncident = z.infer<typeof updateIncidentSchema>;

export const cancelMembershipSchema = z
  .object({
    reason: z
      .enum([
        'too_expensive',
        'relocated',
        'time_constraints',
        'injury',
        'switched_gym',
        'dissatisfied',
        'other',
      ])
      .optional(),
    note: z.string().trim().max(500).optional(),
  })
  .default({});
export type CancelMembership = z.infer<typeof cancelMembershipSchema>;
