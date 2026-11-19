/**
 * Reusable SQL-backed aggregates for the analytics modules.
 * Every function is academy-scoped and returns plain rows for the route layer
 * to shape into the shared Zod contracts.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  academies,
  attendanceLogs,
  beltRanks,
  bookings,
  classes,
  memberships,
  membershipPlans,
  programs,
  promotions,
  transactions,
  users,
  type Db,
} from '@gymlytics/db';
import { monthKey, monthRange } from '@gymlytics/shared';

export interface DateWindow {
  from: Date;
  to: Date;
}

export function resolveWindow(
  from?: string,
  to?: string,
  defaultDays = 90,
): DateWindow {
  const now = new Date();
  const parsedFrom = from ? new Date(from) : new Date(now.getTime() - defaultDays * 86_400_000);
  const parsedTo = to ? new Date(to) : now;
  return {
    from: Number.isNaN(parsedFrom.getTime())
      ? new Date(now.getTime() - defaultDays * 86_400_000)
      : parsedFrom,
    to: Number.isNaN(parsedTo.getTime()) ? now : parsedTo,
  };
}

export function moneyLabel(cents: number, currency: string): string {
  return `${currency} ${Math.round(cents / 100).toLocaleString('en-US')}`;
}

export function currencyFor(db: Db, academyId: string): string {
  return (
    db.select({ currency: academies.currency }).from(academies).where(eq(academies.id, academyId)).get()
      ?.currency ?? 'MYR'
  );
}

export function studentCondition(academyId: string) {
  return and(
    eq(users.academyId, academyId),
    isNull(users.deletedAt),
    inArray(users.role, ['student', 'dropin']),
  );
}

export function memberRows(db: Db, academyId: string) {
  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      dateOfBirth: users.dateOfBirth,
      acquisitionSource: users.acquisitionSource,
    })
    .from(users)
    .where(studentCondition(academyId))
    .orderBy(asc(users.createdAt))
    .all();
}

export interface AttendanceFact {
  id: string;
  userId: string;
  classId: string;
  checkedInAt: string;
  status: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  classTitle: string;
  programId: string;
  programName: string;
  discipline: string;
  ageGroup: string;
  coachId: string | null;
}

/** Attendance joined to its class/program context — the analytics fact table. */
export function attendanceFacts(
  db: Db,
  academyId: string,
  from: Date,
  to: Date = new Date(),
): AttendanceFact[] {
  return db
    .select({
      id: attendanceLogs.id,
      userId: attendanceLogs.userId,
      classId: attendanceLogs.classId,
      checkedInAt: attendanceLogs.checkedInAt,
      status: attendanceLogs.status,
      startsAt: classes.startsAt,
      endsAt: classes.endsAt,
      capacity: classes.capacity,
      classTitle: classes.title,
      programId: programs.id,
      programName: programs.name,
      discipline: programs.discipline,
      ageGroup: programs.ageGroup,
      coachId: classes.coachId,
    })
    .from(attendanceLogs)
    .innerJoin(classes, eq(classes.id, attendanceLogs.classId))
    .innerJoin(programs, eq(programs.id, classes.programId))
    .where(
      and(
        eq(attendanceLogs.academyId, academyId),
        isNull(attendanceLogs.deletedAt),
        inArray(attendanceLogs.status, ['checked_in', 'checked_out']),
        gte(attendanceLogs.checkedInAt, from.toISOString()),
        lte(attendanceLogs.checkedInAt, to.toISOString()),
      ),
    )
    .all();
}

export function lastCheckIns(db: Db, academyId: string): Map<string, string> {
  const rows = db
    .select({ userId: attendanceLogs.userId, lastAt: sql<string>`max(${attendanceLogs.checkedInAt})` })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.academyId, academyId),
        isNull(attendanceLogs.deletedAt),
        inArray(attendanceLogs.status, ['checked_in', 'checked_out']),
      ),
    )
    .groupBy(attendanceLogs.userId)
    .all();
  return new Map(rows.map((row) => [row.userId, row.lastAt]));
}

