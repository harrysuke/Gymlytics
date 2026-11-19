import { describe, expect, it } from 'vitest';
import {
  evaluatePromotionEligibility,
  monthsBetween,
  type EligibilityInput,
  type RankConfig,
} from '../promotion';

const WHITE: RankConfig = {
  slug: 'white',
  orderIndex: 0,
  maxStripes: 4,
  minMonthsInRank: 3,
  minClassesInRank: 30,
  minMatHours: 40,
};

const BLUE: RankConfig = {
  slug: 'blue',
  orderIndex: 1,
  maxStripes: 4,
  minMonthsInRank: 24,
  minClassesInRank: 200,
  minMatHours: 300,
};

const PROMOTED = '2026-01-01T00:00:00.000Z';

function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    rank: WHITE,
    currentStripes: 0,
    promotedAt: PROMOTED,
    classesSincePromotion: 0,
    matHoursSincePromotion: 0,
    techniquesRequired: 0,
    techniquesCompleted: 0,
    nextRank: BLUE,
    now: new Date('2026-02-01T00:00:00.000Z'), // exactly one month in rank
    ...overrides,
  };
}

describe('monthsBetween', () => {
  it('counts whole months', () => {
    expect(monthsBetween('2026-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z')).toBe(3);
  });

  it('does not count a month that has not completed yet', () => {
    expect(monthsBetween('2026-01-15T00:00:00.000Z', '2026-02-14T00:00:00.000Z')).toBe(0);
    expect(monthsBetween('2026-01-15T00:00:00.000Z', '2026-02-15T00:00:00.000Z')).toBe(1);
  });

  it('never returns a negative value for a future promotion date', () => {
    expect(monthsBetween('2026-06-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')).toBe(0);
  });
});

describe('evaluatePromotionEligibility — stripes', () => {
  it('awards the first stripe once a quarter of the rank is served', () => {
    // 3 months / 4 stripes = 0.75 months and 7.5 classes per stripe.
    const result = evaluatePromotionEligibility(input({ classesSincePromotion: 8 }));
    expect(result.stripeEligible).toBe(true);
    expect(result.suggestedAction).toBe('stripe');
    expect(result.monthsInRank).toBe(1);
  });

  it('withholds the stripe when class volume lags behind time', () => {
    const result = evaluatePromotionEligibility(input({ classesSincePromotion: 4 }));
    expect(result.stripeEligible).toBe(false);
    expect(result.suggestedAction).toBeNull();
    expect(result.missing).toContain('4 more classes');
  });

  it('withholds the stripe when time lags behind class volume', () => {
    const result = evaluatePromotionEligibility(
      input({ classesSincePromotion: 40, now: new Date('2026-01-01T00:00:00.000Z') }),
    );
    expect(result.stripeEligible).toBe(false);
    expect(result.missing[0]).toMatch(/more months in rank$/);
  });

  it('never awards more stripes than the rank allows', () => {
    const result = evaluatePromotionEligibility(
      input({ currentStripes: 4, classesSincePromotion: 500, now: new Date('2026-12-01T00:00:00.000Z') }),
    );
    expect(result.stripeEligible).toBe(false);
  });
});

describe('evaluatePromotionEligibility — belt', () => {
  it('requires every gate before a belt is offered', () => {
    const result = evaluatePromotionEligibility(
      input({
        currentStripes: 4,
        classesSincePromotion: 30,
        matHoursSincePromotion: 40,
        now: new Date('2026-04-01T00:00:00.000Z'), // 3 months
      }),
    );
    expect(result.beltEligible).toBe(true);
    expect(result.suggestedAction).toBe('belt');
  });

  it('makes stripe and belt eligibility mutually exclusive by construction', () => {
    // A stripe requires currentStripes < maxStripes; a belt requires the full
    // stripe set. The engine can never suggest both at once.
    const atFourStripes = evaluatePromotionEligibility(
      input({
        currentStripes: 4,
        classesSincePromotion: 30,
        matHoursSincePromotion: 40,
        now: new Date('2026-04-01T00:00:00.000Z'),
      }),
    );
    expect(atFourStripes.stripeEligible).toBe(false);
    expect(atFourStripes.suggestedAction).toBe('belt');
  });

  it('blocks the belt on missing curriculum techniques', () => {
    const result = evaluatePromotionEligibility(
      input({
        currentStripes: 4,
        classesSincePromotion: 30,
        matHoursSincePromotion: 40,
        techniquesRequired: 5,
        techniquesCompleted: 2,
        now: new Date('2026-04-01T00:00:00.000Z'),
      }),
    );
    expect(result.beltEligible).toBe(false);
    expect(result.missing).toContain('3 curriculum techniques');
  });

  it('blocks the belt on missing mat hours', () => {
    const result = evaluatePromotionEligibility(
      input({
        currentStripes: 4,
        classesSincePromotion: 30,
        matHoursSincePromotion: 25,
        now: new Date('2026-04-01T00:00:00.000Z'),
      }),
    );
    expect(result.beltEligible).toBe(false);
    expect(result.missing).toContain('15 more mat hours');
  });

  it('never offers a belt when there is no next rank', () => {
    const result = evaluatePromotionEligibility(
      input({
        nextRank: null,
        currentStripes: 4,
        classesSincePromotion: 300,
        matHoursSincePromotion: 400,
        now: new Date('2026-12-01T00:00:00.000Z'),
      }),
    );
    expect(result.beltEligible).toBe(false);
  });

  it('falls back to the shared default when a rank has no minimum set', () => {
    const result = evaluatePromotionEligibility(
      input({ rank: { ...WHITE, minMonthsInRank: 0 }, classesSincePromotion: 8 }),
    );
    // DEFAULT_MIN_MONTHS_IN_RANK.white === 3, so the stripe math is unchanged.
    expect(result.stripeEligible).toBe(true);
  });
});
