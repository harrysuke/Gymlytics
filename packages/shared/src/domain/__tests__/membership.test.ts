import { describe, expect, it } from 'vitest';
import {
  canBookClass,
  computeFreezeWindow,
  type MembershipContext,
  type PlanRules,
} from '../membership';

const NOW = new Date('2026-03-15T12:00:00.000Z');
const FUTURE = '2026-04-15T12:00:00.000Z';
const PAST = '2026-02-15T12:00:00.000Z';

function ctx(overrides: Partial<MembershipContext> = {}): MembershipContext {
  return {
    status: 'active',
    currentPeriodEnd: FUTURE,
    classesUsedInPeriod: 0,
    ...overrides,
  };
}

function plan(overrides: Partial<PlanRules> = {}): PlanRules {
  return {
    planType: 'unlimited',
    classesPerWeek: null,
    classPackCount: null,
    ...overrides,
  };
}

describe('canBookClass — membership state gates', () => {
  it('blocks a member frozen into the future', () => {
    const decision = canBookClass(plan(), ctx({ status: 'frozen', frozenUntil: FUTURE }), NOW);
    expect(decision).toEqual({ allowed: false, reason: 'frozen', remaining: 0 });
  });

  it('lets a member train once their freeze has lapsed', () => {
    const decision = canBookClass(plan(), ctx({ status: 'frozen', frozenUntil: PAST }), NOW);
    expect(decision.allowed).toBe(true);
  });

  it('keeps an indefinite freeze closed until staff release it', () => {
    const decision = canBookClass(plan(), ctx({ status: 'frozen', frozenUntil: null }), NOW);
    expect(decision).toEqual({ allowed: false, reason: 'frozen', remaining: 0 });
  });

  it('blocks past_due and pending_payment so billing is enforced at the mat', () => {
    expect(canBookClass(plan(), ctx({ status: 'past_due' }), NOW).reason).toBe('past_due');
    expect(canBookClass(plan(), ctx({ status: 'pending_payment' }), NOW).reason).toBe('past_due');
  });

  it('blocks cancelled and expired memberships', () => {
    expect(canBookClass(plan(), ctx({ status: 'cancelled' }), NOW).reason).toBe('expired');
    expect(canBookClass(plan(), ctx({ status: 'expired' }), NOW).reason).toBe('expired');
  });

  it('blocks an active membership whose paid period has already ended', () => {
    expect(canBookClass(plan(), ctx({ currentPeriodEnd: PAST }), NOW).reason).toBe('expired');
  });
});

describe('canBookClass — plan quotas', () => {
  it('gives unlimited plans an unbounded balance', () => {
    const decision = canBookClass(plan(), ctx({ classesUsedInPeriod: 99 }), NOW);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('counts the guardian household usage against a weekly limit', () => {
    const weekly = plan({ planType: 'weekly_limit', classesPerWeek: 3 });
    const decision = canBookClass(weekly, ctx({ classesUsedInPeriod: 1, familyUsageThisWeek: 1 }), NOW);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(1);
  });

  it('refuses a weekly plan once the household is at the limit', () => {
    const weekly = plan({ planType: 'weekly_limit', classesPerWeek: 2 });
    const decision = canBookClass(weekly, ctx({ classesUsedInPeriod: 2 }), NOW);
    expect(decision).toEqual({ allowed: false, reason: 'quota', remaining: 0 });
  });

  it('draws class packs down to zero and then stops', () => {
    const pack = plan({ planType: 'class_pack', classPackCount: 10 });
    expect(canBookClass(pack, ctx({ classesUsedInPeriod: 7 }), NOW).remaining).toBe(3);
    expect(canBookClass(pack, ctx({ classesUsedInPeriod: 10 }), NOW).reason).toBe('quota');
  });

  it('treats a drop-in pack the same way as a class pack', () => {
    const dropin = plan({ planType: 'dropin_pack', classPackCount: 5 });
    expect(canBookClass(dropin, ctx({ classesUsedInPeriod: 4 }), NOW).remaining).toBe(1);
  });

  it('uses household usage only for family plans', () => {
    const family = plan({ planType: 'family', classesPerWeek: 6 });
    const decision = canBookClass(family, ctx({ classesUsedInPeriod: 5, familyUsageThisWeek: 2 }), NOW);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(4);
  });
});

describe('computeFreezeWindow', () => {
  it('grants the requested window', () => {
    const window = computeFreezeWindow(30, 60, 10, NOW);
    expect(window.days).toBe(30);
    expect(window.start).toBe(NOW.toISOString());
    expect(window.end).toBe('2026-04-14T12:00:00.000Z');
  });

  it('trims the request to the remaining annual allowance', () => {
    expect(computeFreezeWindow(100, 60, 10, NOW).days).toBe(50);
  });

  it('always grants at least a single day', () => {
    expect(computeFreezeWindow(30, 60, 60, NOW).days).toBe(1);
  });
});
