import { describe, expect, it } from 'vitest';
import { computeMatHours, computeMatMinutes, computeWeeklyStreak, isoWeekKey } from '../attendance';

function session(startIso: string, minutes: number, extra: Record<string, unknown> = {}) {
  return {
    checkedInAt: startIso,
    checkedOutAt: new Date(Date.parse(startIso) + minutes * 60_000).toISOString(),
    status: 'checked_out',
    ...extra,
  };
}

describe('computeMatMinutes', () => {
  it('uses the real scan-out delta when both scans exist', () => {
    expect(computeMatMinutes([session('2026-03-01T18:00:00.000Z', 75)])).toBe(75);
  });

  it('falls back to the scheduled class length when the scan-out was forgotten', () => {
    const forgotten = {
      checkedInAt: '2026-03-01T18:00:00.000Z',
      checkedOutAt: null,
      status: 'checked_in',
      classDurationMinutes: 60,
    };
    expect(computeMatMinutes([forgotten])).toBe(60);
  });

  it('defaults to 90 minutes when the class length is unknown', () => {
    expect(computeMatMinutes([{ checkedInAt: '2026-03-01T18:00:00.000Z' }])).toBe(90);
  });

  it('caps an absurd scan-out delta at four hours', () => {
    // Someone scanned in and the tablet was not touched for two days.
    expect(computeMatMinutes([session('2026-03-01T18:00:00.000Z', 2_880)])).toBe(240);
  });

  it('ignores rows that are not a completed attendance fact', () => {
    const rows = [
      session('2026-03-01T18:00:00.000Z', 60),
      { checkedInAt: '2026-03-02T18:00:00.000Z', status: 'no_show', classDurationMinutes: 90 },
      { checkedInAt: '2026-03-03T18:00:00.000Z', status: 'cancelled', classDurationMinutes: 90 },
    ];
    expect(computeMatMinutes(rows)).toBe(60);
  });

  it('sums across sessions', () => {
    expect(
      computeMatMinutes([session('2026-03-01T18:00:00.000Z', 60), session('2026-03-02T18:00:00.000Z', 90)]),
    ).toBe(150);
  });
});

describe('computeMatHours', () => {
  it('rounds to whole hours', () => {
    expect(computeMatHours([session('2026-03-01T18:00:00.000Z', 150)])).toBe(3);
  });

  it('returns zero for an empty history', () => {
    expect(computeMatHours([])).toBe(0);
  });
});

describe('isoWeekKey', () => {
  it('places 1 January 2026 (a Thursday) in week 01', () => {
    expect(isoWeekKey(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-W01');
  });

  it('groups Sunday with the week that started on the previous Monday', () => {
    const saturday = isoWeekKey(new Date('2026-03-14T00:00:00.000Z'));
    const sunday = isoWeekKey(new Date('2026-03-15T00:00:00.000Z'));
    const monday = isoWeekKey(new Date('2026-03-09T00:00:00.000Z'));
    expect(sunday).toBe(monday);
    expect(saturday).toBe(monday);
  });

  it('starts a new week on Monday', () => {
    const sunday = isoWeekKey(new Date('2026-03-15T00:00:00.000Z'));
    const nextMonday = isoWeekKey(new Date('2026-03-16T00:00:00.000Z'));
    expect(nextMonday).not.toBe(sunday);
  });
});

describe('computeWeeklyStreak', () => {
  const now = new Date('2026-03-15T12:00:00.000Z'); // Sunday

  it('counts consecutive weeks ending this week', () => {
    const logs = [
      { checkedInAt: '2026-03-10T18:00:00.000Z' },
      { checkedInAt: '2026-03-03T18:00:00.000Z' },
      { checkedInAt: '2026-02-24T18:00:00.000Z' },
    ];
    expect(computeWeeklyStreak(logs, now)).toBe(3);
  });

  it('counts a week only once no matter how many classes it holds', () => {
    const logs = [
      { checkedInAt: '2026-03-10T18:00:00.000Z' },
      { checkedInAt: '2026-03-11T18:00:00.000Z' },
      { checkedInAt: '2026-03-12T18:00:00.000Z' },
    ];
    expect(computeWeeklyStreak(logs, now)).toBe(1);
  });

  it('tolerates an empty current week but not an empty previous week', () => {
    const skippedThisWeek = [
      { checkedInAt: '2026-03-03T18:00:00.000Z' },
      { checkedInAt: '2026-02-24T18:00:00.000Z' },
    ];
    expect(computeWeeklyStreak(skippedThisWeek, now)).toBe(2);

    const missedLastWeek = [
      { checkedInAt: '2026-03-10T18:00:00.000Z' },
      { checkedInAt: '2026-02-24T18:00:00.000Z' },
    ];
    expect(computeWeeklyStreak(missedLastWeek, now)).toBe(1);
  });

  it('returns zero with no history', () => {
    expect(computeWeeklyStreak([], now)).toBe(0);
  });

  it('ignores unparseable timestamps instead of throwing', () => {
    expect(computeWeeklyStreak([{ checkedInAt: 'not-a-date' }], now)).toBe(0);
  });
});
