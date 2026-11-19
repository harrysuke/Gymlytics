import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  attendanceLogs,
  classes,
  memberships,
  membershipPlans,
  programs,
  retailProducts,
  transactions,
  users,
  waivers,
  type Db,
} from '@gymlytics/db';
import type { DashboardAlert, DashboardSummary } from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';

export async function registerDashboardRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.get('/v1/dashboard/summary', { preHandler: requireRole('owner', 'admin', 'coach', 'staff') }, async (request) => {
    const context = auth(request);
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

    const activeMembers =
      db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(
          and(
            eq(users.academyId, context.academyId),
            isNull(users.deletedAt),
            eq(users.status, 'active'),
            inArray(users.role, ['student', 'dropin', 'guardian']),
          ),
        )
        .get()?.count ?? 0;

    const classesToday =
      db
        .select({ count: sql<number>`count(*)` })
        .from(classes)
        .where(
          and(
            eq(classes.academyId, context.academyId),
            isNull(classes.deletedAt),
            gte(classes.startsAt, dayStart.toISOString()),
            lte(classes.startsAt, dayEnd.toISOString()),
          ),
        )
        .get()?.count ?? 0;

    const checkedInToday =
      db
        .select({ count: sql<number>`count(*)` })
        .from(attendanceLogs)
        .where(
          and(
            eq(attendanceLogs.academyId, context.academyId),
            isNull(attendanceLogs.deletedAt),
            gte(attendanceLogs.checkedInAt, dayStart.toISOString()),
            lte(attendanceLogs.checkedInAt, dayEnd.toISOString()),
          ),
        )
        .get()?.count ?? 0;

    const pastDue =
      db
        .select({ count: sql<number>`count(*)` })
        .from(memberships)
        .where(and(eq(memberships.academyId, context.academyId), eq(memberships.status, 'past_due')))
        .get()?.count ?? 0;

    const newMembers =
      db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(
          and(
            eq(users.academyId, context.academyId),
            isNull(users.deletedAt),
            gte(users.createdAt, monthStart.toISOString()),
          ),
        )
        .get()?.count ?? 0;

    const mrr = db
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
          eq(memberships.academyId, context.academyId),
          inArray(memberships.status, ['active', 'trialing', 'past_due']),
        ),
      )
      .get();

    const revenue = db
      .select({ total: sql<number>`coalesce(sum(${transactions.totalCents}), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.academyId, context.academyId),
          eq(transactions.status, 'succeeded'),
          gte(transactions.createdAt, thirtyDaysAgo.toISOString()),
        ),
      )
      .get();

    const todayClasses = db
      .select({
        id: classes.id,
        title: classes.title,
        programName: programs.name,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        coachFirstName: users.firstName,
        coachLastName: users.lastName,
        capacity: classes.capacity,
        bookedCount: classes.bookedCount,
        checkedInCount: classes.checkedInCount,
      })
      .from(classes)
      .innerJoin(programs, eq(programs.id, classes.programId))
      .leftJoin(users, eq(users.id, classes.coachId))
      .where(
        and(
          eq(classes.academyId, context.academyId),
          isNull(classes.deletedAt),
          gte(classes.startsAt, dayStart.toISOString()),
          lte(classes.startsAt, dayEnd.toISOString()),
        ),
      )
      .orderBy(asc(classes.startsAt))
      .all();

    const alerts: DashboardAlert[] = [];

    const pastDueRows = db
      .select({
        membershipId: memberships.id,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        periodEnd: memberships.currentPeriodEnd,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.academyId, context.academyId), eq(memberships.status, 'past_due')))
      .limit(5)
      .all();
    for (const row of pastDueRows) {
      alerts.push({
        id: `past_due:${row.membershipId}`,
        kind: 'past_due',
        title: `${row.firstName} ${row.lastName} is past due`,
        detail: `Membership period ended ${row.periodEnd.slice(0, 10)}`,
        userId: row.userId,
        href: `/admin/members/${row.userId}`,
      });
    }

    const expiring = db
      .select({
        id: waivers.id,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        expiresAt: waivers.expiresAt,
      })
      .from(waivers)
      .innerJoin(users, eq(users.id, waivers.userId))
      .where(
        and(
          eq(waivers.academyId, context.academyId),
          eq(waivers.status, 'signed'),
          gte(waivers.expiresAt, now.toISOString()),
          lte(waivers.expiresAt, new Date(now.getTime() + 30 * 86_400_000).toISOString()),
        ),
      )
      .limit(5)
      .all();
    for (const row of expiring) {
      alerts.push({
        id: `waiver:${row.id}`,
        kind: 'waiver_expiring',
        title: `${row.firstName} ${row.lastName}'s waiver expires soon`,
        detail: `Expires ${row.expiresAt?.slice(0, 10) ?? 'soon'}`,
        userId: row.userId,
        href: `/admin/members/${row.userId}`,
      });
    }

    const lowStock = db
      .select()
      .from(retailProducts)
      .where(
        and(
          eq(retailProducts.academyId, context.academyId),
          eq(retailProducts.trackInventory, true),
          isNull(retailProducts.deletedAt),
          sql`${retailProducts.stockQuantity} <= ${retailProducts.lowStockThreshold}`,
        ),
      )
      .limit(5)
      .all();
    for (const product of lowStock) {
      alerts.push({
        id: `stock:${product.id}`,
        kind: 'low_stock',
        title: `${product.name} is low on stock`,
        detail: `${product.stockQuantity} left · reorder threshold ${product.lowStockThreshold}`,
        href: '/admin/pos',
      });
    }

    const summary: DashboardSummary = {
      activeMembers,
      classesToday,
      checkedInToday,
      pastDueBills: pastDue,
      mrrCents: mrr?.total ?? 0,
      newMembersThisMonth: newMembers,
      todayClasses: todayClasses.map((row) => ({
        id: row.id,
        title: row.title,
        programName: row.programName,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        coachName:
          row.coachFirstName && row.coachLastName ? `${row.coachFirstName} ${row.coachLastName}` : null,
        capacity: row.capacity,
        bookedCount: row.bookedCount,
        checkedInCount: row.checkedInCount,
      })),
      alerts,
      revenueLast30DaysCents: revenue?.total ?? 0,
    };

    return { ok: true, data: summary };
  });
}
