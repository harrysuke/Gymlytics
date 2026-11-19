import { describe, expect, it } from 'vitest';
import { DUNNING_SCHEDULE_DAYS } from '@gymlytics/shared';
import {
  DUNNING_MAX_ATTEMPTS,
  nextRetryAt,
  shouldCancelMembership,
  shouldMarkPastDue,
} from '../dunning';

const FAILED_AT = new Date('2026-03-01T14:37:22.000Z');

describe('nextRetryAt', () => {
  it('schedules each attempt from the shared dunning ladder', () => {
    const days = DUNNING_SCHEDULE_DAYS.map((_, index) => nextRetryAt(index + 1, FAILED_AT)?.getUTCDate());
    expect(days).toEqual([2, 4, 6, 8, 13]);
  });

  it('retries on the next business-hour boundary, not at the failure timestamp', () => {
    const next = nextRetryAt(1, FAILED_AT);
    expect(next?.toISOString()).toBe('2026-03-02T09:00:00.000Z');
  });

  it('returns null once the ladder is exhausted', () => {
    expect(nextRetryAt(DUNNING_MAX_ATTEMPTS, FAILED_AT)).not.toBeNull();
    expect(nextRetryAt(DUNNING_MAX_ATTEMPTS + 1, FAILED_AT)).toBeNull();
  });

  it('honours a custom schedule', () => {
    const next = nextRetryAt(2, FAILED_AT, [1, 2]);
    expect(next?.toISOString()).toBe('2026-03-03T09:00:00.000Z');
  });
});

describe('dunning escalation', () => {
  it('marks the membership past_due from the very first failure', () => {
    expect(shouldMarkPastDue(1)).toBe(true);
    expect(shouldMarkPastDue(0)).toBe(false);
  });

  it('cancels only after the whole ladder has failed', () => {
    expect(shouldCancelMembership(DUNNING_MAX_ATTEMPTS)).toBe(false);
    expect(shouldCancelMembership(DUNNING_MAX_ATTEMPTS + 1)).toBe(true);
  });

  it('exposes the ladder length', () => {
    expect(DUNNING_MAX_ATTEMPTS).toBe(5);
  });
});
