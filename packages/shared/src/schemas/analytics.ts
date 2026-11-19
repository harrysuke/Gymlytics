import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';
import { eligibilityRowSchema } from './promotions';

/** Shared building blocks used by every analytics payload. */
export const analyticsRangeQuerySchema = z.object({
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  programId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type AnalyticsRangeQuery = z.infer<typeof analyticsRangeQuerySchema>;

export const seriesPointSchema = z.object({ label: z.string(), value: z.number() });
export type SeriesPoint = z.infer<typeof seriesPointSchema>;

export const namedValueSchema = z.object({
  label: z.string(),
  value: z.number(),
  secondary: z.number().optional(),
});
export type NamedValue = z.infer<typeof namedValueSchema>;

export const metricSchema = z.object({
  label: z.string(),
  value: z.string(),
  hint: z.string().optional(),
  tone: z.enum(['default', 'good', 'warn']).optional(),
});
export type Metric = z.infer<typeof metricSchema>;

/** Overview — headline numbers and trend series for the analytics landing page. */
export const analyticsOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  metrics: z.array(metricSchema),
  revenueSeries: z.array(seriesPointSchema),
  attendanceSeries: z.array(seriesPointSchema),
  signupSeries: z.array(seriesPointSchema),
  revenueMix: z.array(namedValueSchema),
  programPopularity: z.array(namedValueSchema),
});
export type AnalyticsOverview = z.infer<typeof analyticsOverviewSchema>;

/** BJJ progression & coaching. */
export const progressionAnalyticsSchema = z.object({
  metrics: z.array(metricSchema),
  beltDistribution: z.array(namedValueSchema),
  stripeDistribution: z.array(namedValueSchema),
  ageGroups: z.array(namedValueSchema),
  programBreakdown: z.array(
    z.object({
      programId: z.string(),
      programName: z.string(),
      students: z.number(),
      avgMatHours: z.number(),
      eligible: z.number(),
    }),
  ),
  promotionTimeline: z.array(seriesPointSchema),
  readiness: z.array(eligibilityRowSchema),
});
export type ProgressionAnalytics = z.infer<typeof progressionAnalyticsSchema>;

/** Attendance, class popularity and coach impact. */
export const attendanceAnalyticsSchema = z.object({
  metrics: z.array(metricSchema),
  attendanceSeries: z.array(seriesPointSchema),
  byWeekday: z.array(seriesPointSchema),
  byHour: z.array(seriesPointSchema),
  classPopularity: z.array(
    z.object({
      classTitle: z.string(),
      programName: z.string(),
      sessions: z.number(),
      avgAttendance: z.number(),
      avgUtilization: z.number(),
      noShows: z.number(),
      waitlist: z.number(),
    }),
  ),
  coachImpact: z.array(
    z.object({
      coachId: z.string(),
      coachName: z.string(),
      classes: z.number(),
      sessionsAttended: z.number(),
      avgUtilization: z.number(),
      uniqueStudents: z.number(),
      returningStudents: z.number(),
      giClasses: z.number(),
      nogiClasses: z.number(),
    }),
  ),
  styleMix: z.array(namedValueSchema),
  levelMix: z.array(namedValueSchema),
});
export type AttendanceAnalytics = z.infer<typeof attendanceAnalyticsSchema>;

/** Retention, churn and tenure. */
export const atRiskMemberSchema = z.object({
  userId: z.string(),
  memberName: z.string(),
  daysSinceCheckIn: z.number(),
  lastCheckInAt: z.string().nullable(),
  tenureDays: z.number(),
  risk: z.enum(['watch', 'at_risk', 'critical']),
  membershipStatus: z.string().nullable(),
});
export type AtRiskMember = z.infer<typeof atRiskMemberSchema>;

export const retentionAnalyticsSchema = z.object({
  metrics: z.array(metricSchema),
  monthlyChurn: z.array(
    z.object({
      month: z.string(),
      churnRate: z.number(),
      newMembers: z.number(),
      churned: z.number(),
    }),
  ),
  tenureBuckets: z.array(
    z.object({ label: z.string(), active: z.number(), churned: z.number(), churnRate: z.number() }),
  ),
  cohorts: z.array(
    z.object({
      cohort: z.string(),
      size: z.number(),
      month1: z.number(),
      month2: z.number(),
      month3: z.number(),
    }),
  ),
  dropOffPoints: z.array(namedValueSchema),
  atRisk: z.array(atRiskMemberSchema),
});
export type RetentionAnalytics = z.infer<typeof retentionAnalyticsSchema>;

/** Financial & revenue. */
export const financialAnalyticsSchema = z.object({
  metrics: z.array(metricSchema),
  revenueSeries: z.array(seriesPointSchema),
  revenueMix: z.array(namedValueSchema),
  planMix: z.array(namedValueSchema),
  cashFlowProjection: z.array(seriesPointSchema),
  failedPayments: z.array(
    z.object({
      userId: z.string(),
      memberName: z.string(),
      amountCents: z.number(),
      failureCode: z.string().nullable(),
      occurredAt: z.string(),
      retries: z.number(),
    }),
  ),
  expiringCards: z.array(
    z.object({
      userId: z.string(),
      memberName: z.string(),
      brand: z.string().nullable(),
      last4: z.string().nullable(),
      expiry: z.string(),
    }),
  ),
});
export type FinancialAnalytics = z.infer<typeof financialAnalyticsSchema>;

/** Leads, trials and acquisition. */
export const leadAnalyticsSchema = z.object({
  metrics: z.array(metricSchema),
  leadSeries: z.array(seriesPointSchema),
  funnel: z.array(namedValueSchema),
  sourceAttribution: z.array(
    z.object({
      source: z.string(),
      leads: z.number(),
      trials: z.number(),
      converted: z.number(),
      conversionRate: z.number(),
      retained90Days: z.number(),
    }),
  ),
  followUps: z.array(
    z.object({
      leadId: z.string(),
      leadName: z.string(),
      source: z.string(),
      status: z.string(),
      lastContactAt: z.string().nullable(),
      daysSinceContact: z.number(),
    }),
  ),
});
export type LeadAnalytics = z.infer<typeof leadAnalyticsSchema>;

/** Per-member analytics — powers the member drilldown and the student-facing /me view. */
export const memberAnalyticsSchema = z.object({
  userId: z.string(),
  memberName: z.string(),
  role: z.string(),
  joinedAt: z.string(),
  tenureDays: z.number(),
  metrics: z.array(metricSchema),
  progression: z.array(
    z.object({
      programName: z.string(),
      currentRankName: z.string(),
      stripes: z.number(),
      matHours: z.number(),
      classes: z.number(),
      monthsInRank: z.number(),
      eligible: z.boolean(),
      nextRankName: z.string().nullable(),
      missing: z.array(z.string()),
    }),
  ),
  attendanceByProgram: z.array(namedValueSchema),
  attendanceSeries: z.array(seriesPointSchema),
  retention: z.object({
    risk: z.enum(['healthy', 'watch', 'at_risk', 'critical']),
    daysSinceCheckIn: z.number().nullable(),
    streakWeeks: z.number(),
    membershipStatus: z.string().nullable(),
    planName: z.string().nullable(),
  }),
  financial: z.object({
    lifetimeCents: z.number(),
    last90DaysCents: z.number(),
    monthsActive: z.number(),
    arpuCents: z.number(),
  }),
  compliance: z.object({
    waiverStatus: z.string(),
    waiverExpiresAt: z.string().nullable(),
    incidents: z.number(),
  }),
});
export type MemberAnalytics = z.infer<typeof memberAnalyticsSchema>;
