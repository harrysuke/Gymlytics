import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  academies,
  academySubscriptions,
  beltRanks,
  importJobs,
  onboardingProgress,
  paymentMethods,
  promotions,
  saasPlans,
  users,
  type Db,
} from '@gymlytics/db';
import {
  ONBOARDING_STEP_ORDER,
  PAYMENT_PROVIDERS,
  parseBeltRanksCsv,
  parseBillingMandatesCsv,
  parseMembersCsv,
  type BeltRankImportRow,
  type BillingMandateImportRow,
  type ImportRowError,
  type MemberImportRow,
} from '@gymlytics/shared';
import {
  changePlanSchema,
  completeStepSchema,
  csvImportSchema,
  networkLocationSchema,
  type ImportResultDto,
} from '@gymlytics/shared';
import { auth, requireRole } from '../../lib/auth';
import { hashPassword, hashPin, parseJsonBody, randomToken } from '../../lib/crypto';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';
import { networkAcademyIds, requireFeature, subscriptionFor } from '../../lib/saas';

export async function registerSaasRoutes(app: FastifyInstance, db: Db): Promise<void> {
  const ownerAdmin = requireRole('owner', 'admin');
  const staff = requireRole('owner', 'admin', 'coach', 'staff');

  // ------------------------------------------------------------ plans / tiers
  app.get('/v1/saas/plans', async () => {
    const rows = db
      .select()
      .from(saasPlans)
      .where(eq(saasPlans.isPublic, true))
      .orderBy(saasPlans.sortOrder)
      .all();
    return {
      ok: true,
      data: rows.map((plan) => ({
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        description: plan.description,
        priceCents: plan.priceCents,
        currency: plan.currency,
        features: plan.features,
        sortOrder: plan.sortOrder,
      })),
    };
  });

  app.get('/v1/saas/subscription', async (request) => {
    const { academyId } = auth(request);
    const subscription = subscriptionFor(db, academyId);
    const plan = subscription.planId
      ? db.select().from(saasPlans).where(eq(saasPlans.id, subscription.planId)).get()
      : null;
    return {
      ok: true,
      data: {
        plan: plan
          ? {
              id: plan.id,
              slug: plan.slug,
              name: plan.name,
              description: plan.description,
              priceCents: plan.priceCents,
              currency: plan.currency,
              features: plan.features,
              sortOrder: plan.sortOrder,
            }
          : {
              id: 'starter',
              slug: 'starter' as const,
              name: 'Starter',
              description: 'Default plan',
              priceCents: 0,
              currency: 'MYR',
              features: subscription.features,
              sortOrder: 0,
            },
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        features: subscription.features,
      },
    };
  });

  app.post('/v1/saas/subscription/change', { preHandler: ownerAdmin }, async (request) => {
    const { academyId } = auth(request);
    const body = await parseJsonBody(request, changePlanSchema);
    const plan = db.select().from(saasPlans).where(eq(saasPlans.slug, body.planSlug)).get();
    if (!plan) throw notFound('Plan not found');

    const existing = db
      .select()
      .from(academySubscriptions)
      .where(eq(academySubscriptions.academyId, academyId))
      .get();
    if (existing) {
      db.update(academySubscriptions)
        .set({ planId: plan.id, status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(academySubscriptions.id, existing.id))
        .run();
      return { ok: true, data: { id: existing.id, planSlug: plan.slug } };
    }
    const id = uuidv7();
    db.insert(academySubscriptions)
      .values({
        id,
        academyId,
        planId: plan.id,
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        provider: 'manual',
      })
      .run();
    return { ok: true, data: { id, planSlug: plan.slug } };
  });

  // --------------------------------------------------------------- onboarding
  function onboardingDto(academyId: string) {
    const row = db
      .select()
      .from(onboardingProgress)
      .where(eq(onboardingProgress.academyId, academyId))
      .get();
    const completed = row?.completedSteps ?? [];
    return {
      currentStep: row?.currentStep ?? ONBOARDING_STEP_ORDER[0],
      completedSteps: completed,
      completedAt: row?.completedAt ?? null,
      progressPercent: Math.round((completed.length / ONBOARDING_STEP_ORDER.length) * 100),
    };
  }

  app.get('/v1/saas/onboarding', async (request) => ({
    ok: true,
    data: onboardingDto(auth(request).academyId),
  }));

  app.post('/v1/saas/onboarding/steps', { preHandler: ownerAdmin }, async (request) => {
    const { academyId } = auth(request);
    const body = await parseJsonBody(request, completeStepSchema);
    const existing = db
      .select()
      .from(onboardingProgress)
      .where(eq(onboardingProgress.academyId, academyId))
      .get();
    const completed = [...new Set([...(existing?.completedSteps ?? []), body.step])];
    const next = ONBOARDING_STEP_ORDER.find((step) => !completed.includes(step)) ?? body.step;
    const completedAt = completed.length === ONBOARDING_STEP_ORDER.length
      ? new Date().toISOString()
      : null;

    if (existing) {
      db.update(onboardingProgress)
        .set({ completedSteps: completed, currentStep: next, completedAt, updatedAt: new Date().toISOString() })
        .where(eq(onboardingProgress.id, existing.id))
        .run();
    } else {
      db.insert(onboardingProgress)
        .values({ id: uuidv7(), academyId, completedSteps: completed, currentStep: next, completedAt })
        .run();
    }
    return { ok: true, data: onboardingDto(academyId) };
  });

  // ------------------------------------------------- multi-location / network
  app.get('/v1/network/locations', { preHandler: staff }, async (request) => {
    const ids = networkAcademyIds(db, request);
    const rows = db
      .select()
      .from(academies)
      .where(and(inArray(academies.id, ids), isNull(academies.deletedAt)))
      .orderBy(academies.name)
      .all();
    return { ok: true, data: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      parentAcademyId: row.parentAcademyId,
      city: row.city,
      currency: row.currency,
      isRoot: row.parentAcademyId === null,
    })) };
  });

  app.post('/v1/network/locations', { preHandler: ownerAdmin }, async (request, reply) => {
    const { academyId } = auth(request);
    const subscription = subscriptionFor(db, academyId);
    if (!subscription.features.includes('multi_site')) {
      throw unprocessable('Multi-location requires the Network plan', { feature: 'multi_site', upgradeRequired: true });
    }
    const body = await parseJsonBody(request, networkLocationSchema);
    const duplicate = db.select({ id: academies.id }).from(academies).where(eq(academies.slug, body.slug)).get();
    if (duplicate) throw conflict('An academy with that slug already exists');

    const id = uuidv7();
    db.insert(academies)
      .values({
        id,
        parentAcademyId: academyId,
        name: body.name,
        slug: body.slug,
        timezone: body.timezone,
        currency: body.currency,
        city: body.city,
        state: body.state,
      })
      .run();
    const plan = db.select().from(saasPlans)
      .where(eq(saasPlans.slug, subscription.planSlug as 'starter' | 'growth' | 'network')).get();
    if (plan) {
      db.insert(academySubscriptions)
        .values({ id: uuidv7(), academyId: id, planId: plan.id, status: 'active', provider: 'manual' })
        .run();
    }
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.get('/v1/network/overview', { preHandler: staff }, async (request) => {
    const ids = networkAcademyIds(db, request);
    const locations = db
      .select({
        id: academies.id,
        name: academies.name,
        slug: academies.slug,
        parentAcademyId: academies.parentAcademyId,
        city: academies.city,
      })
      .from(academies)
      .where(and(inArray(academies.id, ids), isNull(academies.deletedAt)))
      .all();

    const memberRows = db
      .select({ academyId: users.academyId, total: sql<number>`count(*)` })
      .from(users)
      .where(and(inArray(users.academyId, ids), isNull(users.deletedAt), eq(users.status, 'active')))
      .groupBy(users.academyId)
      .all();
    const byAcademy = new Map(memberRows.map((row) => [row.academyId, Number(row.total)]));

    return {
      ok: true,
      data: {
        locationCount: locations.length,
        activeMembers: [...byAcademy.values()].reduce((sum, total) => sum + total, 0),
        locations: locations.map((location) => ({
          ...location,
          isRoot: location.parentAcademyId === null,
          activeMembers: byAcademy.get(location.id) ?? 0,
        })),
      },
    };
  });

  // ------------------------------------------------------------- CSV imports
  app.post('/v1/imports', { preHandler: [ownerAdmin, requireFeature(db, 'csv_import')] }, async (request) => {
    const { academyId, userId } = auth(request);
    const body = await parseJsonBody(request, csvImportSchema);
    const parsed = body.type === 'members'
      ? parseMembersCsv(body.csv)
      : body.type === 'belt_ranks'
        ? parseBeltRanksCsv(body.csv)
        : parseBillingMandatesCsv(body.csv);

    const errors: ImportRowError[] = [...parsed.errors];
    let imported = 0;

    db.transaction((tx) => {
      for (const { row, value } of parsed.values) {
        try {
          if (body.type === 'members') {
            const member = value as MemberImportRow;
            const existing = member.email
              ? tx.select({ id: users.id }).from(users).where(and(eq(users.academyId, academyId), eq(users.email, member.email))).get()
              : undefined;
            let userIdForRow = existing?.id;
            if (!userIdForRow) {
              const newId = uuidv7();
              tx.insert(users).values({
                id: newId,
                academyId,
                firstName: member.firstName,
                lastName: member.lastName,
                email: member.email,
                phone: member.phone,
                role: (['student', 'guardian', 'staff', 'coach'].includes(member.role)
                  ? member.role
                  : 'student') as 'student' | 'guardian' | 'staff' | 'coach',
                status: 'active',
                ...(member.pin ? { pinHash: hashPin(academyId, member.pin) } : {}),
                passwordHash: hashPassword(randomToken(12)),
              }).run();
              userIdForRow = newId;
            }
            if (member.beltSlug) {
              const belt = tx.select({ id: beltRanks.id, programId: beltRanks.programId }).from(beltRanks)
                .where(and(eq(beltRanks.academyId, academyId), eq(beltRanks.slug, member.beltSlug)))
                .get();
              if (belt) {
                tx.insert(promotions).values({
                  id: uuidv7(), academyId, userId: userIdForRow,
                  programId: belt.programId, toBeltRankId: belt.id,
                  toStripes: member.stripes ?? 0, promotedAt: new Date().toISOString(),
                  promotedBy: userId,
                }).run();
              }
            }
          } else if (body.type === 'belt_ranks') {
            const rank = value as BeltRankImportRow;
            const member = tx.select({ id: users.id }).from(users)
              .where(and(eq(users.academyId, academyId), eq(users.email, rank.email))).get();
            const belt = tx.select().from(beltRanks)
              .where(and(eq(beltRanks.academyId, academyId), eq(beltRanks.slug, rank.beltSlug))).get();
            if (!member) throw new Error('Member not found for email');
            if (!belt) throw new Error(`Unknown belt ${rank.beltSlug}`);
            const promotedAt = rank.promotedAt && !Number.isNaN(Date.parse(rank.promotedAt))
              ? new Date(rank.promotedAt).toISOString()
              : new Date().toISOString();
            tx.insert(promotions).values({
              id: uuidv7(), academyId, userId: member.id, programId: belt.programId,
              toBeltRankId: belt.id, toStripes: rank.stripes, promotedAt, promotedBy: userId,
            }).run();
          } else {
            const mandate = value as BillingMandateImportRow;
            const member = tx.select({ id: users.id }).from(users)
              .where(and(eq(users.academyId, academyId), eq(users.email, mandate.email))).get();
            if (!member) throw new Error('Member not found for email');
            if (!PAYMENT_PROVIDERS.includes(mandate.provider as (typeof PAYMENT_PROVIDERS)[number])) {
              throw new Error(`Unknown provider ${mandate.provider}`);
            }
            const existing = tx.select({ id: paymentMethods.id }).from(paymentMethods)
              .where(and(eq(paymentMethods.userId, member.id), eq(paymentMethods.providerPaymentMethodId, mandate.providerPaymentMethodId)))
              .get();
            if (existing) {
              tx.update(paymentMethods).set({ brand: mandate.brand, last4: mandate.last4, status: 'active' })
                .where(eq(paymentMethods.id, existing.id)).run();
            } else {
              tx.insert(paymentMethods).values({
                id: uuidv7(), academyId, userId: member.id,
                provider: mandate.provider as (typeof PAYMENT_PROVIDERS)[number],
                providerCustomerId: mandate.providerCustomerId,
                providerPaymentMethodId: mandate.providerPaymentMethodId,
                brand: mandate.brand, last4: mandate.last4, isDefault: true,
              }).run();
            }
          }
          imported += 1;
        } catch (error) {
          errors.push({ row, message: error instanceof Error ? error.message.slice(0, 240) : 'Import failed' });
        }
      }
    });

    const id = uuidv7();
    db.insert(importJobs).values({
      id, academyId, type: body.type,
      status: errors.length === parsed.values.length && parsed.values.length > 0 ? 'failed' : 'completed',
      fileName: body.fileName ?? 'upload.csv',
      totalRows: parsed.values.length + parsed.errors.length,
      importedRows: imported,
      errors,
      createdByUserId: userId,
    }).run();

    const result: ImportResultDto = {
      id, type: body.type,
      status: errors.length === parsed.values.length && parsed.values.length > 0 ? 'failed' : 'completed',
      fileName: body.fileName ?? 'upload.csv',
      totalRows: parsed.values.length + parsed.errors.length,
      importedRows: imported,
      skippedRows: errors.length,
      errors,
      createdAt: new Date().toISOString(),
    };
    return { ok: true, data: result };
  });

  app.get('/v1/imports', { preHandler: staff }, async (request) => {
    const { academyId } = auth(request);
    const rows = db.select().from(importJobs)
      .where(eq(importJobs.academyId, academyId))
      .orderBy(desc(importJobs.createdAt))
      .limit(50).all();
    return { ok: true, data: rows };
  });

  // CSV template download — a tiny helper for the guided setup wizard.
  app.get('/v1/imports/template/:type', { preHandler: staff }, async (request, reply) => {
    const { type } = request.params as { type: string };
    if (!['members', 'belt_ranks', 'billing_mandates'].includes(type)) throw badRequest('Unknown import type');
    const templates: Record<string, string> = {
      members: 'firstName,lastName,email,phone,role,pin,belt,stripes\nJane,Doe,jane@example.test,+60123456789,student,2200,white,0\n',
      belt_ranks: 'email,belt,stripes,promotedAt\njane@example.test,blue,1,2026-01-15\n',
      billing_mandates: 'email,provider,providerCustomerId,providerPaymentMethodId,brand,last4\njane@example.test,stripe,cus_123,pm_123,visa,4242\n',
    };
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${type}-template.csv"`);
    return templates[type];
  });
}
