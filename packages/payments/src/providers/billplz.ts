import { basicAuth, hmacHex, hashHex, safeEqual, toForm } from '../crypto';
import { CapabilityNotSupportedError, PaymentProviderError, WebhookSignatureError } from '../errors';
import type {
  ChargeInput,
  ChargeResult,
  CustomerRef,
  NormalizedWebhookEvent,
  PaymentProvider,
  RefundInput,
  RefundResult,
  SubscriptionInput,
  SubscriptionResult,
} from '../types';

export interface BillplzConfig {
  apiKey: string;
  collectionId: string;
  signatureKey: string;
  xSignatureKey: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Billplz is optimised for Malaysian FPX / online banking ONE-OFF payments.
 * It has no saved-card token and no true recurring billing, so the capability
 * matrix deliberately excludes `recurring` — the router will never pick it
 * for a subscription. Membership renewals go to Stripe/iPay88 instead.
 */
export class BillplzProvider implements PaymentProvider {
  readonly name = 'billplz' as const;
  readonly capabilities = {
    recurring: false,
    savedCards: false,
    refunds: false,
    currencies: ['MYR'] as const,
    countries: ['MY'] as const,
    hostedCheckout: true,
  };

  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: BillplzConfig) {
    this.apiBase = config.apiBase ?? 'https://www.billplz.com/api/v7';
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async createCustomer(input: {
    academyId: string;
    userId: string;
    email?: string;
    name?: string;
  }): Promise<CustomerRef> {
    // Billplz bills are keyed by email, not by a customer resource.
    const id = `billplz_${hashHex('sha256', `${input.academyId}:${input.userId}:${input.email ?? ''}`).slice(0, 24)}`;
    return { id, provider: 'billplz', email: input.email };
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const body = toForm({
      collection_id: this.config.collectionId,
      email: input.metadata?.['email'] ?? 'cash@gymlytics.local',
      name: input.description.slice(0, 100),
      amount: (input.amountCents / 100).toFixed(2), // Billplz takes ringgit as a string
      description: input.description,
      callback_url: `${input.returnUrl ?? ''}?source=billplz`,
      redirect_url: input.returnUrl,
      reference_1: input.academyId,
      reference_1_label: 'Academy',
      reference_2: input.userId ?? '',
      reference_2_label: 'Member',
    });
    const bill = await this.request<Record<string, unknown>>('POST', '/bills', body);
    return {
      provider: 'billplz',
      providerChargeId: String(bill.id ?? ''),
      status: 'pending', // FPX settles asynchronously via callback
      ...(bill.url ? { redirectUrl: String(bill.url) } : {}),
      raw: bill,
    };
  }

  async createSubscription(_input: SubscriptionInput): Promise<SubscriptionResult> {
    throw new CapabilityNotSupportedError('billplz', 'recurring subscriptions');
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    throw new CapabilityNotSupportedError('billplz', 'programmatic refunds');
  }

  async verifyAndNormalizeWebhook(
    rawBody: string | Uint8Array,
    headers: Record<string, string>,
  ): Promise<NormalizedWebhookEvent> {
    const raw = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
    const form = new URLSearchParams(raw);
    const provided = header(headers, 'x-signature');
    const billId = form.get('id') ?? '';
    const transactionId = form.get('transaction_id') ?? '';
    const status = form.get('status') ?? '';

    // Confirm the exact concatenation order against your Billplz dashboard
    // version: id|transaction_id|status is the v7 X-Signature scheme.
    const expected = hmacHex('sha512', this.config.xSignatureKey, `${billId}|${transactionId}|${status}`);
    if (!provided || !safeEqual(expected, provided)) throw new WebhookSignatureError('billplz');

    const paid = status.toLowerCase() === 'paid';
    const failed = status.toLowerCase() === 'fail';
    return {
      id: `${billId}:${transactionId}`,
      provider: 'billplz',
      type: paid ? 'payment.succeeded' : failed ? 'payment.failed' : 'payment.pending',
      occurredAt: new Date().toISOString(),
      academyId: form.get('reference_1') ?? undefined,
      userId: form.get('reference_2') ?? undefined,
      chargeId: billId,
      ...(form.get('amount') ? { amountCents: Math.round(Number(form.get('amount')) * 100) } : {}),
      currency: 'MYR',
      raw: Object.fromEntries(form.entries()),
    };
  }

  private async request<T>(method: string, path: string, body?: URLSearchParams): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        Authorization: basicAuth(this.config.apiKey),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      ...(body ? { body } : {}),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const error = json.error as { message?: string } | undefined;
      throw new PaymentProviderError(
        error?.message ?? `Billplz ${method} ${path} failed`,
        `http_${response.status}`,
        'billplz',
        response.status >= 500,
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
