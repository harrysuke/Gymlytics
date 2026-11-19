import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  leads,
  memberships,
  membershipPlans,
  paymentMethods,
  paymentRetries,
  programs,
  promotions,
  retailProducts,
  transactions,
  transactionItems,
  users,
  type Db,
} from '@gymlytics/db';
import {
  DISCIPLINE_LABELS,
  alertRisk,
  analyticsRangeQuerySchema,
  average,
  buildCohorts,
  daysBetween,
  groupCount,
  median,
  monthRange,
  percent,
  projectCashFlow,
  tenureBucket,
  type AttendanceAnalytics,
  type FinancialAnalytics,
  type LeadAnalytics,
  type MemberAnalytics,
  type ProgressionAnalytics,
  type RetentionAnalytics,
  type AnalyticsOverview,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import {
  attendanceFacts,
  bookingCounts,
  currencyFor,
  currentRanks,
  isKid,
  lastCheckIns,
  memberRows,
  moneyLabel,
  monthlyCount,
  mrrCents,
  resolveWindow,
  revenueByMonth,
} from '../../lib/analytics';
import { buildMemberAnalytics, retainedShare } from '../../lib/member-analytics';
import { computeEligibility } from '../../lib/progression';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export async function registerAnalyticsRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const staff = requireRole('owner', 'admin', 'coach', 'staff');
  const finance = requireRole('owner', 'admin', 'staff');

  app.get('/v1/analytics/overview', { preHandler: staff }, async (request) => {
    const query = analyticsRangeQuerySchema.parse(request.query);
    const { academyId } = auth(request);
    const window = resolveWindow(query.from, query.to);
    const currency = currencyFor(db, academyId);
    const members = memberRows(db, academyId);
    const active = members.filter((member) => member.status === 'active');
    const facts = attendanceFacts(db, academyId, window.from, window.to);
    const checkIns = lastCheckIns(db, academyId);
    const atRisk = active.filter((member) => {
      const last = checkIns.get(member.id);
      return !last || daysBetween(last) >= 14;
    });

    const signups = db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(
        and(
          eq(users.academyId, academyId),
          isNull(users.deletedAt),
          gte(users.createdAt, window.from.toISOString()),
          lte(users.createdAt, window.to.toISOString()),
        ),
      )
      .all();
    const mixRows = db
      .select({
        type: transactions.type,
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
      .groupBy(transactions.type)
      .all();

    const revenueCents = mixRows.reduce((total, row) => total + row.total, 0);
    const data: AnalyticsOverview = {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      metrics: [
        { label: 'Active members', value: String(active.length), hint: 'Students and drop-ins' },
        { label: 'Check-ins', value: String(facts.length), hint: 'In selected period' },
        { label: 'Monthly recurring', value: moneyLabel(mrrCents(db, academyId), currency) },
        { label: 'Revenue', value: moneyLabel(revenueCents, currency), hint: 'Succeeded payments' },
        { label: 'New members', value: String(signups.length) },
        {
          label: 'At risk',
          value: String(atRisk.length),
          tone: atRisk.length ? 'warn' : 'good',
          hint: 'No check-in for 14+ days',
        },
      ],
      revenueSeries: revenueByMonth(db, academyId, window),
      attendanceSeries: monthlyCount(facts.map((fact) => ({ at: fact.checkedInAt })), window),
      signupSeries: monthlyCount(signups.map((row) => ({ at: row.createdAt })), window),
      revenueMix: mixRows.map((row) => ({
        label: row.type.replace(/_/g, ' '),
        value: Math.round(row.total),
      })),
      programPopularity: groupCount(facts, (fact) => fact.programName).slice(0, 8),
    };
    return { ok: true, data };
  });

  app.get('/v1/analytics/progression', { preHandler: staff }, async (request) => {
    const query = analyticsRangeQuerySchema.parse(request.query);
    const { academyId } = auth(request);
    const window = resolveWindow(query.from, query.to, 365);
    const eligibility = computeEligibility(db, academyId);
    const members = memberRows(db, academyId);
    const ranks = currentRanks(db, academyId);
    const programRows = db
      .select({ id: programs.id, name: programs.name })
      .from(programs)
      .where(and(eq(programs.academyId, academyId), isNull(programs.deletedAt)))
      .all();
    const promotionRows = db
      .select({ promotedAt: promotions.promotedAt, toStripes: promotions.toStripes })
      .from(promotions)
      .where(
        and(
          eq(promotions.academyId, academyId),
          gte(promotions.promotedAt, window.from.toISOString()),
          lte(promotions.promotedAt, window.to.toISOString()),
        ),
      )
      .all();

    const data: ProgressionAnalytics = {
      metrics: [
        { label: 'Active students', value: String(members.filter((member) => member.status === 'active').length) },
        {
          label: 'Promotion ready',
          value: String(eligibility.filter((row) => row.eligible).length),
          tone: 'good',
        },
        {
          label: 'Stripe ready',
          value: String(eligibility.filter((row) => row.stripeEligible && !row.beltEligible).length),
        },
        {
          label: 'Avg mat hours in rank',
          value: String(Math.round(average(eligibility.map((row) => row.matHoursSincePromotion)))),
        },
      ],
      beltDistribution: groupCount([...ranks.values()], (rank) => rank.rankName),
      stripeDistribution: groupCount([...ranks.values()], (rank) => String(rank.stripes)),
      ageGroups: groupCount(members, (member) => (isKid(member.dateOfBirth) ? 'Kids' : 'Adults')),
      programBreakdown: programRows.map((program) => {
        const rows = eligibility.filter((row) => row.programId === program.id);
        return {
          programId: program.id,
          programName: program.name,
          students: ranks.size ? rows.length : 0,
          avgMatHours: Math.round(average(rows.map((row) => row.matHoursSincePromotion))),
          eligible: rows.filter((row) => row.eligible).length,
        };
      }),
      promotionTimeline: monthlyCount(
        promotionRows.map((row) => ({ at: row.promotedAt })),
        window,
      ),
      readiness: eligibility.filter((row) => row.eligible || row.stripeEligible).slice(0, query.limit),
    };
    return { ok: true, data };
  });

  app.get('/v1/analytics/attendance', { preHandler: staff }, async (request) => {
    const query = analyticsRangeQuerySchema.parse(request.query);
    const { academyId } = auth(request);
    const window = resolveWindow(query.from, query.to);
    const facts = attendanceFacts(db, academyId, window.from, window.to);
    const bookingsByClass = bookingCounts(db, academyId, window.from, window.to);
    const coaches = db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.academyId, academyId))
      .all();
    const coachNames = new Map(
      coaches.map((coach) => [coach.id, `${coach.firstName} ${coach.lastName}`.trim()]),
    );
    const ranks = currentRanks(db, academyId);

    const classMap = new Map<
      string,
      {
        title: string;
        programName: string;
        sessions: Set<string>;
        attendance: number;
        capacity: number;
        utilization: number;
        noShows: number;
        waitlist: number;
      }
    >();
    for (const fact of facts) {
      const entry = classMap.get(fact.classId) ?? {
        title: fact.classTitle,
        programName: fact.programName,
        sessions: new Set<string>(),
        attendance: 0,
        capacity: fact.capacity,
        utilization: 0,
        noShows: 0,
        waitlist: 0,
      };
      entry.sessions.add(fact.classId);
      entry.attendance += 1;
      classMap.set(fact.classId, entry);
    }
    for (const [classId, counts] of bookingsByClass) {
      const entry = classMap.get(classId);
      if (entry) {
        entry.noShows += counts.noShows;
        entry.waitlist += counts.waitlist;
      }
    }

    const coachMap = new Map<
      string,
      {
        classes: Set<string>;
        sessions: number;
        capacity: number;
        utilization: number;
        students: Set<string>;
        gi: number;
        nogi: number;
      }
    >();
    for (const fact of facts) {
      if (!fact.coachId) continue;
      const entry = coachMap.get(fact.coachId) ?? {
        classes: new Set<string>(),
        sessions: 0,
        capacity: 0,
        utilization: 0,
        students: new Set<string>(),
        gi: 0,
        nogi: 0,
      };
      if (!entry.classes.has(fact.classId)) {
        entry.classes.add(fact.classId);
        entry.capacity += fact.capacity;
      }
      entry.sessions += 1;
      entry.students.add(fact.userId);
      if (fact.discipline === 'gi_bjj') entry.gi += 1;
      if (fact.discipline === 'nogi_bjj') entry.nogi += 1;
      coachMap.set(fact.coachId, entry);
    }

    const totalNoShows = [...bookingsByClass.values()].reduce((sum, v) => sum + v.noShows, 0);
    const totalWaitlist = [...bookingsByClass.values()].reduce((sum, v) => sum + v.waitlist, 0);
    const avgUtilization = (() => {
      const capacities = new Map<string, number>();
      for (const fact of facts) if (!capacities.has(fact.classId)) capacities.set(fact.classId, fact.capacity);
      const totalCapacity = [...capacities.values()].reduce((sum, capacity) => sum + capacity, 0);
      return percent(facts.length, totalCapacity);
    })();

    const weekdayCounts = new Map<number, number>();
    const hourCounts = new Map<number, number>();
    for (const fact of facts) {
      const start = new Date(fact.startsAt);
      const weekday = start.getUTCDay();
      const hour = start.getUTCHours();
      weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
      hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    }

    const data: AttendanceAnalytics = {
      metrics: [
        { label: 'Check-ins', value: String(facts.length) },
        {
          label: 'Avg capacity used',
          value: `${avgUtilization.toFixed(1)}%`,
          tone: avgUtilization >= 70 ? 'good' : 'default',
        },
        { label: 'No-show rate', value: `${percent(totalNoShows, facts.length + totalNoShows).toFixed(1)}%` },
        {
          label: 'Waitlist demand',
          value: String(totalWaitlist),
          tone: totalWaitlist > 0 ? 'warn' : 'default',
        },
      ],
      attendanceSeries: monthlyCount(facts.map((fact) => ({ at: fact.checkedInAt })), window),
      byWeekday: WEEKDAYS.map((label, index) => ({
        label,
        value: weekdayCounts.get(index) ?? 0,
      })),
      byHour: [...hourCounts.entries()]
        .sort(([a], [b]) => a - b)
        .map(([hour, value]) => ({ label: `${String(hour).padStart(2, '0')}:00`, value })),
      classPopularity: [...classMap.values()]
        .map((entry) => ({
          classTitle: entry.title,
          programName: entry.programName,
          sessions: entry.sessions.size,
          avgAttendance: Math.round((entry.attendance / Math.max(1, entry.sessions.size)) * 10) / 10,
          avgUtilization: Math.round(percent(entry.attendance, entry.capacity * Math.max(1, entry.sessions.size)) * 10) / 10,
          noShows: entry.noShows,
          waitlist: entry.waitlist,
        }))
        .sort((a, b) => b.avgAttendance - a.avgAttendance)
        .slice(0, query.limit),
      coachImpact: [...coachMap.entries()].map(([coachId, entry]) => ({
        coachId,
        coachName: coachNames.get(coachId) ?? 'Unassigned',
        classes: entry.classes.size,
        sessionsAttended: entry.sessions,
        avgUtilization: Math.round(percent(entry.sessions, entry.capacity) * 10) / 10,
        uniqueStudents: entry.students.size,
        returningStudents: [...entry.students].filter(
          (userId) => facts.filter((fact) => fact.userId === userId && fact.coachId === coachId).length > 1,
        ).length,
        giClasses: entry.gi,
        nogiClasses: entry.nogi,
      })),
      styleMix: groupCount(
        facts,
        (fact) => DISCIPLINE_LABELS[fact.discipline as keyof typeof DISCIPLINE_LABELS] ?? fact.discipline,
      ),
      levelMix: groupCount(facts, (fact) => ranks.get(fact.userId)?.rankName ?? 'White'),
    };
    return { ok: true, data };
  });

  app.get('/v1/analytics/retention', { preHandler: staff }, async (request) => {
    const query = analyticsRangeQuerySchema.parse(request.query);
    const { academyId } = auth(request);
    const window = resolveWindow(query.from, query.to, 365);
    const members = memberRows(db, academyId);
    const membershipsRows = db
      .select()
      .from(memberships)
      .where(eq(memberships.academyId, academyId))
      .all();
    const checkIns = lastCheckIns(db, academyId);
    const facts = attendanceFacts(db, academyId, new Date(members[0]?.createdAt ?? window.from));
    const months = monthRange(window.from, window.to);

    const monthlyChurn = months.map((month) => {
      const inMonth = (value: string | null) => value?.startsWith(month) ?? false;
      const churned = membershipsRows.filter((row) => inMonth(row.cancelledAt)).length;
      const newMembers = membershipsRows.filter((row) => inMonth(row.createdAt)).length;
      const activeAtStart = membershipsRows.filter((row) => {
        const started = new Date(row.createdAt) < new Date(`${month}-01T00:00:00.000Z`);
        const ended = row.cancelledAt ? new Date(row.cancelledAt) < new Date(`${month}-01T00:00:00.000Z`) : false;
        return started && !ended;
      }).length;
      return {
        month,
        churnRate: percent(churned, Math.max(1, activeAtStart)),
        newMembers,
        churned,
      };
    });

    const closed = membershipsRows.filter((row) => row.cancelledAt);
    const lifespanDays = closed.map((row) => daysBetween(row.createdAt, row.cancelledAt!));
    const tenureBuckets = ['0-30 days', '31-90 days', '3-6 months', '6-12 months', '1-2 years', '2+ years'].map(
      (label) => {
        const rows = membershipsRows.filter((row) => {
          const end = row.cancelledAt ?? new Date().toISOString();
          return tenureBucket(daysBetween(row.createdAt, end)) === label;
        });
        const churned = rows.filter((row) => row.status === 'cancelled').length;
        return {
          label,
          active: rows.length - churned,
          churned,
          churnRate: percent(churned, rows.length),
        };
      },
    );

    const cohorts = buildCohorts(
      members.map((member) => ({ userId: member.id, at: member.createdAt })),
      facts.map((fact) => ({ userId: fact.userId, at: fact.checkedInAt })),
      new Date(),
    );
    const reasonLabels: Record<string, string> = {
      too_expensive: 'Too expensive',
      relocated: 'Relocated',
      time_constraints: 'Time constraints',
      injury: 'Injury',
      switched_gym: 'Switched gym',
      dissatisfied: 'Dissatisfied',
      other: 'Other',
    };
    const dropOffPoints = [
      ...groupCount(closed, (row) => reasonLabels[row.cancellationReason ?? 'other'] ?? 'Unknown'),
      ...groupCount(closed, (row) => tenureBucket(daysBetween(row.createdAt, row.cancelledAt!))).map(
        (row) => ({ label: `Churned at ${row.label}`, value: row.value }),
      ),
    ];

    const atRisk = members
      .filter((member) => member.status === 'active')
      .map((member) => {
        const last = checkIns.get(member.id) ?? null;
        const days = last ? daysBetween(last) : 999;
        return {
          userId: member.id,
          memberName: `${member.firstName} ${member.lastName}`.trim(),
          daysSinceCheckIn: last ? days : -1,
          lastCheckInAt: last,
          tenureDays: daysBetween(member.createdAt),
          risk: alertRisk(days),
          membershipStatus:
            membershipsRows.find((row) => row.userId === member.id)?.status ?? null,
        };
      })
      .filter((member) => member.daysSinceCheckIn >= 7 || member.daysSinceCheckIn < 0)
      .sort((a, b) => b.daysSinceCheckIn - a.daysSinceCheckIn)
      .slice(0, query.limit);

    const data: RetentionAnalytics = {
      metrics: [
        {
          label: 'Monthly churn',
          value: `${(monthlyChurn.at(-1)?.churnRate ?? 0).toFixed(1)}%`,
          tone: (monthlyChurn.at(-1)?.churnRate ?? 0) > 5 ? 'warn' : 'good',
        },
        {
          label: 'Avg member lifespan',
          value: `${Math.round(average(lifespanDays))} days`,
        },
        {
          label: 'At-risk members',
          value: String(atRisk.length),
          tone: atRisk.length ? 'warn' : 'good',
        },
        {
          label: 'Median check-in gap',
          value: `${Math.round(median(members
            .map((member) => {
              const last = checkIns.get(member.id);
              return last ? daysBetween(last) : null;
            })
            .filter((days): days is number => days !== null)))} days`,
        },
      ],
      monthlyChurn,
      tenureBuckets,
      cohorts,
      dropOffPoints,
      atRisk,
    };
    return { ok: true, data };
  });

  app.get('/v1/analytics/financial', { preHandler: finance }, async (request) => {
    const query = analyticsRangeQuerySchema.parse(request.query);
    const { academyId } = auth(request);
    const window = resolveWindow(query.from, query.to);
    const currency = currencyFor(db, academyId);
    const activeCount = memberRows(db, academyId).filter((member) => member.status === 'active').length;
    const mrr = mrrCents(db, academyId);
    const arpu = activeCount ? Math.round(mrr / activeCount) : 0;
    const ltv = arpu * 12;

    const mixRows = db
      .select({ type: transactions.type, total: sql<number>`sum(${transactions.totalCents})` })
      .from(transactions)
      .where(
        and(
          eq(transactions.academyId, academyId),
          eq(transactions.status, 'succeeded'),
          gte(transactions.createdAt, window.from.toISOString()),
          lte(transactions.createdAt, window.to.toISOString()),
        ),
      )
      .groupBy(transactions.type)
      .all();
    const planMix = db
      .select({
        label: membershipPlans.name,
        total: sql<number>`sum(${membershipPlans.priceCents})`,
      })
      .from(memberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
      .where(
        and(
          eq(memberships.academyId, academyId),
          inArray(memberships.status, ['active', 'trialing', 'past_due']),
        ),
      )
      .groupBy(membershipPlans.name)
      .all();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const income = mixRows.reduce((total, row) => total + row.total, 0);
    const recentIncomeRow = db
      .select({
        total: sql<number>`coalesce(sum(${transactions.totalCents}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.academyId, academyId),
          eq(transactions.status, 'succeeded'),
          gte(transactions.createdAt, thirtyDaysAgo),
        ),
      )
      .get();
    const recentIncome = recentIncomeRow?.total ?? 0;
    const cogsRow = db
      .select({
        total: sql<number>`coalesce(sum(${retailProducts.costCents} * ${transactionItems.quantity}), 0)`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
      .innerJoin(retailProducts, eq(retailProducts.id, transactionItems.productId))
      .where(
        and(
          eq(transactions.academyId, academyId),
          eq(transactions.type, 'retail'),
          eq(transactions.status, 'succeeded'),
          gte(transactions.createdAt, thirtyDaysAgo),
        ),
      )
      .get();
    const projected = projectCashFlow(recentIncome, cogsRow?.total ?? 0, 6);

    const failedRows = db
      .select({
        id: transactions.id,
        totalCents: transactions.totalCents,
        failureCode: transactions.failureCode,
        createdAt: transactions.createdAt,
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(transactions)
      .leftJoin(users, eq(users.id, transactions.userId))
      .where(
        and(
          eq(transactions.academyId, academyId),
          eq(transactions.status, 'failed'),
          gte(transactions.createdAt, window.from.toISOString()),
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .limit(query.limit)
      .all();
    const retries = db
      .select({ transactionId: paymentRetries.transactionId })
      .from(paymentRetries)
      .where(eq(paymentRetries.academyId, academyId))
      .all();
    const retryCounts = new Map<string, number>();
    for (const retry of retries) {
      if (!retry.transactionId) continue;
      retryCounts.set(retry.transactionId, (retryCounts.get(retry.transactionId) ?? 0) + 1);
    }

    const expiringCutoff = new Date(Date.now() + 60 * 86_400_000);
    const cardRows = db
      .select({
        userId: paymentMethods.userId,
        brand: paymentMethods.brand,
        last4: paymentMethods.last4,
        expiryMonth: paymentMethods.expiryMonth,
        expiryYear: paymentMethods.expiryYear,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(paymentMethods)
      .leftJoin(users, eq(users.id, paymentMethods.userId))
      .where(and(eq(paymentMethods.academyId, academyId), eq(paymentMethods.status, 'active')))
      .all();
    const expiringCards = cardRows
      .filter((card) => {
        if (!card.expiryYear || !card.expiryMonth) return false;
        const expiry = new Date(Date.UTC(card.expiryYear, card.expiryMonth - 1, 1));
        return expiry <= expiringCutoff;
      })
      .map((card) => ({
        userId: card.userId,
        memberName: `${card.firstName ?? ''} ${card.lastName ?? ''}`.trim() || 'Member',
        brand: card.brand,
        last4: card.last4,
        expiry: `${String(card.expiryMonth).padStart(2, '0')}/${card.expiryYear}`,
      }));

    const data: FinancialAnalytics = {
      metrics: [
        { label: 'MRR', value: moneyLabel(mrr, currency), tone: 'good' },
        { label: 'Revenue / member', value: moneyLabel(arpu, currency) },
        { label: 'Est. lifetime value', value: moneyLabel(ltv, currency), hint: 'ARPU × 12 months' },
        { label: 'Revenue in period', value: moneyLabel(income, currency) },
        {
          label: 'Failed payments',
          value: String(failedRows.length),
          tone: failedRows.length ? 'warn' : 'good',
        },
        {
          label: 'Next month projected',
          value: moneyLabel(projected[0]?.value ?? 0, currency),
        },
      ],
      revenueSeries: revenueByMonth(db, academyId, window),
      revenueMix: mixRows.map((row) => ({
        label: row.type.replace(/_/g, ' '),
        value: Math.round(row.total),
      })),
      planMix: planMix.map((row) => ({ label: row.label, value: Math.round(row.total) })),
      cashFlowProjection: projected.map((row) => ({ label: row.label, value: row.value })),
      failedPayments: failedRows.map((row) => ({
        userId: row.userId ?? '',
        memberName: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim() || 'Unknown member',
        amountCents: row.totalCents,
        failureCode: row.failureCode,
        occurredAt: row.createdAt,
        retries: retryCounts.get(row.id) ?? 0,
      })),
      expiringCards,
    };
    return { ok: true, data };
  });

  app.get('/v1/analytics/leads', { preHandler: staff }, async (request) => {
    const query = analyticsRangeQuerySchema.parse(request.query);
    const { academyId } = auth(request);
    const window = resolveWindow(query.from, query.to, 180);
    const leadRows = db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.academyId, academyId),
          isNull(leads.deletedAt),
          gte(leads.createdAt, window.from.toISOString()),
          lte(leads.createdAt, window.to.toISOString()),
        ),
      )
      .all();
    const converted = leadRows.filter((lead) => lead.status === 'converted');
    const trials = leadRows.filter((lead) => lead.trialAttendedAt);
    const conversionDays = converted
      .filter((lead) => lead.convertedAt)
      .map((lead) => daysBetween(lead.createdAt, lead.convertedAt!));
    const sourceGroups = groupCount(leadRows, (lead) => lead.source);
    const membershipIds = converted.map((lead) => lead.convertedMembershipId).filter(Boolean) as string[];
    const membershipUsers = membershipIds.length
      ? db
          .select({ id: memberships.id, userId: memberships.userId })
          .from(memberships)
          .where(inArray(memberships.id, membershipIds))
          .all()
      : [];
    const userByMembership = new Map(membershipUsers.map((row) => [row.id, row.userId]));
    const retainedSince = new Date(Date.now() - 90 * 86_400_000);

    const data: LeadAnalytics = {
      metrics: [
        { label: 'Leads', value: String(leadRows.length) },
        { label: 'Trials attended', value: String(trials.length) },
        {
          label: 'Conversions',
          value: String(converted.length),
          tone: converted.length ? 'good' : 'default',
        },
        {
          label: 'Trial → member',
          value: `${percent(converted.length, trials.length).toFixed(1)}%`,
        },
        {
          label: 'Median time to convert',
          value: `${Math.round(median(conversionDays))} days`,
        },
      ],
      leadSeries: monthlyCount(leadRows.map((lead) => ({ at: lead.createdAt })), window),
      funnel: [
        { label: 'New leads', value: leadRows.length },
        { label: 'Contacted', value: leadRows.filter((lead) => lead.lastContactAt).length },
        { label: 'Trials attended', value: trials.length },
        { label: 'Converted', value: converted.length },
      ],
      sourceAttribution: sourceGroups.map((group) => {
        const groupLeads = leadRows.filter((lead) => lead.source === group.label);
        const groupConverted = groupLeads.filter((lead) => lead.status === 'converted');
        const userIds = groupConverted
          .map((lead) => (lead.convertedMembershipId ? userByMembership.get(lead.convertedMembershipId) : null))
          .filter((id): id is string => Boolean(id));
        return {
          source: group.label.replace(/_/g, ' '),
          leads: group.value,
          trials: groupLeads.filter((lead) => lead.trialAttendedAt).length,
          converted: groupConverted.length,
          conversionRate: percent(groupConverted.length, group.value),
          retained90Days: Math.round(retainedShare(db, academyId, userIds, retainedSince)),
        };
      }),
      followUps: leadRows
        .filter((lead) => !['converted', 'lost'].includes(lead.status))
        .sort((a, b) => (a.lastContactAt ?? a.createdAt).localeCompare(b.lastContactAt ?? b.createdAt))
        .slice(0, query.limit)
        .map((lead) => ({
          leadId: lead.id,
          leadName: `${lead.firstName} ${lead.lastName}`.trim(),
          source: lead.source.replace(/_/g, ' '),
          status: lead.status.replace(/_/g, ' '),
          lastContactAt: lead.lastContactAt,
          daysSinceContact: daysBetween(lead.lastContactAt ?? lead.createdAt),
        })),
    };
    return { ok: true, data };
  });

  app.get('/v1/analytics/member/:userId', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const { userId } = request.params as { userId: string };
    const data = buildMemberAnalytics(db, academyId, userId);
    if (!data) throw notFound('Member not found');
    return { ok: true, data };
  });

  /** Student-facing view: same numbers, but only for the authenticated user. */
  app.get('/v1/analytics/me', async (request) => {
    const { academyId, userId } = auth(request);
    const data: MemberAnalytics | null = buildMemberAnalytics(db, academyId, userId);
    if (!data) throw notFound('Profile not found');
    return { ok: true, data };
  });
}
