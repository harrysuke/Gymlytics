import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  memberships,
  paymentRetries,
  transactions,
  webhookEvents,
  type Db,
} from '@gymlytics/db';
import {
  nextRetryAt,
  normalizeHeaders,
  processIncomingWebhook,
  type NormalizedWebhookEvent,
  type ProviderName,
} from '@gymlytics/payments';
import { paymentRegistry } from '../../lib/payments';

export async function registerWebhookRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post('/v1/webhooks/:provider', async (request, reply) => {
    const provider = request.params as { provider: ProviderName };
    const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);

    let event: NormalizedWebhookEvent;
    try {
      event = await processIncomingWebhook(
        paymentRegistry,
        provider.provider,
        raw,
        normalizeHeaders(request.headers as Record<string, string | string[] | undefined>),
      );
    } catch (error) {
      request.log.error({ error }, 'webhook signature verification failed');
      return reply.code(400).send({ error: 'invalid signature' });
    }

    // Insert-first idempotency. A UNIQUE(provider, external_event_id) conflict
    // means we have already applied this event — ack 200 without side effects.
    const inserted = db
      .insert(webhookEvents)
      .values({
        academyId: event.academyId ?? null,
        provider: event.provider,
        externalEventId: event.id,
        eventType: event.type,
        signatureValid: true,
        payload: event.raw as Record<string, unknown>,
        status: 'processing',
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id })
      .all();

    if (inserted.length === 0) return { ok: true, duplicate: true };

    try {
      applyDomainEvent(db, event);
      db.update(webhookEvents)
        .set({ status: 'processed', processedAt: new Date().toISOString() })
        .where(eq(webhookEvents.id, inserted[0]!.id))
        .run();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.update(webhookEvents)
        .set({ status: 'failed', lastError: message })
        .where(eq(webhookEvents.id, inserted[0]!.id))
        .run();
      request.log.error({ error }, 'webhook processing failed');
      return reply.code(500).send({ error: 'processing failed' }); // provider will retry
    }
  });
}

function applyDomainEvent(db: Db, event: NormalizedWebhookEvent): void {
  const now = new Date().toISOString();
  const transaction = event.chargeId
    ? db.select().from(transactions).where(eq(transactions.providerTransactionId, event.chargeId)).get()
    : undefined;

  switch (event.type) {
    case 'payment.succeeded': {
      if (transaction) {
        db.update(transactions)
          .set({ status: 'succeeded', processedAt: now })
          .where(eq(transactions.id, transaction.id))
          .run();
        if (transaction.membershipId) {
          db.update(memberships)
            .set({ status: 'active', updatedAt: now })
            .where(eq(memberships.id, transaction.membershipId))
            .run();
        }
      }
      return;
    }

    case 'payment.failed': {
      if (transaction) {
        db.update(transactions)
          .set({ status: 'failed', failureCode: event.failureCode ?? 'unknown', processedAt: now })
          .where(eq(transactions.id, transaction.id))
          .run();
        if (transaction.membershipId) {
          db.update(memberships)
            .set({ status: 'past_due', updatedAt: now })
            .where(eq(memberships.id, transaction.membershipId))
            .run();
        }
        const due = nextRetryAt(1, new Date());
        if (due) {
          db.insert(paymentRetries)
            .values({
              academyId: transaction.academyId,
              membershipId: transaction.membershipId,
              transactionId: transaction.id,
              attemptNumber: 1,
              scheduledAt: due.toISOString(),
              status: 'scheduled',
              provider: event.provider,
              failureCode: event.failureCode ?? 'unknown',
            })
            .run();
        }
      }
      return;
    }

    case 'subscription.renewed': {
      if (event.subscriptionId) {
        const membership = db
          .select()
          .from(memberships)
          .where(eq(memberships.providerSubscriptionId, event.subscriptionId))
          .get();
        if (membership) {
          const next = new Date();
          next.setUTCMonth(next.getUTCMonth() + 1);
          db.update(memberships)
            .set({ status: 'active', nextBillingAt: next.toISOString(), updatedAt: now })
            .where(eq(memberships.id, membership.id))
            .run();
        }
      }
      return;
    }

    case 'subscription.past_due': {
      if (event.subscriptionId) {
        db.update(memberships)
          .set({ status: 'past_due', updatedAt: now })
          .where(eq(memberships.providerSubscriptionId, event.subscriptionId))
          .run();
      }
      return;
    }

    case 'subscription.canceled': {
      if (event.subscriptionId) {
        db.update(memberships)
          .set({ status: 'cancelled', cancelledAt: now, updatedAt: now })
          .where(eq(memberships.providerSubscriptionId, event.subscriptionId))
          .run();
      }
      return;
    }

    case 'refund.succeeded': {
      if (transaction) {
        db.update(transactions)
          .set({ status: 'refunded', processedAt: now })
          .where(eq(transactions.id, transaction.id))
          .run();
      }
      return;
    }

    default:
      return;
  }
}
