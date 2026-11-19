/**
 * Pure analytics math. Shared by the API (which aggregates database rows) and
 * any client that needs to re-derive a displayed rate, so the numbers on a
 * chart and in a report footnote can never disagree.
 */

const DAY_MS = 86_400_000;

/** Percentage rounded to one decimal, with a safe zero denominator. */
export function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function daysBetween(from: string | Date, to: string | Date = new Date()): number {
  const a = typeof from === 'string' ? new Date(from).getTime() : from.getTime();
  const b = typeof to === 'string' ? new Date(to).getTime() : to.getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / DAY_MS));
}

export function monthKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Inclusive list of `YYYY-MM` keys between two instants. */
export function monthRange(from: string | Date, to: string | Date): string[] {
  const start = typeof from === 'string' ? new Date(from) : new Date(from.getTime());
  const end = typeof to === 'string' ? new Date(to) : new Date(to.getTime());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return [];
  start.setUTCDate(1);
  end.setUTCDate(1);
  const keys: string[] = [];
  while (start <= end) {
    keys.push(monthKey(start));
    start.setUTCMonth(start.getUTCMonth() + 1);
  }
  return keys;
}

export function addMonths(value: Date, months: number): Date {
  const copy = new Date(value.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

export function average(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Group arbitrary rows into `{ label, value }` buckets, sorted by count desc. */
export function groupCount<T>(rows: T[], keyOf: (row: T) => string): Array<{ label: string; value: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyOf(row) || 'Unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export type RiskLevel = 'healthy' | 'watch' | 'at_risk' | 'critical';

/** Attendance-based risk thresholds used by MIA alerts and member drilldowns. */
export function checkInRisk(daysSinceCheckIn: number | null): RiskLevel {
  if (daysSinceCheckIn === null) return 'critical';
  if (daysSinceCheckIn >= 30) return 'critical';
  if (daysSinceCheckIn >= 14) return 'at_risk';
  if (daysSinceCheckIn >= 7) return 'watch';
  return 'healthy';
}

/** Alert-level variant without the healthy bucket (used by staff reports). */
export function alertRisk(daysSinceCheckIn: number): 'watch' | 'at_risk' | 'critical' {
  if (daysSinceCheckIn >= 30) return 'critical';
  if (daysSinceCheckIn >= 14) return 'at_risk';
  return 'watch';
}

export function tenureBucket(days: number): string {
  if (days < 30) return '0-30 days';
  if (days < 90) return '31-90 days';
  if (days < 180) return '3-6 months';
  if (days < 365) return '6-12 months';
  if (days < 730) return '1-2 years';
  return '2+ years';
}

export interface CohortRow {
  cohort: string;
  size: number;
  month1: number;
  month2: number;
  month3: number;
}

/**
 * Simple month-cohort retention. A member is "retained" in month N when they
 * have at least one activity event in the calendar month N after joining.
 * Incomplete future windows score zero rather than being silently omitted.
 */
export function buildCohorts(
  signups: Array<{ userId: string; at: string }>,
  activity: Array<{ userId: string; at: string }>,
  asOf: Date = new Date(),
  months = 3,
): CohortRow[] {
  const buckets = new Map<string, Set<string>>();
  for (const signup of signups) {
    const key = monthKey(signup.at);
    if (!buckets.has(key)) buckets.set(key, new Set());
    buckets.get(key)!.add(signup.userId);
  }

  const activityByUser = new Map<string, Set<string>>();
  for (const event of activity) {
    if (!activityByUser.has(event.userId)) activityByUser.set(event.userId, new Set());
    activityByUser.get(event.userId)!.add(monthKey(event.at));
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cohort, members]) => {
      const start = new Date(`${cohort}-01T00:00:00.000Z`);
      const row: CohortRow = { cohort, size: members.size, month1: 0, month2: 0, month3: 0 };
      for (let index = 1; index <= months; index += 1) {
        const window = monthKey(addMonths(start, index));
        if (new Date(`${window}-01T00:00:00.000Z`) > asOf) continue;
        let retained = 0;
        for (const userId of members) {
          if (activityByUser.get(userId)?.has(window)) retained += 1;
        }
        row[`month${index}` as 'month1' | 'month2' | 'month3'] = percent(retained, members.size);
      }
      return row;
    });
}

/**
 * Forward cash-flow projection: monthly net flow plus a cumulative balance.
 * `monthlyIn` and `monthlyOut` are current run rates; `growth` is a fraction
 * (e.g. 0.02 for 2% monthly income growth).
 */
export function projectCashFlow(
  monthlyIn: number,
  monthlyOut: number,
  months = 3,
  growth = 0,
): Array<{ label: string; value: number; cumulative: number }> {
  let cumulative = 0;
  return Array.from({ length: months }, (_, index) => {
    const flow = Math.round(monthlyIn * (1 + growth) ** index - monthlyOut);
    cumulative += flow;
    const label = new Date();
    label.setUTCMonth(label.getUTCMonth() + index + 1);
    return {
      label: monthKey(label),
      value: flow,
      cumulative,
    };
  });
}

/** Divide a value into equal buckets for a trend chart. */
export function emptySeries(keys: string[]): Array<{ label: string; value: number }> {
  return keys.map((label) => ({ label, value: 0 }));
}
