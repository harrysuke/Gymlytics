/** Presentation helpers. Money is always minor units on the wire. */

const CURRENCY_SYMBOLS: Record<string, string> = { MYR: 'RM', USD: '$', SGD: 'S$', EUR: '€', GBP: '£' };

export function money(cents: number | null | undefined, currency = 'MYR'): string {
  if (cents === null || cents === undefined) return '—';
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function compactMoney(cents: number, currency = 'MYR'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '';
  const value = cents / 100;
  if (Math.abs(value) >= 1000) return `${symbol}${(value / 1000).toFixed(1)}k`;
  return `${symbol}${value.toFixed(0)}`;
}

export function time(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${shortDate(iso)} · ${time(iso)}`;
}

export function dayName(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long' });
}

export function weekdayShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return 'just now';
  if (abs < hour) return `${Math.round(abs / minute)}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)}h ${suffix}`;
  if (abs < 30 * day) return `${Math.round(abs / day)}d ${suffix}`;
  return date(iso);
}

export function age(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) years -= 1;
  return years;
}

export function durationMinutes(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
}

export function humanize(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** `YYYY-MM-DD` for a local date, used as `<input type="date">` values. */
export function isoDay(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Monday 00:00 of the week containing `value`. */
export function startOfWeek(value: Date): Date {
  const copy = new Date(value);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - ((day + 6) % 7));
  return copy;
}

export function addDays(value: Date, days: number): Date {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export const STATUS_TONES: Record<string, string> = {
  active: 'green',
  trialing: 'sky',
  past_due: 'amber',
  frozen: 'slate',
  paused: 'slate',
  cancelled: 'rose',
  expired: 'rose',
  pending_payment: 'amber',
  pending_waiver: 'amber',
  signed: 'green',
  succeeded: 'green',
  pending: 'amber',
  failed: 'rose',
  refunded: 'slate',
  inactive: 'slate',
  scheduled: 'sky',
  cancelled_class: 'rose',
  completed: 'slate',
  booked: 'sky',
  checked_in: 'green',
  attended: 'green',
  no_show: 'rose',
  waitlisted: 'amber',
};
