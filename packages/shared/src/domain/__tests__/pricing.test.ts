import { describe, expect, it } from 'vitest';
import { calculateFamilyTotal, calculateSale, prorateCents } from '../pricing';

describe('calculateFamilyTotal', () => {
  it('discounts only the additional seats, never the subscriber', () => {
    // RM200 base, 20% family discount, 2 extra dependents:
    // 200 + 2 * (200 * 0.8) = 520, not 600.
    expect(calculateFamilyTotal(20_000, 20, 2, 4)).toBe(52_000);
  });

  it('charges the subscriber full price when there are no dependents', () => {
    expect(calculateFamilyTotal(20_000, 20, 0, 4)).toBe(20_000);
  });

  it('caps dependents at the plan maximum', () => {
    expect(calculateFamilyTotal(20_000, 20, 10, 4)).toBe(20_000 + 4 * 16_000);
  });

  it('treats a negative dependent count as zero', () => {
    expect(calculateFamilyTotal(20_000, 20, -3, 4)).toBe(20_000);
  });

  it('rounds a fractional discounted seat to whole cents', () => {
    // 1000 * 0.85 = 850 exactly, but 999 * 0.85 = 849.15 -> 849
    expect(calculateFamilyTotal(999, 15, 1, 4)).toBe(999 + 849);
  });
});

describe('calculateSale', () => {
  it('sums lines, applies an order discount, then tax-exclusive tax', () => {
    const result = calculateSale({
      lines: [
        { unitPriceCents: 1_000, quantity: 2 },
        { unitPriceCents: 500, quantity: 1 },
      ],
      discountCents: 500,
      taxRateBps: 600, // 6%
      currency: 'MYR',
    });

    expect(result.subtotalCents).toBe(2_500);
    expect(result.discountCents).toBe(500);
    expect(result.taxCents).toBe(120); // 6% of 2000
    expect(result.totalCents).toBe(2_120);
    expect(result.effectiveDiscountPercent).toBe(20);
  });

  it('backs tax out of the total when the price is tax-inclusive', () => {
    const result = calculateSale({
      lines: [{ unitPriceCents: 2_000, quantity: 1 }],
      taxRateBps: 600,
      taxInclusive: true,
      currency: 'MYR',
    });

    expect(result.taxCents).toBe(113); // 2000 - round(2000 / 1.06)
    expect(result.totalCents).toBe(2_000);
  });

  it('never discounts more than the subtotal', () => {
    const result = calculateSale({
      lines: [{ unitPriceCents: 1_000, quantity: 1 }],
      discountCents: 5_000,
      currency: 'MYR',
    });

    expect(result.discountCents).toBe(1_000);
    expect(result.totalCents).toBe(0);
    expect(result.effectiveDiscountPercent).toBe(100);
  });

  it('reports a zero discount percentage on an empty cart', () => {
    const result = calculateSale({ lines: [], currency: 'MYR' });
    expect(result.subtotalCents).toBe(0);
    expect(result.totalCents).toBe(0);
    expect(result.effectiveDiscountPercent).toBe(0);
  });
});

describe('prorateCents', () => {
  it('charges the difference for the remaining days of the cycle', () => {
    // Upgrade RM100 -> RM200 with 15 of 30 days left: 100 * 0.5
    expect(prorateCents(10_000, 20_000, 15, 30)).toBe(5_000);
  });

  it('charges nothing for a downgrade', () => {
    expect(prorateCents(20_000, 10_000, 15, 30)).toBe(0);
  });

  it('clamps days remaining to the period length', () => {
    expect(prorateCents(10_000, 20_000, 90, 30)).toBe(10_000);
  });

  it('charges nothing when no days remain', () => {
    expect(prorateCents(10_000, 20_000, 0, 30)).toBe(0);
  });
});
