import { and, eq, lte } from 'drizzle-orm';
import type { Db } from '@gymlytics/db';
import { memberships, paymentMethods, paymentRetries, transactions } from '@gymlytics/db';
import {
  nextRetryAt,
  shouldCancelMembership,
  type PaymentProvider,
  type ProviderName,
} from '@gymlytics/payments';

/**
 * Cron: every hour. Retries failed subscription charges using the card on
 * file. Each attempt is idempotent by `retry-<id>`, so a crash mid-charge
 * cannot double-bill a member.
 */
export async function runDunningJob(
  db: Db,
  registry: Map<ProviderName, PaymentProvider>,
): Promise<{ attempted: number; recovered: number }> {
  const now = new Date().toISOString();
  const due = db
    .select()
    .from(paymentRetries)
    .where(and(eq(paymentRetries.status, 'scheduled'), lte(paymentRetries.scheduledAt, now)))
    .limit(50)
    .all();

  let attempted = 0;
  let recovered = 0;

  for (const retry of due) {
    if (!retry.transactionId) continue;
    const transaction = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, retry.transactionId))
      .get();
    if (!transaction) continue;

    const provider = registry.get(transaction.provider as ProviderName);
    if (!provider) continue;

    attempted += 1;
    db.update(paymentRetries)
      .set({ status: 'attempted', attemptedAt: now })
      .where(eq(paymentRetries.id, retry.id))
      .run();

    try {
      const method = transaction.paymentMethodId
        ? db
            .select()
            .from(paymentMethods)
            .where(eq(paymentMethods.id, transaction.paymentMethodId))
            .get()
        : undefined;

      const result = await provider.charge({
        academyId: transaction.academyId,
        userId: transaction.userId ?? undefined,
        amountCents: transaction.totalCents,
        currency: transaction.currency,
        description: `Membership retry #${retry.attemptNumber}`,
        idempotencyKey: `retry-${retry.id}`,
        paymentMethodId: method?.providerPaymentMethodId,
        customerId: method?.providerCustomerId,
      });

      if (result.status === 'succeeded' && retry.membershipId) {
        db.update(memberships)
          .set({ status: 'active' })
          .where(eq(memberships.id, retry.membershipId))
          .run();
        db.update(transactions)
          .set({ status: 'succeeded', processedAt: new Date().toISOString() })
          .where(eq(transactions.id, transaction.id))
          .run();
        db.update(paymentRetries)
          .set({ status: 'succeeded' })
          .where(eq(paymentRetries.id, retry.id))
          .run();
        recovered += 1;
        continue;
      }

      const failureCode = result.failureCode ?? 'retry_declined';
      const next = nextRetryAt(retry.attemptNumber + 1, new Date());
      if (!next || shouldCancelMembership(retry.attemptNumber + 1)) {
        if (retry.membershipId) {
          db.update(memberships)
            .set({ status: shouldCancelMembership(retry.attemptNumber + 1) ? 'cancelled' : 'past_due' })
            .where(eq(memberships.id, retry.membershipId))
            .run();
        }
        db.update(paymentRetries)
          .set({ status: 'abandoned', failureCode })
          .where(eq(paymentRetries.id, retry.id))
          .run();
      } else {
        db.insert(paymentRetries)
          .values({
            academyId: retry.academyId,
            membershipId: retry.membershipId,
            transactionId: retry.transactionId,
            attemptNumber: retry.attemptNumber + 1,
            scheduledAt: next.toISOString(),
            status: 'scheduled',
            provider: retry.provider,
            failureCode,
          })
          .run();
      }
    } catch (error) {
      db.update(paymentRetries)
        .set({
          status: 'abandoned',
          failureCode: 'provider_error',
          failureMessage: error instanceof Error ? error.message : String(error),
        })
        .where(eq(paymentRetries.id, retry.id))
        .run();
    }
  }

  return { attempted, recovered };
}
