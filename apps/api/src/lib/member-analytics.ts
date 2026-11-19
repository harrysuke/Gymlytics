import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  attendanceLogs,
  incidents,
  memberships,
  membershipPlans,
  transactions,
  users,
  waivers,
  type Db,
} from '@gymlytics/db';
import {
  checkInRisk,
  computeWeeklyStreak,
  daysBetween,
  groupCount,
  type MemberAnalytics,
  percent,
} from '@gymlytics/shared';
import { attendanceFacts, currencyFor, lastCheckIns, monthlyCount, resolveWindow } from './analytics';
import { computeEligibility } from './progression';

/** One member's complete analytics picture, used by staff drilldown and /me. */
export function buildMemberAnalytics(
  db: Db,
  academyId: string,
  userId: string,
): MemberAnalytics | null {
  const member = db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.academyId, academyId), isNull(users.deletedAt)))
    .get();
  if (!member) return null;

  const now = new Date();
  const window = resolveWindow(undefined, undefined, 90);
  const facts = attendanceFacts(db, academyId, window.from, window.to).filter(
    (fact) => fact.userId === userId,
  );
  const lifetimeFacts = attendanceFacts(db, academyId, new Date(member.createdAt), now).filter(
    (fact) => fact.userId === userId,
  );
  const eligibility = computeEligibility(db, academyId, userId);

  const lastCheckIn = lastCheckIns(db, academyId).get(userId) ?? null;
  const daysSince = lastCheckIn ? daysBetween(lastCheckIn, now) : null;
  const streak = computeWeeklyStreak(
    lifetimeFacts.map((fact) => ({ checkedInAt: fact.checkedInAt })),
    now,
  );

  const membership = db
    .select({
      status: memberships.status,
      createdAt: memberships.createdAt,
      planName: membershipPlans.name,
    })
    .from(memberships)
    .leftJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .where(and(eq(memberships.userId, userId), eq(memberships.academyId, academyId)))
    .orderBy(desc(memberships.createdAt))
    .get();

  const revenue = db
    .select({
      lifetime: sql<number>`coalesce(sum(case when ${transactions.status} = 'succeeded' then ${transactions.totalCents} else 0 end), 0)`,
      recent: sql<number>`coalesce(sum(case when ${transactions.status} = 'succeeded' and ${transactions.createdAt} >= ${window.from.toISOString()} then ${transactions.totalCents} else 0 end), 0)`,
    })
    .from(transactions)
    .where(and(eq(transactions.academyId, academyId), eq(transactions.userId, userId)))
    .get();

  const waiver = db
    .select({ status: waivers.status, expiresAt: waivers.expiresAt })
    .from(waivers)
    .where(and(eq(waivers.academyId, academyId), eq(waivers.userId, userId)))
    .orderBy(desc(waivers.signedAt))
    .get();
  const incidentCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(incidents)
      .where(and(eq(incidents.academyId, academyId), eq(incidents.userId, userId)))
      .get()?.count ?? 0;

  const tenureDays = daysBetween(member.createdAt, now);
  const monthsActive = Math.max(1, Math.round(tenureDays / 30));
  const lifetimeCents = revenue?.lifetime ?? 0;
  const matMinutes = facts.reduce((total, fact) => {
    const duration = (new Date(fact.endsAt).getTime() - new Date(fact.startsAt).getTime()) / 60_000;
    return total + (Number.isFinite(duration) && duration > 0 ? duration : 90);
  }, 0);

  const waiverStatus = !waiver
    ? 'Missing'
    : waiver.status === 'expired' || (waiver.expiresAt && new Date(waiver.expiresAt) < now)
      ? 'Expired'
      : waiver.status === 'signed'
        ? 'Signed'
        : waiver.status;

  return {
    userId: member.id,
    memberName: `${member.firstName} ${member.lastName}`.trim(),
    role: member.role,
    joinedAt: member.createdAt,
    tenureDays,
    metrics: [
      { label: 'Mat hours (90d)', value: String(Math.round(matMinutes / 60)), hint: 'From check-in sessions' },
      { label: 'Classes (90d)', value: String(facts.length) },
      { label: 'Weekly streak', value: `${streak} wk`, tone: streak >= 4 ? 'good' : 'default' },
      { label: 'Lifetime value', value: `${currencyFor(db, academyId)} ${(lifetimeCents / 100).toFixed(0)}`, hint: 'All succeeded payments' },
    ],
    progression: eligibility.map((row) => ({
      programName: row.programName,
      currentRankName: row.currentRankName ?? 'White',
      stripes: row.currentStripes,
      matHours: row.matHoursSincePromotion,
      classes: row.classesSincePromotion,
      monthsInRank: row.monthsInRank,
      eligible: row.eligible,
      nextRankName: row.nextRankName,
      missing: row.missing,
    })),
    attendanceByProgram: groupCount(facts, (fact) => fact.programName),
    attendanceSeries: monthlyCount(facts.map((fact) => ({ at: fact.checkedInAt })), window),
    retention: {
      risk: checkInRisk(daysSince),
      daysSinceCheckIn: daysSince,
      streakWeeks: streak,
      membershipStatus: membership?.status ?? null,
      planName: membership?.planName ?? null,
    },
    financial: {
      lifetimeCents,
      last90DaysCents: revenue?.recent ?? 0,
      monthsActive,
      arpuCents: Math.round(lifetimeCents / monthsActive),
    },
    compliance: {
      waiverStatus,
      waiverExpiresAt: waiver?.expiresAt ?? null,
      incidents: incidentCount,
    },
  };
}

/** Share of a member's cohort still training — used in retention analytics. */
export function retainedShare(
  db: Db,
  academyId: string,
  userIds: string[],
  since: Date,
): number {
  if (!userIds.length) return 0;
  const rows = db
    .select({ userId: attendanceLogs.userId })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.academyId, academyId),
        isNull(attendanceLogs.deletedAt),
        inArray(attendanceLogs.userId, userIds),
        sql`${attendanceLogs.checkedInAt} >= ${since.toISOString()}`,
      ),
    )
    .groupBy(attendanceLogs.userId)
    .all();
  return percent(rows.length, userIds.length);
}
