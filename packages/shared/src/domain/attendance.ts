export interface AttendanceFact {
  checkedInAt: string;
  checkedOutAt?: string | null;
  status?: string;
  classDurationMinutes?: number;
}

/**
 * Mat hours are derived, never stored as a mutable counter. A missing
 * check-out uses the scheduled class duration so a forgotten scan-out does
 * not erase a training session — but never more than the class length.
 */
export function computeMatMinutes(logs: readonly AttendanceFact[]): number {
  return logs.reduce((total, log) => {
    if (log.status && log.status !== 'checked_in' && log.status !== 'checked_out') return total;
    if (log.checkedOutAt) {
      const minutes = (Date.parse(log.checkedOutAt) - Date.parse(log.checkedInAt)) / 60_000;
      if (Number.isFinite(minutes) && minutes > 0) return total + Math.min(minutes, 240);
    }
    return total + (log.classDurationMinutes ?? 90);
  }, 0);
}

export function computeMatHours(logs: readonly AttendanceFact[]): number {
  return Math.round(computeMatMinutes(logs) / 60);
}

/** Consecutive ISO weeks with at least one attendance, counting back from now. */
export function computeWeeklyStreak(logs: readonly AttendanceFact[], now = new Date()): number {
  const weeks = new Set<string>();
  for (const log of logs) {
    const date = new Date(log.checkedInAt);
    if (Number.isNaN(date.getTime())) continue;
    weeks.add(isoWeekKey(date));
  }

  let streak = 0;
  const cursor = new Date(now);
  for (;;) {
    const key = isoWeekKey(cursor);
    if (!weeks.has(key)) {
      // The current week is allowed to be empty until it ends.
      if (streak === 0 && key === isoWeekKey(now)) {
        cursor.setUTCDate(cursor.getUTCDate() - 7);
        continue;
      }
      break;
    }
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return streak;
}

export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
