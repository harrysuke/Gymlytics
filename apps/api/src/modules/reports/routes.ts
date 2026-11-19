import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type AnyColumn } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  attendanceLogs,
  classes,
  incidents,
  leads,
  memberships,
  membershipPlans,
  paymentMethods,
  paymentRetries,
  programs,
  retailProducts,
  transactions,
  transactionItems,
  users,
  waivers,
  type Db,
} from '@gymlytics/db';
import {
  DISCIPLINE_LABELS,
  alertRisk,
  daysBetween,
  reportQuerySchema,
  reportSlugSchema,
  type Metric,
  type ReportQuery,
  type ReportResult,
  type ReportRow,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { notFound } from '../../lib/errors';
import {
  attendanceFacts,
  bookingCounts,
  currencyFor,
  lastCheckIns,
  memberRows,
  moneyLabel,
  resolveWindow,
  type DateWindow,
} from '../../lib/analytics';
import { computeEligibility } from '../../lib/progression';
import { REPORT_DEFINITIONS } from './definitions';

interface BuildContext {
  db: Db;
  academyId: string;
  query: ReportQuery;
  window: DateWindow;
  currency: string;
}

type Built = { rows: ReportRow[]; summary: Metric[] };

function metric(label: string, value: string | number, hint?: string, tone?: Metric['tone']): Metric {
  return { label, value: String(value), ...(hint ? { hint } : {}), ...(tone ? { tone } : {}) };
}

function monthOf(value: string): string {
  return value.slice(0, 7);
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function styleLabel(discipline: string, programName: string): string {
  if (discipline === 'kids_bjj') return 'Kids';
  if (discipline === 'nogi_bjj') return 'No-Gi';
  if (discipline === 'gi_bjj') return 'Gi';
  return DISCIPLINE_LABELS[discipline as keyof typeof DISCIPLINE_LABELS] ?? programName;
}

export async function registerReportRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const staff = requireRole('owner', 'admin', 'coach', 'staff');

  app.get('/v1/reports', { preHandler: staff }, async () => ({
    ok: true,
    data: REPORT_DEFINITIONS,
  }));

  app.get('/v1/reports/:slug', { preHandler: staff }, async (request) => {
    const slug = reportSlugSchema.parse((request.params as { slug: string }).slug);
    const query = reportQuerySchema.parse(request.query);
    const { academyId } = auth(request);
    const definition = REPORT_DEFINITIONS.find((item) => item.slug === slug);
    if (!definition) throw notFound('Report not found');
    const context: BuildContext = {
      db,
      academyId,
      query,
      window: resolveWindow(query.from, query.to),
      currency: currencyFor(db, academyId),
    };
    const build = builders[slug];
    if (!build) throw notFound('Report not found');
    const built = build(context);
    const result: ReportResult = {
      slug,
      title: definition.title,
      generatedAt: new Date().toISOString(),
      columns: definition.columns,
      rows: built.rows.slice(0, query.limit),
      summary: built.summary,
    };
    return { ok: true, data: result };
  });
}

const builders: Record<string, (context: BuildContext) => Built> = {
  'belt-eligibility': ({ db, academyId, query }) => {
    const eligibility = computeEligibility(db, academyId).filter(
      (row) => row.eligible || row.stripeEligible,
    );
    const rows: ReportRow[] = eligibility.map((row) => ({
      member: row.memberName,
      program: row.programName,
      currentRank: row.currentRankName,
      stripes: row.currentStripes,
      nextRank: row.nextRankName ?? '—',
      matHours: row.matHoursSincePromotion,
      classes: row.classesSincePromotion,
      monthsInRank: row.monthsInRank,
      status: row.eligible ? 'Belt ready' : 'Stripe ready',
    }));
    return {
      rows,
      summary: [
        metric('Belt ready', rows.filter((row) => row.status === 'Belt ready').length),
        metric('Stripe ready', rows.filter((row) => row.status === 'Stripe ready').length),
        metric('Total on roster', rows.length),
        metric('Mat hours required', 'Programme rules', 'From belt rank configuration'),
      ],
    };
  },

  'daily-roster': ({ db, academyId, query, window }) => {
    const date = query.date ?? window.from.toISOString().slice(0, 10);
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const classRows = db
      .select({
        id: classes.id,
        title: classes.title,
        startsAt: classes.startsAt,
        capacity: classes.capacity,
        programName: programs.name,
        discipline: programs.discipline,
        coachName: sql<string>`trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, ''))`,
      })
      .from(classes)
      .innerJoin(programs, eq(programs.id, classes.programId))
      .leftJoin(users, eq(users.id, classes.coachId))
      .where(
        and(
          eq(classes.academyId, academyId),
          isNull(classes.deletedAt),
          gte(classes.startsAt, dayStart.toISOString()),
          ltDayEnd(classes.startsAt, dayEnd.toISOString()),
        ),
      )
      .orderBy(asc(classes.startsAt))
      .all();
    const bookingMap = bookingCounts(db, academyId, dayStart, dayEnd);
    const logs = db
      .select({
        classId: attendanceLogs.classId,
        dropIn: sql<number>`case when ${attendanceLogs.dropInTransactionId} is null then 0 else 1 end`,
      })
      .from(attendanceLogs)
      .where(
        and(
          eq(attendanceLogs.academyId, academyId),
          isNull(attendanceLogs.deletedAt),
          inArray(attendanceLogs.status, ['checked_in', 'checked_out']),
          gte(attendanceLogs.checkedInAt, dayStart.toISOString()),
          ltDayEnd(attendanceLogs.checkedInAt, dayEnd.toISOString()),
        ),
      )
      .all();
    const headcount = new Map<string, number>();
    const dropIns = new Map<string, number>();
    for (const log of logs) {
      headcount.set(log.classId, (headcount.get(log.classId) ?? 0) + 1);
      if (log.dropIn) dropIns.set(log.classId, (dropIns.get(log.classId) ?? 0) + 1);
    }
    const rows: ReportRow[] = classRows.map((row) => {
      const count = headcount.get(row.id) ?? 0;
      const bookings = bookingMap.get(row.id);
      return {
        time: new Date(row.startsAt).toISOString().slice(11, 16),
        className: row.title,
        style: styleLabel(row.discipline, row.programName),
        coach: row.coachName || 'Unassigned',
        headcount: count,
        dropIns: dropIns.get(row.id) ?? 0,
        capacity: row.capacity,
        utilization: row.capacity ? Math.round((count / row.capacity) * 1000) / 10 : 0,
        noShows: bookings?.noShows ?? 0,
        waitlist: bookings?.waitlist ?? 0,
      };
    });
    const totalHeadcount = rows.reduce((sum, row) => sum + Number(row.headcount), 0);
    return {
      rows,
      summary: [
        metric('Sessions', rows.length),
        metric('Total headcount', totalHeadcount),
        metric('Drop-ins', rows.reduce((sum, row) => sum + Number(row.dropIns), 0)),
        metric('Waitlist', rows.reduce((sum, row) => sum + Number(row.waitlist), 0)),
      ],
    };
  },

  'instructor-payroll': ({ db, academyId, window }) => {
    const classRows = db
      .select({
        id: classes.id,
        title: classes.title,
        startsAt: classes.startsAt,
        endsAt: classes.endsAt,
        coachId: classes.coachId,
        discipline: programs.discipline,
        coachName: sql<string>`trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, ''))`,
      })
      .from(classes)
      .innerJoin(programs, eq(programs.id, classes.programId))
      .leftJoin(users, eq(users.id, classes.coachId))
      .where(
        and(
          eq(classes.academyId, academyId),
          isNull(classes.deletedAt),
          gte(classes.startsAt, window.from.toISOString()),
          lte(classes.startsAt, window.to.toISOString()),
        ),
      )
      .all();
    const facts = attendanceFacts(db, academyId, window.from, window.to);
    const byCoach = new Map<string, typeof classRows>();
    for (const row of classRows) {
      const key = row.coachId ?? 'unassigned';
      if (!byCoach.has(key)) byCoach.set(key, []);
      byCoach.get(key)!.push(row);
    }
    const rows: ReportRow[] = [...byCoach.entries()].map(([coachId, coached]) => {
      const headcount = facts.filter((fact) => fact.coachId === coachId).length;
      const hours = coached.reduce(
        (total, row) =>
          total + Math.max(0, (new Date(row.endsAt).getTime() - new Date(row.startsAt).getTime()) / 3_600_000),
        0,
      );
      return {
        coach: coached[0]?.coachName || 'Unassigned',
        classes: coached.length,
        privateLessons: coached.filter((row) => /private/i.test(row.title)).length,
        hours: Math.round(hours * 10) / 10,
        studentHeadcount: headcount,
        avgHeadcount: coached.length ? Math.round((headcount / coached.length) * 10) / 10 : 0,
        styles: [...new Set(coached.map((row) => styleLabel(row.discipline, '')))].join(', '),
      };
    });
    return {
      rows,
      summary: [
        metric('Coaches', rows.length),
        metric('Classes taught', rows.reduce((sum, row) => sum + Number(row.classes), 0)),
        metric('Private lessons', rows.reduce((sum, row) => sum + Number(row.privateLessons), 0)),
        metric('Teaching hours', Math.round(rows.reduce((sum, row) => sum + Number(row.hours), 0))),
      ],
    };
  },

  'mia-at-risk': ({ db, academyId, query }) => {
    const threshold = query.days ?? 14;
    const checkIns = lastCheckIns(db, academyId);
    const statuses = new Map(
      db
        .select({ userId: memberships.userId, status: memberships.status })
        .from(memberships)
        .where(eq(memberships.academyId, academyId))
        .all()
        .map((row) => [row.userId, row.status]),
    );
    const rows: ReportRow[] = memberRows(db, academyId)
      .filter((member) => member.status === 'active')
      .map((member) => {
        const last = checkIns.get(member.id) ?? null;
        const days = last ? daysBetween(last) : 999;
        const risk = alertRisk(days);
        return {
          member: `${member.firstName} ${member.lastName}`.trim(),
          lastCheckIn: last?.slice(0, 10) ?? 'Never',
          daysSince: last ? days : -1,
          tenure: daysBetween(member.createdAt),
          membership: statuses.get(member.id) ?? 'None',
          risk,
          action:
            risk === 'critical'
              ? 'Call and send a check-in message today'
              : risk === 'at_risk'
                ? 'Personal message from coach this week'
                : 'Monitor attendance',
          link: `/admin/analytics/member/${member.id}`,
        };
      })
      .filter((row) => Number(row.daysSince) >= threshold || Number(row.daysSince) < 0)
      .sort((a, b) => Number(b.daysSince) - Number(a.daysSince));
    return {
      rows,
      summary: [
        metric(`Inactive ${threshold}+ days`, rows.length),
        metric('30+ days', rows.filter((row) => Number(row.daysSince) >= 30).length, undefined, 'warn'),
        metric('Never checked in', rows.filter((row) => Number(row.daysSince) < 0).length),
        metric('Requiring outreach', rows.filter((row) => row.risk !== 'watch').length),
      ],
    };
  },

  'membership-changes': ({ db, academyId, query }) => {
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    const inMonth = (value: string | null) => value?.startsWith(month) ?? false;
    const memberById = new Map(memberRows(db, academyId).map((member) => [member.id, member]));
    const planById = new Map(
      db
        .select({ id: membershipPlans.id, name: membershipPlans.name })
        .from(membershipPlans)
        .where(eq(membershipPlans.academyId, academyId))
        .all()
        .map((plan) => [plan.id, plan.name]),
    );
    const membershipRows = db
      .select()
      .from(memberships)
      .where(eq(memberships.academyId, academyId))
      .all();
    const label = (userId: string) => {
      const member = memberById.get(userId);
      return member ? `${member.firstName} ${member.lastName}`.trim() : 'Unknown member';
    };
    const rows: ReportRow[] = [];
    for (const member of memberById.values()) {
      if (inMonth(member.createdAt)) {
        rows.push({
          date: member.createdAt.slice(0, 10),
          change: 'New sign-up',
          member: `${member.firstName} ${member.lastName}`.trim(),
          plan: '—',
          reason: '—',
          detail: `Joined via ${titleCase(member.acquisitionSource ?? 'walk in')}`,
          link: `/admin/analytics/member/${member.id}`,
        });
      }
    }
    for (const membership of membershipRows) {
      const plan = planById.get(membership.planId) ?? '—';
      if (inMonth(membership.frozenAt)) {
        rows.push({
          date: membership.frozenAt!.slice(0, 10),
          change: 'Frozen',
          member: label(membership.userId),
          plan,
          reason: '—',
          detail: `Frozen until ${membership.freezeUntil?.slice(0, 10) ?? 'unknown'}`,
          link: `/admin/analytics/member/${membership.userId}`,
        });
      }
      if (membership.status === 'active' && inMonth(membership.currentPeriodStart) && !inMonth(membership.createdAt)) {
        rows.push({
          date: membership.currentPeriodStart.slice(0, 10),
          change: 'Reactivated',
          member: label(membership.userId),
          plan,
          reason: '—',
          detail: 'Active membership period started',
          link: `/admin/analytics/member/${membership.userId}`,
        });
      }
      if (inMonth(membership.cancelledAt)) {
        rows.push({
          date: membership.cancelledAt!.slice(0, 10),
          change: 'Cancelled',
          member: label(membership.userId),
          plan,
          reason: titleCase(membership.cancellationReason ?? 'other'),
          detail: membership.cancellationNote ?? 'No note recorded',
          link: `/admin/analytics/member/${membership.userId}`,
        });
      }
    }
    rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return {
      rows,
      summary: [
        metric('New sign-ups', rows.filter((row) => row.change === 'New sign-up').length),
        metric('Frozen', rows.filter((row) => row.change === 'Frozen').length),
        metric('Reactivated', rows.filter((row) => row.change === 'Reactivated').length),
        metric('Cancelled', rows.filter((row) => row.change === 'Cancelled').length, undefined, 'warn'),
      ],
    };
  },

  'trial-follow-up': ({ db, academyId }) => {
    const rows: ReportRow[] = db
      .select()
      .from(leads)
      .where(
        and(
          eq(leads.academyId, academyId),
          isNull(leads.deletedAt),
          gte(leads.trialAttendedAt, '1900-01-01T00:00:00.000Z'),
        ),
      )
      .all()
      .filter((lead) => !['converted', 'lost'].includes(lead.status))
      .sort((a, b) => (a.lastContactAt ?? a.createdAt).localeCompare(b.lastContactAt ?? b.createdAt))
      .map((lead) => {
        const days = daysBetween(lead.lastContactAt ?? lead.createdAt);
        return {
          lead: `${lead.firstName} ${lead.lastName}`.trim(),
          source: titleCase(lead.source),
          trialDate: lead.trialAttendedAt?.slice(0, 10) ?? '—',
          status: titleCase(lead.status),
          lastContact: (lead.lastContactAt ?? lead.createdAt).slice(0, 10),
          daysSinceContact: days,
          phone: lead.phone ?? '—',
          action: days >= 7 ? 'Call today — follow-up overdue' : 'Offer membership options',
        };
      });
    return {
      rows,
      summary: [
        metric('Awaiting follow-up', rows.length),
        metric('Overdue 7+ days', rows.filter((row) => Number(row.daysSinceContact) >= 7).length, undefined, 'warn'),
        metric('Longest gap', `${Math.max(0, ...rows.map((row) => Number(row.daysSinceContact)))} days`),
        metric('Sources', new Set(rows.map((row) => row.source)).size),
      ],
    };
  },

  'failed-payments': ({ db, academyId, query, currency }) => {
    const failed = db
      .select({
        id: transactions.id,
        totalCents: transactions.totalCents,
        failureCode: transactions.failureCode,
        failureMessage: transactions.failureMessage,
        createdAt: transactions.createdAt,
        memberName: sql<string>`trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, ''))`,
        userId: users.id,
      })
      .from(transactions)
      .leftJoin(users, eq(users.id, transactions.userId))
      .where(
        and(
          eq(transactions.academyId, academyId),
          eq(transactions.status, 'failed'),
          gte(transactions.createdAt, resolveWindow(query.from, query.to, 365).from.toISOString()),
        ),
      )
      .orderBy(desc(transactions.createdAt))
      .all();
    const retryCounts = new Map<string, number>();
    for (const retry of db
      .select({ transactionId: paymentRetries.transactionId })
      .from(paymentRetries)
      .where(eq(paymentRetries.academyId, academyId))
      .all()) {
      if (!retry.transactionId) continue;
      retryCounts.set(retry.transactionId, (retryCounts.get(retry.transactionId) ?? 0) + 1);
    }
    const pastDue = db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        periodEnd: memberships.currentPeriodEnd,
        memberName: sql<string>`trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, ''))`,
      })
      .from(memberships)
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.academyId, academyId), eq(memberships.status, 'past_due')))
      .all();
    const expiring = db
      .select({
        userId: paymentMethods.userId,
        brand: paymentMethods.brand,
        last4: paymentMethods.last4,
        expiryMonth: paymentMethods.expiryMonth,
        expiryYear: paymentMethods.expiryYear,
        memberName: sql<string>`trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, ''))`,
      })
      .from(paymentMethods)
      .leftJoin(users, eq(users.id, paymentMethods.userId))
      .where(and(eq(paymentMethods.academyId, academyId), eq(paymentMethods.status, 'active')))
      .all()
      .filter((card) => {
        if (!card.expiryYear || !card.expiryMonth) return false;
        return new Date(Date.UTC(card.expiryYear, card.expiryMonth - 1, 1)) <= new Date(Date.now() + 60 * 86_400_000);
      });

    const rows: ReportRow[] = [
      ...failed.map((row) => ({
        member: row.memberName || 'Unknown member',
        type: 'Declined card',
        amount: moneyLabel(row.totalCents, currency),
        occurred: row.createdAt.slice(0, 10),
        ageDays: daysBetween(row.createdAt),
        detail: row.failureMessage ?? row.failureCode ?? 'Payment declined',
        retries: retryCounts.get(row.id) ?? 0,
        action: 'Retry payment / contact member',
        link: row.userId ? `/admin/members/${row.userId}` : '',
      })),
      ...pastDue.map((row) => ({
        member: row.memberName || 'Unknown member',
        type: 'Past-due membership',
        amount: '—',
        occurred: row.periodEnd.slice(0, 10),
        ageDays: daysBetween(row.periodEnd),
        detail: 'Membership period ended without payment',
        retries: 0,
        action: 'Run dunning / suspend access',
        link: `/admin/members/${row.userId}`,
      })),
      ...expiring.map((row) => ({
        member: row.memberName || 'Unknown member',
        type: 'Card expiring',
        amount: '—',
        occurred: `${String(row.expiryMonth).padStart(2, '0')}/${row.expiryYear}`,
        ageDays: 0,
        detail: `${row.brand ?? 'Card'} ending ${row.last4 ?? '****'}`,
        retries: 0,
        action: 'Ask member to update card details',
        link: `/admin/members/${row.userId}`,
      })),
    ];
    const overdueCents = failed.reduce((sum, row) => sum + row.totalCents, 0);
    return {
      rows,
      summary: [
        metric('Declined payments', failed.length, undefined, 'warn'),
        metric('Past-due memberships', pastDue.length, undefined, 'warn'),
        metric('Cards expiring', expiring.length),
        metric('Overdue amount', moneyLabel(overdueCents, currency)),
      ],
    };
  },

  'revenue-tax': ({ db, academyId, query, currency }) => {
    const month = query.month ?? new Date().toISOString().slice(0, 7);
    const rowsRaw = db
      .select({
        type: transactions.type,
        count: sql<number>`count(*)`,
        gross: sql<number>`sum(${transactions.subtotalCents})`,
        tax: sql<number>`sum(${transactions.taxCents})`,
        net: sql<number>`sum(${transactions.totalCents})`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.academyId, academyId),
          eq(transactions.status, 'succeeded'),
          gte(transactions.createdAt, `${month}-01T00:00:00.000Z`),
          lte(transactions.createdAt, `${month}-31T23:59:59.999Z`),
        ),
      )
      .groupBy(transactions.type)
      .all();
    const categoryLabels: Record<string, string> = {
      membership: 'Recurring memberships',
      day_pass: 'Day passes & drop-ins',
      private_session: 'Private sessions',
      seminar: 'Seminar fees',
      retail: 'Retail sales',
      refund: 'Refunds',
      chargeback: 'Chargebacks',
    };
    const rows: ReportRow[] = rowsRaw.map((row) => ({
      category: categoryLabels[row.type] ?? titleCase(row.type),
      transactions: row.count,
      gross: moneyLabel(row.gross ?? 0, currency),
      tax: moneyLabel(row.tax ?? 0, currency),
      net: moneyLabel(row.net ?? 0, currency),
    }));
    const totalGross = rowsRaw.reduce((sum, row) => sum + (row.gross ?? 0), 0);
    const totalTax = rowsRaw.reduce((sum, row) => sum + (row.tax ?? 0), 0);
    rows.push({
      category: 'Total',
      transactions: rowsRaw.reduce((sum, row) => sum + row.count, 0),
      gross: moneyLabel(totalGross, currency),
      tax: moneyLabel(totalTax, currency),
      net: moneyLabel(rowsRaw.reduce((sum, row) => sum + (row.net ?? 0), 0), currency),
    });
    return {
      rows,
      summary: [
        metric('Period', month),
        metric('Gross revenue', moneyLabel(totalGross, currency)),
        metric('Tax collected', moneyLabel(totalTax, currency)),
        metric('Net revenue', moneyLabel(totalGross + totalTax, currency)),
      ],
    };
  },

  'proshop-inventory': ({ db, academyId, currency }) => {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const soldRows = db
      .select({
        productId: transactionItems.productId,
        units: sql<number>`sum(${transactionItems.quantity})`,
        revenue: sql<number>`sum(${transactionItems.totalCents})`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactions.id, transactionItems.transactionId))
      .where(
        and(
          eq(transactions.academyId, academyId),
          eq(transactions.status, 'succeeded'),
          eq(transactions.type, 'retail'),
          gte(transactions.createdAt, since),
        ),
      )
      .groupBy(transactionItems.productId)
      .all();
    const sold = new Map(soldRows.map((row) => [row.productId, row]));
    const products = db
      .select()
      .from(retailProducts)
      .where(and(eq(retailProducts.academyId, academyId), isNull(retailProducts.deletedAt)))
      .all();
    const rows: ReportRow[] = products.map((product) => {
      const soldRow = sold.get(product.id);
      const units = soldRow?.units ?? 0;
      const velocity = Math.round((units / 30) * 100) / 100;
      return {
        sku: product.sku,
        product: product.name,
        category: product.category,
        inStock: product.stockQuantity,
        threshold: product.lowStockThreshold,
        unitsSold: units,
        velocity,
        daysOfCover: velocity > 0 ? Math.round(product.stockQuantity / velocity) : 999,
        revenue: moneyLabel(soldRow?.revenue ?? 0, currency),
        status: product.stockQuantity <= product.lowStockThreshold ? 'Low stock' : 'Healthy',
      };
    });
    return {
      rows,
      summary: [
        metric('Low-stock items', rows.filter((row) => row.status === 'Low stock').length, undefined, 'warn'),
        metric('SKU count', rows.length),
        metric(
          'Stock at cost',
          moneyLabel(products.reduce((sum, product) => sum + product.stockQuantity * (product.costCents ?? 0), 0), currency),
        ),
        metric(
          'Revenue (30d)',
          moneyLabel(soldRows.reduce((sum, row) => sum + (row.revenue ?? 0), 0), currency),
        ),
      ],
    };
  },

  'waiver-audit': ({ db, academyId }) => {
    const members = memberRows(db, academyId).filter((member) => member.status === 'active');
    const signed = db
      .select()
      .from(waivers)
      .where(and(eq(waivers.academyId, academyId), eq(waivers.status, 'signed')))
      .all();
    const latest = new Map<string, (typeof signed)[number]>();
    for (const waiver of signed.sort((a, b) => b.signedAt.localeCompare(a.signedAt))) {
      if (!latest.has(waiver.userId)) latest.set(waiver.userId, waiver);
    }
    const now = Date.now();
    const rows: ReportRow[] = [];
    for (const member of members) {
      const waiver = latest.get(member.id);
      const status = !waiver
        ? 'Missing'
        : !waiver.expiresAt
          ? 'Signed'
          : new Date(waiver.expiresAt).getTime() < now
            ? 'Expired'
            : new Date(waiver.expiresAt).getTime() - now <= 30 * 86_400_000
              ? 'Expiring soon'
              : 'Signed';
      if (status === 'Signed') continue;
      rows.push({
        member: `${member.firstName} ${member.lastName}`.trim(),
        status,
        waiverType: waiver?.waiverType ?? 'general',
        signedAt: waiver?.signedAt.slice(0, 10) ?? '—',
        expiresAt: waiver?.expiresAt?.slice(0, 10) ?? '—',
        action: status === 'Missing' ? 'Collect signed waiver before next class' : 'Send renewal link',
        link: `/admin/analytics/member/${member.id}`,
      });
    }
    // Trial guests who attended but have no member account still need a waiver.
    const memberEmails = new Set(members.map((member) => member.email?.toLowerCase()).filter(Boolean));
    const trialGuests = db
      .select()
      .from(leads)
      .where(and(eq(leads.academyId, academyId), gte(leads.trialAttendedAt, '1900-01-01T00:00:00.000Z')))
      .all()
      .filter((lead) => !memberEmails.has(lead.email?.toLowerCase() ?? ''));
    for (const lead of trialGuests) {
      rows.push({
        member: `${lead.firstName} ${lead.lastName}`.trim(),
        status: 'Missing (trial guest)',
        waiverType: 'dropin',
        signedAt: '—',
        expiresAt: '—',
        action: 'Collect drop-in waiver before next trial',
        link: '',
      });
    }
    return {
      rows,
      summary: [
        metric('Missing waivers', rows.filter((row) => String(row.status).startsWith('Missing')).length, undefined, 'warn'),
        metric('Expired', rows.filter((row) => row.status === 'Expired').length, undefined, 'warn'),
        metric('Expiring soon', rows.filter((row) => row.status === 'Expiring soon').length),
        metric('Active members checked', members.length),
      ],
    };
  },

  'incident-log': ({ db, academyId, query, window }) => {
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 365 * 86_400_000);
    const rowsRaw = db
      .select({
        id: incidents.id,
        occurredAt: incidents.occurredAt,
        type: incidents.type,
        severity: incidents.severity,
        location: incidents.location,
        description: incidents.description,
        actionTaken: incidents.actionTaken,
        witnessName: incidents.witnessName,
        followUpRequired: incidents.followUpRequired,
        followUpCompletedAt: incidents.followUpCompletedAt,
        status: incidents.status,
        memberName: sql<string>`trim(coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, ''))`,
      })
      .from(incidents)
      .leftJoin(users, eq(users.id, incidents.userId))
      .where(
        and(
          eq(incidents.academyId, academyId),
          gte(incidents.occurredAt, from.toISOString()),
          lte(incidents.occurredAt, window.to.toISOString()),
        ),
      )
      .orderBy(desc(incidents.occurredAt))
      .all();
    const rows: ReportRow[] = rowsRaw.map((row) => ({
      date: row.occurredAt.slice(0, 10),
      member: row.memberName || 'Visitor / staff',
      type: titleCase(row.type),
      severity: titleCase(row.severity),
      location: row.location ?? '—',
      description: row.description,
      witness: row.witnessName ?? '—',
      actionTaken: row.actionTaken ?? '—',
      followUp: row.followUpRequired
        ? row.followUpCompletedAt
          ? 'Completed'
          : 'Outstanding'
        : 'Not required',
      status: titleCase(row.status),
    }));
    return {
      rows,
      summary: [
        metric('Incidents', rows.length),
        metric('Open', rowsRaw.filter((row) => row.status !== 'closed').length, undefined, 'warn'),
        metric('Follow-ups outstanding', rowsRaw.filter((row) => row.followUpRequired && !row.followUpCompletedAt).length),
        metric('Severe', rowsRaw.filter((row) => row.severity === 'severe').length),
      ],
    };
  },
};

/** SQLite-safe upper bound without importing a second comparison helper. */
function ltDayEnd(column: AnyColumn, value: string) {
  return lte(column, value);
}
