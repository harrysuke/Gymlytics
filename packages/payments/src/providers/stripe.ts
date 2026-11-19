import { hmacHex, safeEqual, toForm } from '../crypto';
import { PaymentProviderError, WebhookSignatureError } from '../errors';
import type {
  ChargeInput,
  ChargeResult,
  CustomerRef,
  NormalizedEventType,
  NormalizedWebhookEvent,
  PaymentProvider,
  RefundInput,
  RefundResult,
  SubscriptionInput,
  SubscriptionResult,
} from '../types';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

const EVENT_MAP: Record<string, NormalizedEventType> = {
  'payment_intent.succeeded': 'payment.succeeded',
  'payment_intent.payment_failed': 'payment.failed',
  'charge.refunded': 'refund.succeeded',
  'invoice.payment_succeeded': 'subscription.renewed',
  'invoice.payment_failed': 'subscription.past_due',
  'customer.subscription.deleted': 'subscription.canceled',
};

export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly capabilities = {
    recurring: true,
    savedCards: true,
    refunds: true,
    currencies: ['MYR', 'USD', 'SGD', 'THB', 'IDR', 'PHP', 'EUR', 'GBP', 'AUD'] as const,
    countries: [] as const, // global
    hostedCheckout: true,
  };

  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: StripeConfig) {
    this.apiBase = config.apiBase ?? 'https://api.stripe.com/v1';
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async createCustomer(input: {
    academyId: string;
    userId: string;
    email?: string;
    name?: string;
  }): Promise<CustomerRef> {
    const body = toForm({
      email: input.email,
      name: input.name,
      'metadata[academyId]': input.academyId,
      'metadata[userId]': input.userId,
    });
    const customer = await this.request<{ id: string }>('POST', '/customers', body);
    return { id: customer.id, provider: 'stripe', email: input.email };
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const body = toForm({
      amount: input.amountCents,
      currency: input.currency.toLowerCase(),
      customer: input.customerId,
      payment_method: input.paymentMethodId,
      confirm: input.paymentMethodId ? true : false,
      description: input.description,
      'metadata[academyId]': input.academyId,
      'metadata[userId]': input.userId ?? '',
      'metadata[description]': input.description,
      return_url: input.returnUrl,
    });
    const intent = await this.request<Record<string, unknown>>(
      'POST',
      '/payment_intents',
      body,
      input.idempotencyKey,
    );
    const status = String(intent.status ?? 'pending');
    return {
      provider: 'stripe',
      providerChargeId: String(intent.id ?? ''),
      status: status === 'succeeded' ? 'succeeded' : status === 'requires_action' ? 'pending' : 'failed',
      ...(intent.client_secret ? { redirectUrl: String(intent.client_secret) } : {}),
      raw: intent,
    };
  }

  async createSubscription(input: SubscriptionInput): Promise<SubscriptionResult> {
    const body = toForm({
      customer: input.customerId,
      'items[0][price]': input.providerPriceId,
      'payment_method': input.paymentMethodId,
      'payment_settings[save_default_payment_method]': 'on_subscription',
      'metadata[academyId]': input.academyId,
      'metadata[userId]': input.userId,
      'metadata[planId]': input.planId,
      ...(input.trialDays ? { trial_period_days: input.trialDays } : {}),
    });
    const subscription = await this.request<Record<string, unknown>>(
      'POST',
      '/subscriptions',
      body,
      input.idempotencyKey,
    );
    const latest = (subscription.items as { data?: { current_period_end?: number }[] } | undefined)
      ?.data?.[0]?.current_period_end;
    return {
      provider: 'stripe',
      providerSubscriptionId: String(subscription.id ?? ''),
      status: subscription.status === 'trialing' ? 'trialing' : 'active',
      ...(latest ? { currentPeriodEnd: new Date(latest * 1_000).toISOString() } : {}),
      raw: subscription,
    };
  }

  async cancelSubscription(providerSubscriptionId: string, reason?: string): Promise<void> {
    await this.request('DELETE', `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, toForm({
      cancellation_details: reason,
    }));
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    const body = toForm({
      payment_intent: input.chargeId,
      amount: input.amountCents,
      reason: input.reason,
      'metadata[reason]': input.reason,
    });
    const refund = await this.request<Record<string, unknown>>('POST', '/refunds', body, input.idempotencyKey);
    return {
      providerRefundId: String(refund.id ?? ''),
      status: refund.status === 'succeeded' ? 'succeeded' : 'pending',
      raw: refund,
    };
  }

  async verifyAndNormalizeWebhook(
    rawBody: string | Uint8Array,
    headers: Record<string, string>,
  ): Promise<NormalizedWebhookEvent> {
    const raw = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
    const signatureHeader = header(headers, 'stripe-signature');
    const parts = Object.fromEntries(
      signatureHeader.split(',').map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
      }),
    );
    const timestamp = parts['t'];
    const provided = parts['v1'];
    if (!timestamp || !provided) throw new WebhookSignatureError('stripe');

    // Reject replays older than 5 minutes.
    if (Math.abs(Date.now() / 1_000 - Number(timestamp)) > 300) {
      throw new WebhookSignatureError('stripe');
    }
    const expected = hmacHex('sha256', this.config.webhookSecret, `${timestamp}.${raw}`);
    if (!safeEqual(expected, provided)) throw new WebhookSignatureError('stripe');

    const event = JSON.parse(raw) as Record<string, unknown>;
    const data = (event.data as { object?: Record<string, unknown> } | undefined)?.object ?? {};
    const metadata = (data.metadata as Record<string, string> | undefined) ?? {};
    const type = String(event.type ?? 'unknown');
    const created = Number(event.created ?? Date.now() / 1_000);

    return {
      id: String(event.id ?? crypto.randomUUID()),
      provider: 'stripe',
      type: EVENT_MAP[type] ?? 'unknown',
      occurredAt: new Date(created * 1_000).toISOString(),
      ...(metadata['academyId'] ? { academyId: metadata['academyId'] } : {}),
      ...(metadata['userId'] ? { userId: metadata['userId'] } : {}),
      ...(data.id ? { chargeId: String(data.id) } : {}),
      ...(type.startsWith('invoice.') || type.startsWith('customer.subscription')
        ? { subscriptionId: String(data.subscription ?? data.id ?? '') }
        : {}),
      ...(typeof data.amount_received === 'number'
        ? { amountCents: data.amount_received, currency: String(data.currency ?? '').toUpperCase() }
        : {}),
      raw: event,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body && method !== 'DELETE' ? { body } : {}),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = json.error as { code?: string; message?: string } | undefined;
      const code = error?.code ?? `http_${response.status}`;
      throw new PaymentProviderError(
        error?.message ?? `Stripe ${method} ${path} failed`,
        code,
        'stripe',
        response.status >= 500 || code === 'rate_limit',
        response.status,
      );
    }
    return json as T;
  }
}

function header(headers: Record<string, string>, name: string): string {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? (headers[key] ?? '') : '';
}
