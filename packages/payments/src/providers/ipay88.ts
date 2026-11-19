import { hashHex, safeEqual } from '../crypto';
import { CapabilityNotSupportedError, WebhookSignatureError } from '../errors';
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

export interface Ipay88Config {
  merchantCode: string;
  merchantKey: string;
  signatureKey: string;
  paymentUrl?: string;
  returnUrl: string;
  fetchImpl?: typeof fetch;
}

const STATUS_MAP: Record<string, NormalizedEventType> = {
  '1': 'payment.succeeded',
  '2': 'payment.failed',
  '4': 'payment.pending',
};

/** iPay88 is the SEA workhorse: local cards + FPX + recurring where enabled. */
export class Ipay88Provider implements PaymentProvider {
  readonly name = 'ipay88' as const;
  readonly capabilities = {
    recurring: true,
    savedCards: true,
    refunds: false,
    currencies: ['MYR', 'SGD', 'USD', 'THB', 'IDR', 'PHP'] as const,
    countries: ['MY', 'SG', 'TH', 'ID', 'PH'] as const,
    hostedCheckout: true,
  };

  private readonly paymentUrl: string;

  constructor(private readonly config: Ipay88Config) {
    this.paymentUrl = config.paymentUrl ?? 'https://www.ipay88.com/epayment/entry.asp';
  }

  async createCustomer(input: {
    academyId: string;
    userId: string;
    email?: string;
    name?: string;
  }): Promise<CustomerRef> {
    const id = `ipay88_${hashHex('sha256', `${input.academyId}:${input.userId}`).slice(0, 24)}`;
    return { id, provider: 'ipay88', email: input.email };
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const refNo = `${input.academyId.slice(0, 8)}-${input.idempotencyKey.slice(0, 13)}`;
    const amount = (input.amountCents / 100).toFixed(2);
    const params: Record<string, string> = {
      MerchantCode: this.config.merchantCode,
      RefNo: refNo,
      Amount: amount,
      Currency: input.currency,
      ProdDesc: input.description,
      UserName: input.metadata?.['userName'] ?? 'Member',
      UserEmail: input.metadata?.['email'] ?? '',
      UserContact: input.metadata?.['phone'] ?? '',
      Remark: `academy=${input.academyId}`,
      Lang: 'UTF-8',
      Country: 'MY',
      ReturnURL: input.returnUrl ?? this.config.returnUrl,
      BackURL: this.config.returnUrl,
    };
    params['Signature'] = this.sign(refNo, amount, input.currency);
    params['SignatureType'] = 'MD5';

    return {
      provider: 'ipay88',
      providerChargeId: refNo,
      status: 'pending',
      redirectUrl: `${this.paymentUrl}?${new URLSearchParams(params).toString()}`,
      raw: params,
    };
  }

  async createSubscription(input: SubscriptionInput): Promise<SubscriptionResult> {
    // Recurring must also be enabled on the merchant account for this code.
    // The first charge is a hosted checkout; subsequent renewals are driven
    // by our own dunning cron against the stored recurring token.
    const charge = await this.charge({
      academyId: input.academyId,
      userId: input.userId,
      amountCents: input.amountCents,
      currency: input.currency,
      description: `Membership ${input.planId}`,
      idempotencyKey: input.idempotencyKey,
      customerId: input.customerId,
      paymentMethodId: input.paymentMethodId,
      returnUrl: input.metadata?.['returnUrl'],
      metadata: { ...input.metadata, recurring: '1' },
    });
    return {
      provider: 'ipay88',
      providerSubscriptionId: charge.providerChargeId,
      status: 'pending',
      ...(charge.redirectUrl ? { redirectUrl: charge.redirectUrl } : {}),
      raw: charge.raw,
    };
  }

  async refund(_input: RefundInput): Promise<RefundResult> {
    throw new CapabilityNotSupportedError('ipay88', 'programmatic refunds');
  }

  async verifyAndNormalizeWebhook(
    rawBody: string | Uint8Array,
    headers: Record<string, string>,
  ): Promise<NormalizedWebhookEvent> {
    const raw = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
    const form = new URLSearchParams(raw);
    const merchantCode = form.get('MerchantCode') ?? '';
    const refNo = form.get('RefNo') ?? '';
    const amount = form.get('Amount') ?? '0.00';
    const currency = form.get('Currency') ?? 'MYR';
    const provided = form.get('Signature') ?? header(headers, 'x-signature');

    if (!provided || !safeEqual(this.sign(refNo, amount, currency), provided)) {
      throw new WebhookSignatureError('ipay88');
    }
    if (merchantCode !== this.config.merchantCode) throw new WebhookSignatureError('ipay88');

    const status = form.get('Status') ?? '';
    const paid = status === '1';
    return {
      id: `${form.get('TransactionId') ?? refNo}:${status}`,
      provider: 'ipay88',
      type: STATUS_MAP[status] ?? 'unknown',
      occurredAt: new Date().toISOString(),
      chargeId: refNo,
      subscriptionId: form.get('RecurringId') ?? undefined,
      ...(paid ? { amountCents: Math.round(Number(amount) * 100) } : {}),
      currency,
      failureCode: paid ? undefined : form.get('ErrDesc') ?? undefined,
      raw: Object.fromEntries(form.entries()),
    };
  }

  private sign(refNo: string, amount: string, currency: string): string {
    return hashHex(
      'md5',
      `${this.config.signatureKey}${this.config.merchantCode}${refNo}${amount.replace('.', '')}${currency}`,
    );
  }
}

function header(headers: Record<string, string>, name: string): string {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? (headers[key] ?? '') : '';
}
