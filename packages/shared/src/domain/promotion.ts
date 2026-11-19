import { DEFAULT_MIN_MONTHS_IN_RANK } from '../constants';

export interface RankConfig {
  slug: string;
  orderIndex: number;
  maxStripes: number;
  minMonthsInRank: number;
  minClassesInRank: number;
  minMatHours: number;
}

export interface EligibilityInput {
  rank: RankConfig;
  currentStripes: number;
  promotedAt: string;
  classesSincePromotion: number;
  matHoursSincePromotion: number;
  techniquesRequired: number;
  techniquesCompleted: number;
  nextRank?: RankConfig | null;
  now?: Date;
}

export interface EligibilityResult {
  eligible: boolean;
  stripeEligible: boolean;
  beltEligible: boolean;
  monthsInRank: number;
  missing: string[];
  suggestedAction: 'stripe' | 'belt' | null;
}

export function monthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() < from.getUTCDate() ? Math.max(0, months - 1) : Math.max(0, months);
}

function effectiveMinMonths(rank: RankConfig): number {
  return rank.minMonthsInRank || DEFAULT_MIN_MONTHS_IN_RANK[rank.slug] || 0;
}

/**
 * Pure eligibility engine — the same function runs in the API (cron alert),
 * the Vue coach dashboard and the Expo progression screen. No I/O here so
 * tests are deterministic and mobile/web can never drift from the server.
 */
export function evaluatePromotionEligibility(input: EligibilityInput): EligibilityResult {
  const now = input.now ?? new Date();
  const monthsInRank = monthsBetween(input.promotedAt, now.toISOString());
  const minMonths = effectiveMinMonths(input.rank);
  const stripeSlots = Math.max(1, input.rank.maxStripes);
  const nextStripe = input.currentStripes + 1;
  const monthsPerStripe = minMonths / stripeSlots;
  const classesPerStripe = input.rank.minClassesInRank / stripeSlots;

  const stripeEligible =
    input.currentStripes < input.rank.maxStripes &&
    monthsInRank >= monthsPerStripe * nextStripe &&
    input.classesSincePromotion >= classesPerStripe * nextStripe;

  const techniquesOk = input.techniquesCompleted >= input.techniquesRequired;
  const beltEligible =
    Boolean(input.nextRank) &&
    input.currentStripes >= input.rank.maxStripes &&
    monthsInRank >= minMonths &&
    input.classesSincePromotion >= input.rank.minClassesInRank &&
    input.matHoursSincePromotion >= input.rank.minMatHours &&
    techniquesOk;

  const missing: string[] = [];
  if (!stripeEligible && input.currentStripes < input.rank.maxStripes) {
    if (monthsInRank < monthsPerStripe * nextStripe) {
      missing.push(`${(monthsPerStripe * nextStripe - monthsInRank).toFixed(1)} more months in rank`);
    }
    if (input.classesSincePromotion < classesPerStripe * nextStripe) {
      missing.push(`${Math.ceil(classesPerStripe * nextStripe - input.classesSincePromotion)} more classes`);
    }
  }
  if (input.nextRank && !beltEligible) {
    if (input.currentStripes < input.rank.maxStripes) {
      missing.push(`${input.rank.maxStripes - input.currentStripes} more stripes`);
    }
    if (monthsInRank < minMonths) missing.push(`${minMonths - monthsInRank} more months`);
    if (input.classesSincePromotion < input.rank.minClassesInRank) {
      missing.push(`${input.rank.minClassesInRank - input.classesSincePromotion} more classes`);
    }
    if (input.matHoursSincePromotion < input.rank.minMatHours) {
      missing.push(`${input.rank.minMatHours - input.matHoursSincePromotion} more mat hours`);
    }
    if (!techniquesOk) {
      missing.push(`${input.techniquesRequired - input.techniquesCompleted} curriculum techniques`);
    }
  }

  return {
    eligible: stripeEligible || beltEligible,
    stripeEligible,
    beltEligible,
    monthsInRank,
    missing,
    suggestedAction: beltEligible ? 'belt' : stripeEligible ? 'stripe' : null,
  };
}
