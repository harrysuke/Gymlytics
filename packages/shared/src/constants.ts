/** Canonical constants shared by API, Vue web and Expo mobile. */

export const DISCIPLINE_LABELS = {
  gi_bjj: 'Gi Brazilian Jiu-Jitsu',
  nogi_bjj: 'No-Gi Brazilian Jiu-Jitsu',
  kids_bjj: 'Kids BJJ',
  muay_thai: 'Muay Thai',
  wrestling: 'Wrestling',
  judo: 'Judo',
  kyokushin_karate: 'Kyokushin Karate',
  mma: 'MMA',
  custom: 'Custom Program',
} as const;

export type Discipline = keyof typeof DISCIPLINE_LABELS;

export const IBJJF_ADULT_BELTS = [
  { slug: 'white', name: 'White', color: '#FFFFFF', order: 0 },
  { slug: 'blue', name: 'Blue', color: '#1D4ED8', order: 1 },
  { slug: 'purple', name: 'Purple', color: '#7E22CE', order: 2 },
  { slug: 'brown', name: 'Brown', color: '#92400E', order: 3 },
  { slug: 'black', name: 'Black', color: '#111827', order: 4 },
  { slug: 'red_white', name: 'Red & White', color: '#DC2626', order: 5 },
  { slug: 'red', name: 'Red', color: '#B91C1C', order: 6 },
] as const;

export const IBJJF_KIDS_BELTS = [
  { slug: 'white', name: 'White', color: '#FFFFFF', order: 0 },
  { slug: 'yellow', name: 'Yellow', color: '#FACC15', order: 1 },
  { slug: 'orange', name: 'Orange', color: '#EA580C', order: 2 },
  { slug: 'green', name: 'Green', color: '#16A34A', order: 3 },
] as const;

export const SUPPORTED_CURRENCIES = ['MYR', 'USD', 'SGD', 'THB', 'IDR', 'PHP', 'EUR', 'GBP', 'AUD'] as const;

/** Dunning schedule — retry offsets in days after the initial failure. */
export const DUNNING_SCHEDULE_DAYS = [1, 3, 5, 7, 12] as const;

/** Time in rank defaults (months) keyed by belt slug. Overridden per-academy. */
export const DEFAULT_MIN_MONTHS_IN_RANK: Record<string, number> = {
  white: 3,
  blue: 24,
  purple: 24,
  brown: 18,
  black: 0,
  yellow: 3,
  orange: 6,
  green: 9,
};

export const CHECK_IN_METHODS = ['pin', 'qr', 'name_search', 'admin', 'mobile', 'guardian'] as const;
export const PAYMENT_PROVIDERS = ['stripe', 'billplz', 'ipay88', 'manual'] as const;

/** Stable feature keys used by subscription plans and the API gate. */
export const SAAS_FEATURES = [
  'members',
  'schedule',
  'attendance',
  'billing',
  'waivers',
  'automated_marketing',
  'csv_import',
  'widgets',
  'curriculum_video',
  'cross_training',
  'advanced_analytics',
  'multi_site',
] as const;
export type SaasFeature = (typeof SAAS_FEATURES)[number];

/** Default entitlement by plan slug. Stored plan rows can override this map. */
export const PLAN_FEATURE_DEFAULTS: Record<string, readonly SaasFeature[]> = {
  starter: ['members', 'schedule', 'attendance', 'billing', 'waivers'],
  growth: [
    'members', 'schedule', 'attendance', 'billing', 'waivers',
    'automated_marketing', 'csv_import', 'widgets', 'curriculum_video',
    'cross_training', 'advanced_analytics',
  ],
  network: [
    'members', 'schedule', 'attendance', 'billing', 'waivers',
    'automated_marketing', 'csv_import', 'widgets', 'curriculum_video',
    'cross_training', 'advanced_analytics', 'multi_site',
  ],
};

export const ONBOARDING_STEP_ORDER = [
  'profile', 'locations', 'programs', 'members', 'billing', 'team',
] as const;
