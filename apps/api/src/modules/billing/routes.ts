import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  memberships,
  membershipPlans,
  paymentMethods,
  retailProducts,
  transactions,
  transactionItems,
  users,
  waivers,
  type Db,
} from '@gymlytics/db';
import {
  calculateSale,
  cancelMembershipSchema,
  createMembershipSchema,
  createPlanSchema,
  dayPassSchema,
  freezeMembershipSchema,
  posSaleSchema,
} from '@gymlytics/shared';
import type { PaymentProvider, ProviderName } from '@gymlytics/payments';
import { auth, requireRole } from '../../lib/auth';
import { recordChange } from '../../lib/change-log';
import { parseJsonBody } from '../../lib/crypto';
import { computeFreezeWindow } from '@gymlytics/shared';
import { badRequest, conflict, notFound, unprocessable } from '../../lib/errors';
import { uuidv7 } from '../../lib/ids';

export async function registerBillingRoutes(
  app: FastifyInstance,
  db: Db,
  providers: Map<ProviderName, PaymentProvider>,
): Promise<void> {
  app.get('/v1/billing/plans', async (request) => {
    const context = auth(request);
    const rows = db
      .select()
      .from(membershipPlans)
      .where(and(eq(membershipPlans.academyId, context.academyId), isNull(membershipPlans.deletedAt)))
      .orderBy(desc(membershipPlans.createdAt))
      .all();
    return { ok: true, data: rows };
  });

  app.post('/v1/billing/plans', { preHandler: requireRole('owner', 'admin') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, createPlanSchema);
    const id = uuidv7();
    db.insert(membershipPlans)
      .values({
        id,
        academyId: context.academyId,
        name: body.name,
        description: body.description ?? null,
        planType: body.planType,
        billingInterval: body.billingInterval,
        priceCents: body.priceCents,
        currency: body.currency,
        classesPerWeek: body.classesPerWeek ?? null,
        classPackCount: body.classPackCount ?? null,
        familyDiscountPercent: body.familyDiscountPercent,
        maxDependents: body.maxDependents,
        freezeAllowed: body.freezeAllowed,
        freezeMaxDaysPerYear: body.freezeMaxDaysPerYear,
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.get('/v1/billing/memberships', { preHandler: requireRole('owner', 'admin', 'staff', 'coach') }, async (request) => {
    const context = auth(request);
    const query = request.query as { status?: string; userId?: string };
    const conditions = [eq(memberships.academyId, context.academyId)];
    if (query.status) {
      conditions.push(eq(memberships.status, query.status as typeof memberships.$inferSelect.status));
    }
    if (query.userId) conditions.push(eq(memberships.userId, query.userId));

    const rows = db
      .select({
        id: memberships.id,
        userId: memberships.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        status: memberships.status,
        currentPeriodStart: memberships.currentPeriodStart,
        currentPeriodEnd: memberships.currentPeriodEnd,
        classesUsedInPeriod: memberships.classesUsedInPeriod,
        freezeUntil: memberships.freezeUntil,
        planId: membershipPlans.id,
        planName: membershipPlans.name,
        planType: membershipPlans.planType,
        priceCents: membershipPlans.priceCents,
        currency: membershipPlans.currency,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
      .where(and(...conditions))
      .orderBy(desc(memberships.createdAt))
      .all();
    return { ok: true, data: rows };
  });

  app.post('/v1/billing/memberships', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, createMembershipSchema);
    const plan = db
      .select()
      .from(membershipPlans)
      .where(and(eq(membershipPlans.id, body.planId), eq(membershipPlans.academyId, context.academyId)))
      .get();
    if (!plan) throw notFound('Plan not found');
    const member = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, body.userId), eq(users.academyId, context.academyId)))
      .get();
    if (!member) throw notFound('Member not found');

    const existing = db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, body.userId),
          inArray(memberships.status, ['active', 'trialing', 'past_due', 'frozen', 'pending_payment']),
        ),
      )
      .get();
    if (existing) throw conflict('Member already has an active membership');

    const start = body.startDate ? new Date(`${body.startDate}T00:00:00.000Z`) : new Date();
    const periodEnd = addInterval(start, plan.billingInterval);
    const membershipId = uuidv7();
    const transactionId = uuidv7();
    const now = new Date().toISOString();
    const hosted = body.provider !== 'manual';

    db.transaction((tx) => {
      tx.insert(memberships)
        .values({
          id: membershipId,
          academyId: context.academyId,
          userId: body.userId,
          planId: plan.id,
          status: hosted ? 'pending_payment' : 'active',
          currentPeriodStart: start.toISOString(),
          currentPeriodEnd: periodEnd.toISOString(),
          provider: body.provider,
          defaultPaymentMethodId: body.paymentMethodId ?? null,
          nextBillingAt: periodEnd.toISOString(),
        })
        .run();

      tx.insert(transactions)
        .values({
          id: transactionId,
          academyId: context.academyId,
          type: 'membership',
          status: hosted ? 'pending' : 'succeeded',
          userId: body.userId,
          payerId: body.userId,
          membershipId,
          paymentMethodId: body.paymentMethodId ?? null,
          subtotalCents: plan.priceCents,
          discountCents: 0,
          taxCents: 0,
          totalCents: plan.priceCents,
          currency: plan.currency,
          provider: body.provider,
          idempotencyKey: `membership-${membershipId}`,
          processedAt: hosted ? null : now,
        })
        .run();

      recordChange(tx, {
        academyId: context.academyId,
        entity: 'retail_transaction',
        entityId: transactionId,
        operation: 'insert',
        payload: {
          id: transactionId,
          type: 'membership',
          status: hosted ? 'pending' : 'succeeded',
          userId: body.userId,
          totalCents: plan.priceCents,
          currency: plan.currency,
          provider: body.provider,
        },
      });
    });

    return reply.code(201).send({ ok: true, data: { id: membershipId, status: hosted ? 'pending_payment' : 'active' } });
  });

  app.post('/v1/billing/memberships/:id/freeze', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const body = await parseJsonBody(request, freezeMembershipSchema);
    const row = db
      .select({ membership: memberships, plan: membershipPlans })
      .from(memberships)
      .innerJoin(membershipPlans, eq(membershipPlans.id, memberships.planId))
      .where(and(eq(memberships.id, id), eq(memberships.academyId, context.academyId)))
      .get();
    if (!row) throw notFound('Membership not found');
    if (!row.plan.freezeAllowed) throw unprocessable('This plan cannot be frozen');
    if (row.membership.status === 'cancelled') throw unprocessable('Membership is cancelled');

    const window = computeFreezeWindow(
      body.days,
      row.plan.freezeMaxDaysPerYear,
      row.membership.totalFrozenDays,
    );
    db.update(memberships)
      .set({
        status: 'frozen',
        frozenAt: window.start,
        freezeUntil: window.end,
        totalFrozenDays: row.membership.totalFrozenDays + window.days,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(memberships.id, id))
      .run();

    return { ok: true, data: { frozenUntil: window.end, days: window.days } };
  });

  app.post('/v1/billing/memberships/:id/unfreeze', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const membership = db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, id), eq(memberships.academyId, context.academyId)))
      .get();
    if (!membership) throw notFound('Membership not found');
    if (membership.status !== 'frozen') throw unprocessable('Membership is not frozen');

    const now = new Date();
    const freezeUntil = membership.freezeUntil ? new Date(membership.freezeUntil) : now;
    const remainingDays = Math.max(0, Math.ceil((freezeUntil.getTime() - now.getTime()) / 86_400_000));
    const newEnd = new Date(membership.currentPeriodEnd);
    newEnd.setUTCDate(newEnd.getUTCDate() + remainingDays);

    db.update(memberships)
      .set({
        status: 'active',
        frozenAt: null,
        freezeUntil: null,
        currentPeriodEnd: newEnd.toISOString(),
        updatedAt: now.toISOString(),
      })
      .where(eq(memberships.id, id))
      .run();

    return { ok: true, data: { status: 'active', currentPeriodEnd: newEnd.toISOString() } };
  });

  app.post('/v1/billing/memberships/:id/cancel', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request) => {
    const context = auth(request);
    const { id } = request.params as { id: string };
    const membership = db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, id), eq(memberships.academyId, context.academyId)))
      .get();
    if (!membership) throw notFound('Membership not found');
    const rawBody = request.body;
    const body = cancelMembershipSchema.parse(
      typeof rawBody === 'string' ? (rawBody.trim() ? JSON.parse(rawBody) : {}) : (rawBody ?? {}),
    );

    const provider = providers.get(membership.provider as ProviderName);
    if (membership.providerSubscriptionId && provider?.cancelSubscription) {
      await provider.cancelSubscription(membership.providerSubscriptionId, 'Cancelled by academy');
    }
    const now = new Date().toISOString();
    db.update(memberships)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        cancelAtPeriodEnd: false,
        cancellationReason: body.reason ?? null,
        cancellationNote: body.note ?? null,
        updatedAt: now,
      })
      .where(eq(memberships.id, id))
      .run();
    return { ok: true, data: { status: 'cancelled' } };
  });

  app.get('/v1/billing/products', async (request) => {
    const context = auth(request);
    const rows = db
      .select()
      .from(retailProducts)
      .where(
        and(
          eq(retailProducts.academyId, context.academyId),
          isNull(retailProducts.deletedAt),
          eq(retailProducts.isActive, true),
        ),
      )
      .orderBy(retailProducts.name)
      .all();
    return { ok: true, data: rows };
  });

  app.post('/v1/billing/products', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request, reply) => {
    const context = auth(request);
    const body = request.body as Record<string, unknown>;
    if (!body['name'] || typeof body['priceCents'] !== 'number') {
      throw badRequest('name and priceCents are required');
    }
    const id = uuidv7();
    db.insert(retailProducts)
      .values({
        id,
        academyId: context.academyId,
        sku: String(body['sku'] ?? id.slice(0, 8)).toUpperCase(),
        name: String(body['name']),
        description: body['description'] ? String(body['description']) : null,
        category: (body['category'] as 'other') ?? 'other',
        priceCents: Number(body['priceCents']),
        costCents: typeof body['costCents'] === 'number' ? body['costCents'] : null,
        currency: String(body['currency'] ?? 'MYR'),
        stockQuantity: Number(body['stockQuantity'] ?? 0),
        lowStockThreshold: Number(body['lowStockThreshold'] ?? 5),
        size: body['size'] ? String(body['size']) : null,
        color: body['color'] ? String(body['color']) : null,
      })
      .run();
    return reply.code(201).send({ ok: true, data: { id } });
  });

  app.post('/v1/billing/pos', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, posSaleSchema);

    const duplicate = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, body.idempotencyKey))
      .get();
    if (duplicate) return { ok: true, data: { id: duplicate.id, duplicate: true } };

    const products = db
      .select()
      .from(retailProducts)
      .where(and(eq(retailProducts.academyId, context.academyId), isNull(retailProducts.deletedAt)))
      .all();
    const lines = body.lineItems.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) throw notFound(`Product ${item.productId} not found`);
      if (product.trackInventory && product.stockQuantity < item.quantity) {
        throw unprocessable(`${product.name} is out of stock`);
      }
      return {
        product,
        quantity: item.quantity,
        unitPriceCents: product.priceCents,
        totalCents: product.priceCents * item.quantity,
      };
    });

    const totals = calculateSale({
      lines: lines.map((line) => ({ unitPriceCents: line.unitPriceCents, quantity: line.quantity })),
      discountCents: body.discountCents,
      currency: lines[0]?.product.currency ?? 'MYR',
    });

    let status: 'succeeded' | 'pending' | 'failed' = body.provider === 'manual' ? 'succeeded' : 'pending';
    let providerTransactionId: string | null = null;
    let redirectUrl: string | undefined;
    if (body.provider !== 'manual') {
      const provider = providers.get(body.provider);
      if (!provider) throw unprocessable(`Payment provider ${body.provider} is not configured`);
      const method = body.paymentMethodId
        ? db.select().from(paymentMethods).where(eq(paymentMethods.id, body.paymentMethodId)).get()
        : undefined;
      const charge = await provider.charge({
        academyId: context.academyId,
        userId: body.customerUserId,
        amountCents: totals.totalCents,
        currency: totals.currency,
        description: `POS sale (${lines.length} items)`,
        idempotencyKey: body.idempotencyKey,
        paymentMethodId: method?.providerPaymentMethodId,
        customerId: method?.providerCustomerId,
        returnUrl: `${process.env.PUBLIC_API_URL ?? 'http://localhost:3000'}/pos/return`,
      });
      status = charge.status;
      providerTransactionId = charge.providerChargeId;
      redirectUrl = charge.redirectUrl;
    }

    const transactionId = uuidv7();
    const now = new Date().toISOString();
    db.transaction((tx) => {
      tx.insert(transactions)
        .values({
          id: transactionId,
          academyId: context.academyId,
          type: 'retail',
          status,
          userId: body.customerUserId ?? null,
          payerId: body.customerUserId ?? null,
          paymentMethodId: body.paymentMethodId ?? null,
          subtotalCents: totals.subtotalCents,
          discountCents: totals.discountCents,
          taxCents: totals.taxCents,
          totalCents: totals.totalCents,
          currency: totals.currency,
          provider: body.provider,
          providerTransactionId,
          idempotencyKey: body.idempotencyKey,
          processedAt: status === 'succeeded' ? now : null,
        })
        .run();

      for (const line of lines) {
        tx.insert(transactionItems)
          .values({
            id: uuidv7(),
            transactionId,
            productId: line.product.id,
            description: line.product.name,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents,
            totalCents: line.totalCents,
          })
          .run();
        if (line.product.trackInventory) {
          tx.update(retailProducts)
            .set({ stockQuantity: sql`max(0, ${retailProducts.stockQuantity} - ${line.quantity})` })
            .where(eq(retailProducts.id, line.product.id))
            .run();
        }
      }

      recordChange(tx, {
        academyId: context.academyId,
        entity: 'retail_transaction',
        entityId: transactionId,
        operation: 'insert',
        payload: {
          id: transactionId,
          type: 'retail',
          status,
          userId: body.customerUserId,
          totalCents: totals.totalCents,
          currency: totals.currency,
          provider: body.provider,
        },
      });
    });

    return reply.code(201).send({
      ok: true,
      data: { id: transactionId, status, totalCents: totals.totalCents, redirectUrl },
    });
  });

  app.post('/v1/billing/day-pass', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request, reply) => {
    const context = auth(request);
    const body = await parseJsonBody(request, dayPassSchema);
    if (!body.waiverSigned) throw unprocessable('A signed waiver is required for a day pass');

    const waiver = db
      .select()
      .from(waivers)
      .where(and(eq(waivers.id, body.waiverId), eq(waivers.userId, body.visitorId)))
      .get();
    if (!waiver || waiver.status !== 'signed') throw unprocessable('Waiver not found');
    if (waiver.expiresAt && new Date(waiver.expiresAt) <= new Date()) throw unprocessable('Waiver expired');

    const duplicate = db
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, body.idempotencyKey))
      .get();
    if (duplicate) return { ok: true, data: { id: duplicate.id, duplicate: true } };

    const id = uuidv7();
    const now = new Date().toISOString();
    db.transaction((tx) => {
      tx.insert(transactions)
        .values({
          id,
          academyId: context.academyId,
          type: 'day_pass',
          status: body.provider === 'manual' ? 'succeeded' : 'pending',
          userId: body.visitorId,
          payerId: body.visitorId,
          subtotalCents: body.priceCents,
          discountCents: 0,
          taxCents: 0,
          totalCents: body.priceCents,
          currency: body.currency,
          provider: body.provider,
          idempotencyKey: body.idempotencyKey,
          processedAt: body.provider === 'manual' ? now : null,
        })
        .run();
      recordChange(tx, {
        academyId: context.academyId,
        entity: 'retail_transaction',
        entityId: id,
        operation: 'insert',
        payload: {
          id,
          type: 'day_pass',
          status: body.provider === 'manual' ? 'succeeded' : 'pending',
          userId: body.visitorId,
          totalCents: body.priceCents,
          currency: body.currency,
          provider: body.provider,
        },
      });
    });

    return reply.code(201).send({ ok: true, data: { id, status: body.provider === 'manual' ? 'succeeded' : 'pending' } });
  });

  app.get('/v1/billing/transactions', { preHandler: requireRole('owner', 'admin', 'staff') }, async (request) => {
    const context = auth(request);
    const query = request.query as { from?: string; to?: string; type?: string };
    const conditions = [eq(transactions.academyId, context.academyId)];
    if (query.from) conditions.push(gte(transactions.createdAt, query.from));
    if (query.to) conditions.push(sql`${transactions.createdAt} <= ${query.to}`);
    if (query.type) conditions.push(eq(transactions.type, query.type as 'retail'));

    const rows = db
      .select({
        id: transactions.id,
        type: transactions.type,
        status: transactions.status,
        totalCents: transactions.totalCents,
        currency: transactions.currency,
        provider: transactions.provider,
        createdAt: transactions.createdAt,
        userId: transactions.userId,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(transactions)
      .leftJoin(users, eq(users.id, transactions.userId))
      .where(and(...conditions))
      .orderBy(desc(transactions.createdAt))
      .limit(100)
      .all();
    return { ok: true, data: rows };
  });
}

function addInterval(start: Date, interval: 'monthly' | 'quarterly' | 'annual' | 'one_time'): Date {
  const end = new Date(start);
  switch (interval) {
    case 'monthly':
      end.setUTCMonth(end.getUTCMonth() + 1);
      break;
    case 'quarterly':
      end.setUTCMonth(end.getUTCMonth() + 3);
      break;
    case 'annual':
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      break;
    case 'one_time':
      end.setUTCDate(end.getUTCDate() + 1);
      break;
  }
  return end;
}
