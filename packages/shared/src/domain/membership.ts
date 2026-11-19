export type PlanType = 'unlimited' | 'weekly_limit' | 'class_pack' | 'dropin_pack' | 'family';
export type MembershipState =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'frozen'
  | 'pending_payment'
  | 'cancelled'
  | 'expired';

export interface PlanRules {
  planType: PlanType;
  classesPerWeek: number | null;
  classPackCount: number | null;
  maxDependents?: number;
}

export interface MembershipContext {
  status: MembershipState;
  currentPeriodEnd: string;
  classesUsedInPeriod: number;
  frozenUntil?: string | null;
  /** Classes already consumed by the guardian's household this week. */
  familyUsageThisWeek?: number;
}

export interface BookingDecision {
  allowed: boolean;
  reason?: 'frozen' | 'past_due' | 'expired' | 'quota' | 'no_entitlement';
  remaining: number;
}

/** Entitlement check used at booking time and again at kiosk check-in. */
export function canBookClass(plan: PlanRules, membership: MembershipContext, now = new Date()): BookingDecision {
  // A freeze is time-boxed: once `frozenUntil` has passed the member is
  // entitled again even if no cron has flipped the stored status back to
  // 'active' yet. Never leave someone locked out because a job was late.
  // An indefinite freeze (no `frozenUntil`) stays closed until staff release it.
  const freezeLifted =
    membership.status === 'frozen' &&
    Boolean(membership.frozenUntil) &&
    new Date(membership.frozenUntil as string) <= now;
  const status = freezeLifted ? 'active' : membership.status;

  if (status === 'frozen') {
    return { allowed: false, reason: 'frozen', remaining: 0 };
  }
  if (status === 'past_due' || status === 'pending_payment') {
    return { allowed: false, reason: 'past_due', remaining: 0 };
  }
  if (status === 'cancelled' || status === 'expired') {
    return { allowed: false, reason: 'expired', remaining: 0 };
  }
  if (new Date(membership.currentPeriodEnd) < now) {
    return { allowed: false, reason: 'expired', remaining: 0 };
  }
  if (status !== 'active' && status !== 'trialing') {
    return { allowed: false, reason: 'no_entitlement', remaining: 0 };
  }

  switch (plan.planType) {
    case 'unlimited':
      return { allowed: true, remaining: Number.MAX_SAFE_INTEGER };
    case 'weekly_limit': {
      const limit = plan.classesPerWeek ?? 0;
      const used = (membership.familyUsageThisWeek ?? 0) + membership.classesUsedInPeriod;
      return used < limit
        ? { allowed: true, remaining: limit - used }
        : { allowed: false, reason: 'quota', remaining: 0 };
    }
    case 'class_pack':
    case 'dropin_pack': {
      const limit = plan.classPackCount ?? 0;
      return membership.classesUsedInPeriod < limit
        ? { allowed: true, remaining: limit - membership.classesUsedInPeriod }
        : { allowed: false, reason: 'quota', remaining: 0 };
    }
    case 'family': {
      const limit = plan.classesPerWeek ?? 0;
      const used = membership.familyUsageThisWeek ?? 0;
      return used < limit
        ? { allowed: true, remaining: limit - used }
        : { allowed: false, reason: 'quota', remaining: 0 };
    }
  }
}

export function computeFreezeWindow(
  requestedDays: number,
  maxDaysPerYear: number,
  alreadyUsedDays: number,
  from = new Date(),
): { start: string; end: string; days: number } {
  const days = Math.max(1, Math.min(requestedDays, maxDaysPerYear - alreadyUsedDays));
  const end = new Date(from);
  end.setUTCDate(end.getUTCDate() + days);
  return { start: from.toISOString(), end: end.toISOString(), days };
}