export function monthlyCount(
  rows: Array<{ at: string }>,
  window: DateWindow,
  keyOf: (row: { at: string }) => string = (row) => row.at,
): Array<{ label: string; value: number }> {
  const keys = monthRange(window.from, window.to);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = monthKey(keyOf(row));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return keys.map((label) => ({ label, value: counts.get(label) ?? 0 }));
}

export function mrrCents(db: Db, academyId: string): number {
  const row = db
    .select({
      total: sql<number>`coalesce(sum(case
        when ${membershipPlans.billingInterval} = 'monthly' then ${membershipPlans.priceCents}
        when ${membershipPlans.billingInterval} = 'quarterly' then ${membershipPlans.priceCents} / 3
        when ${membershipPlans.billingInterval} = 'annual' then ${membershipPlans.priceCents} / 12
        else 0 end), 0)`,
    })
    .from(memberships)
    .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
    .where(
      and(
        eq(memberships.academyId, academyId),
        inArray(memberships.status, ['active', 'trialing', 'past_due']),
      ),
    )
    .get();
  return row?.total ?? 0;
}

export function revenueByMonth(
  db: Db,
  academyId: string,
  window: DateWindow,
): Array<{ label: string; value: number }> {
  const keys = monthRange(window.from, window.to);
  const rows = db
    .select({
      month: sql<string>`substr(${transactions.createdAt}, 1, 7)`,
      total: sql<number>`sum(${transactions.totalCents})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.academyId, academyId),
        eq(transactions.status, 'succeeded'),
        gte(transactions.createdAt, window.from.toISOString()),
        lte(transactions.createdAt, window.to.toISOString()),
      ),
    )
    .groupBy(sql`substr(${transactions.createdAt}, 1, 7)`)
    .all();
  const totals = new Map(rows.map((row) => [row.month, row.total]));
  return keys.map((label) => ({ label, value: Math.round(totals.get(label) ?? 0) }));
}

/** Latest belt rank + stripe per member, across all programs. */
export function currentRanks(db: Db, academyId: string) {
  const promotionsRows = db
    .select({
      userId: promotions.userId,
      rankId: promotions.toBeltRankId,
      stripes: promotions.toStripes,
      promotedAt: promotions.promotedAt,
      rankName: beltRanks.name,
      orderIndex: beltRanks.orderIndex,
    })
    .from(promotions)
    .innerJoin(beltRanks, eq(beltRanks.id, promotions.toBeltRankId))
    .where(eq(promotions.academyId, academyId))
    .orderBy(desc(promotions.promotedAt))
    .all();
  const latest = new Map<string, (typeof promotionsRows)[number]>();
  for (const row of promotionsRows) if (!latest.has(row.userId)) latest.set(row.userId, row);
  return latest;
}

export function isKid(dateOfBirth: string | null, asOf = new Date()): boolean {
  if (!dateOfBirth) return false;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return false;
  let age = asOf.getUTCFullYear() - born.getUTCFullYear();
  const monthDiff = asOf.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getUTCDate() < born.getUTCDate())) age -= 1;
  return age < 18;
}

export function bookingCounts(db: Db, academyId: string, from: Date, to: Date) {
  const rows = db
    .select({
      classId: bookings.classId,
      status: bookings.status,
      count: sql<number>`count(*)`,
    })
    .from(bookings)
    .innerJoin(classes, eq(classes.id, bookings.classId))
    .where(
      and(
        eq(bookings.academyId, academyId),
        gte(classes.startsAt, from.toISOString()),
        lte(classes.startsAt, to.toISOString()),
      ),
    )
    .groupBy(bookings.classId, bookings.status)
    .all();
  const map = new Map<string, { noShows: number; waitlist: number }>();
  for (const row of rows) {
    const entry = map.get(row.classId) ?? { noShows: 0, waitlist: 0 };
    if (row.status === 'no_show') entry.noShows += row.count;
    if (row.status === 'waitlisted') entry.waitlist += row.count;
    map.set(row.classId, entry);
  }
  return map;
}
