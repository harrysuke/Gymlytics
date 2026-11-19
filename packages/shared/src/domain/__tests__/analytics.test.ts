import { describe, expect, it } from 'vitest';
import {
  alertRisk,
  buildCohorts,
  checkInRisk,
  daysBetween,
  groupCount,
  median,
  monthKey,
  monthRange,
  percent,
  projectCashFlow,
  tenureBucket,
} from '../analytics';

describe('analytics primitives', () => {
  it('computes percentages safely', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 0)).toBe(0);
  });

  it('counts whole days between ISO timestamps', () => {
    expect(daysBetween('2026-01-01T12:00:00.000Z', '2026-01-15T12:00:00.000Z')).toBe(14);
    expect(daysBetween('2026-01-15T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(0);
  });

  it('expands inclusive month ranges across year boundaries', () => {
    expect(monthRange('2026-11-20T00:00:00.000Z', '2027-01-05T00:00:00.000Z')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(monthKey('2026-03-31T23:00:00.000Z')).toBe('2026-03');
  });

  it('calculates a median without mutating the input', () => {
    const values = [5, 1, 3];
    expect(median(values)).toBe(3);
    expect(values).toEqual([5, 1, 3]);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('groups rows into sorted label/value buckets', () => {
    expect(groupCount(['gi', 'gi', 'nogi'], (value) => value)).toEqual([
      { label: 'gi', value: 2 },
      { label: 'nogi', value: 1 },
    ]);
  });

  it('maps check-in gaps onto risk levels', () => {
    expect(checkInRisk(3)).toBe('healthy');
    expect(checkInRisk(10)).toBe('watch');
    expect(checkInRisk(20)).toBe('at_risk');
    expect(checkInRisk(45)).toBe('critical');
    expect(checkInRisk(null)).toBe('critical');
    expect(alertRisk(10)).toBe('watch');
  });

  it('labels tenure buckets at the boundaries used by drop-off analysis', () => {
    expect(tenureBucket(15)).toBe('0-30 days');
    expect(tenureBucket(60)).toBe('31-90 days');
    expect(tenureBucket(150)).toBe('3-6 months');
    expect(tenureBucket(900)).toBe('2+ years');
  });
});

describe('buildCohorts', () => {
  it('measures retention by calendar month after signup', () => {
    const signups = [
      { userId: 'a', at: '2026-01-05T10:00:00.000Z' },
      { userId: 'b', at: '2026-01-20T10:00:00.000Z' },
      { userId: 'c', at: '2026-02-02T10:00:00.000Z' },
    ];
    const activity = [
      { userId: 'a', at: '2026-02-10T10:00:00.000Z' },
      { userId: 'a', at: '2026-03-10T10:00:00.000Z' },
      { userId: 'b', at: '2026-04-10T10:00:00.000Z' },
      { userId: 'c', at: '2026-03-02T10:00:00.000Z' },
    ];
    const cohorts = buildCohorts(signups, activity, new Date('2026-06-01T00:00:00.000Z'));
    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]).toMatchObject({ cohort: '2026-01', size: 2, month1: 50, month2: 50 });
    expect(cohorts[0]!.month3).toBe(50);
    expect(cohorts[1]).toMatchObject({ cohort: '2026-02', month1: 100 });
  });

  it('does not count activity in a window that has not happened yet', () => {
    const cohorts = buildCohorts(
      [{ userId: 'a', at: '2026-05-05T10:00:00.000Z' }],
      [{ userId: 'a', at: '2026-06-05T10:00:00.000Z' }],
      new Date('2026-05-20T00:00:00.000Z'),
    );
    expect(cohorts[0]!.month1).toBe(0);
  });
});

describe('projectCashFlow', () => {
  it('projects monthly flow and a cumulative balance', () => {
    const rows = projectCashFlow(20_000, 12_000, 3, 0.1);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.value).toBe(8_000);
    expect(rows[1]!.value).toBe(10_000);
    expect(rows[2]!.cumulative).toBe(30_200);
  });
});
