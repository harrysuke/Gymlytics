import type { PriceBreakdown } from '../schemas/billing';

export interface SaleLine {
  unitPriceCents: number;
  quantity: number;
}

/**
 * Family plans discount the SUBSCRIBER's seat, not each child at full price.
 * e.g. base RM200, 20% family discount, 2 additional dependents:
 *      200 + 2 * (200 * 0.8) = 520 (instead of 600).
 */
export function calculateFamilyTotal(
  baseCents: number,
  discountPercent: number,
  additionalDependents: number,
  maxDependents: number,
): number {
  const covered = Math.max(0, Math.min(additionalDependents, maxDependents));
  const discountedSeat = Math.round(baseCents * (1 - discountPercent / 100));
  return baseCents + covered * discountedSeat;
}

export function calculateSale(input: {
  lines: SaleLine[];
  discountCents?: number;
  taxRateBps?: number;
  taxInclusive?: boolean;
  currency: string;
  familyDiscountPercent?: number;
}): PriceBreakdown {
  const subtotalCents = input.lines.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0,
  );
  const discountCents = Math.min(input.discountCents ?? 0, subtotalCents);
  const taxable = subtotalCents - discountCents;
  const rate = (input.taxRateBps ?? 0) / 10_000;

  const taxCents = input.taxInclusive
    ? taxable - Math.round(taxable / (1 + rate))
    : Math.round(taxable * rate);
  const totalCents = input.taxInclusive ? taxable : taxable + taxCents;

  return {
    subtotalCents,
    discountCents,
    taxCents,
    totalCents,
    currency: input.currency,
    effectiveDiscountPercent: subtotalCents === 0 ? 0 : Math.round((discountCents / subtotalCents) * 100),
  };
}

/** Prorated charge when someone upgrades mid-cycle. */
export function prorateCents(
  oldMonthlyCents: number,
  newMonthlyCents: number,
  daysLeftInPeriod: number,
  daysInPeriod = 30,
): number {
  const ratio = Math.max(0, Math.min(1, daysLeftInPeriod / daysInPeriod));
  return Math.max(0, Math.round((newMonthlyCents - oldMonthlyCents) * ratio));
}
