import { DUNNING_SCHEDULE_DAYS } from '@gymlytics/shared';

/**
 * Failed-renewal retry policy. The cron job queries payment_retries for
 * `status='scheduled' AND scheduled_at <= now`, charges the card on file,
 * and writes the next attempt from this pure function.
 *
 * Hard declines (insufficient funds, stolen card) still get one soft retry:
 * banks sometimes recover within 24h, and the cost of one extra attempt is
 * far lower than an involuntary churn.
 */
export function nextRetryAt(
  attemptNumber: number,
  failedAt: Date = new Date(),
  schedule: readonly number[] = DUNNING_SCHEDULE_DAYS,
): Date | null {
  const offset = schedule[attemptNumber - 1];
  if (offset === undefined) return null;
  const next = new Date(failedAt);
  next.setUTCDate(next.getUTCDate() + offset);
  next.setUTCHours(9, 0, 0, 0); // business hours in academy timezone
  return next;
}

export function shouldMarkPastDue(attemptNumber: number): boolean {
  return attemptNumber >= 1;
}

export function shouldCancelMembership(attemptNumber: number): boolean {
  return attemptNumber > DUNNING_SCHEDULE_DAYS.length;
}

export const DUNNING_MAX_ATTEMPTS = DUNNING_SCHEDULE_DAYS.length;
