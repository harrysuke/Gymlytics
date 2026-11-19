import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { academySubscriptions, saasPlans, networkDescendantIds, type Db } from '@gymlytics/db';
import { featuresForPlan, hasFeature } from '@gymlytics/shared';
import { auth } from './auth';
import { forbidden, unprocessable } from './errors';

export interface EffectiveSubscription {
  planSlug: string;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  features: string[];
  planId: string | null;
  currentPeriodEnd: string | null;
}

/** Falls back to starter when an academy has no subscription row yet. */
export function subscriptionFor(db: Db, academyId: string): EffectiveSubscription {
  const row = db
    .select({ subscription: academySubscriptions, plan: saasPlans })
    .from(academySubscriptions)
    .innerJoin(saasPlans, eq(academySubscriptions.planId, saasPlans.id))
    .where(
      and(
        eq(academySubscriptions.academyId, academyId),
        inArray(academySubscriptions.status, ['active', 'trialing']),
      ),
    )
    .get();

  if (!row) {
    return {
      planSlug: 'starter',
      status: 'trialing',
      features: featuresForPlan('starter'),
      planId: null,
      currentPeriodEnd: null,
    };
  }
  return {
    planSlug: row.plan.slug,
    status: row.subscription.status,
    // Stored features win over defaults so a negotiated plan can differ.
    features: row.plan.features.length ? [...row.plan.features] : featuresForPlan(row.plan.slug),
    planId: row.plan.id,
    currentPeriodEnd: row.subscription.currentPeriodEnd,
  };
}

/** PreHandler for gated modules. Always fails closed. */
export function requireFeature(db: Db, feature: string) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const { academyId } = auth(request);
    const subscription = subscriptionFor(db, academyId);
    if (!hasFeature(subscription.features, feature)) {
      throw unprocessable(`Your plan does not include ${feature.replaceAll('_', ' ')}`, {
        feature,
        upgradeRequired: true,
      });
    }
  };
}

/**
 * Scope for network reads. Only the root's owner/admin may aggregate across
 * branches — a branch admin never sees another location's roster.
 */
export function networkAcademyIds(db: Db, request: FastifyRequest): string[] {
  const { academyId, role } = auth(request);
  if (!['owner', 'admin'].includes(role)) {
    throw forbidden('Network rollups require owner or admin access');
  }
  return networkDescendantIds(db, academyId);
}
