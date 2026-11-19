import { z } from 'zod';
import { uuidSchema } from './common';

export const dashboardAlertSchema = z.object({
  id: z.string(),
  kind: z.enum(['past_due', 'waiver_expiring', 'belt_eligible', 'low_stock', 'unpaid_day_pass']),
  title: z.string(),
  detail: z.string(),
  userId: uuidSchema.optional(),
  href: z.string().optional(),
});
export type DashboardAlert = z.infer<typeof dashboardAlertSchema>;

export const dashboardClassSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  programName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  coachName: z.string().nullable(),
  capacity: z.number().int(),
  bookedCount: z.number().int(),
  checkedInCount: z.number().int(),
});
export type DashboardClass = z.infer<typeof dashboardClassSchema>;

export const dashboardSummarySchema = z.object({
  activeMembers: z.number().int(),
  classesToday: z.number().int(),
  checkedInToday: z.number().int(),
  pastDueBills: z.number().int(),
  mrrCents: z.number().int(),
  newMembersThisMonth: z.number().int(),
  todayClasses: z.array(dashboardClassSchema),
  alerts: z.array(dashboardAlertSchema),
  revenueLast30DaysCents: z.number().int(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
