import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { attendanceLogs, memberships, membershipPlans, waivers, type Db } from '@gymlytics/db';
import { canBookClass, type BookingDecision, type MembershipState, type PlanType } from '@gymlytics/shared';
import { unprocessable } from './errors';

export interface ActiveMembership {
  id: string;
  status: MembershipState;
  currentPeriodEnd: string;
  classesUsedInPeriod: number;
  planId: string;
  planName: string;
  planType: PlanType;
  classesPerWeek: number | null;
  classPackCount: number | null;
  familyDiscountPercent: number;
  maxDependents: number;
}

export function getActiveMembership(db: Db, userId: string): ActiveMembership | null {
  const row = db
    .select({
      id: memberships.id,
      status: memberships.status,
      currentPeriodEnd: memberships.currentPeriodEnd,
      classesUsedInPeriod: memberships.classesUsedInPeriod,
      planId: membershipPlans.id,
      planName: membershipPlans.name,
      planType: membershipPlans.planType,
      classesPerWeek: membershipPlans.classesPerWeek,
      classPackCount: membershipPlans.classPackCount,
      familyDiscountPercent: membershipPlans.familyDiscountPercent,
      maxDependents: membershipPlans.maxDependents,
    })
    .from(memberships)
    .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.createdAt))
    .limit(1)
    .get();

  if (!row) return null;
  return row as ActiveMembership;
}

/** Monday 00:00 UTC — the quota window for weekly-limited plans. */
export function startOfWeek(now = new Date()): Date {
  const date = new Date(now);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function weeklyUsage(db: Db, userId: string, now = new Date()): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.userId, userId),
        gte(attendanceLogs.checkedInAt, startOfWeek(now).toISOString()),
        isNull(attendanceLogs.deletedAt),
      ),
    )
    .get();
  return row?.count ?? 0;
}

export function bookingDecision(db: Db, userId: string, now = new Date()): BookingDecision {
  const membership = getActiveMembership(db, userId);
  if (!membership) return { allowed: false, reason: 'no_entitlement', remaining: 0 };
  return canBookClass(
    {
      planType: membership.planType,
      classesPerWeek: membership.classesPerWeek,
      classPackCount: membership.classPackCount,
      maxDependents: membership.maxDependents,
    },
    {
      status: membership.status,
      currentPeriodEnd: membership.currentPeriodEnd,
      classesUsedInPeriod: membership.classesUsedInPeriod,
      familyUsageThisWeek: weeklyUsage(db, userId, now),
    },
    now,
  );
}

export function assertCanBook(db: Db, userId: string, now = new Date()): ActiveMembership {
  const decision = bookingDecision(db, userId, now);
  if (!decision.allowed) {
    throw unprocessable(`Member cannot book: ${decision.reason ?? 'not entitled'}`);
  }
  const membership = getActiveMembership(db, userId);
  if (!membership) throw unprocessable('Member has no membership');
  return membership;
}

export interface WaiverState {
  valid: boolean;
  expiresAt: string | null;
  signedAt: string | null;
  waiverId: string | null;
}

export function waiverState(db: Db, userId: string, now = new Date()): WaiverState {
  const waiver = db
    .select({
      id: waivers.id,
      signedAt: waivers.signedAt,
      expiresAt: waivers.expiresAt,
      status: waivers.status,
    })
    .from(waivers)
    .where(and(eq(waivers.userId, userId), eq(waivers.waiverType, 'general')))
    .orderBy(desc(waivers.signedAt))
    .limit(1)
    .get();

  if (!waiver || waiver.status !== 'signed') {
    return { valid: false, expiresAt: null, signedAt: null, waiverId: null };
  }
  const valid = !waiver.expiresAt || new Date(waiver.expiresAt) > now;
  return {
    valid,
    expiresAt: waiver.expiresAt,
    signedAt: waiver.signedAt,
    waiverId: waiver.id,
  };
}
