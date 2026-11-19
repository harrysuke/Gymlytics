export type ProviderName = 'stripe' | 'billplz' | 'ipay88' | 'manual';
export type PaymentStatus = 'succeeded' | 'pending' | 'failed';

export interface ProviderCapabilities {
  /** Can the provider charge a saved credential on a schedule? */
  recurring: boolean;
  savedCards: boolean;
  refunds: boolean;
  currencies: readonly string[];
  /** ISO-3166 alpha-2 where the provider is a sensible choice. */
  countries: readonly string[];
  /** Card-present-ish redirect flows (FPX / hosted checkout). */
  hostedCheckout: boolean;
}

export interface CustomerRef {
  id: string;
  provider: ProviderName;
  email?: string;
}

export interface PaymentMethodRef {
  id: string;
  provider: ProviderName;
  brand?: string;
  last4?: string;
}

export interface ChargeInput {
  academyId: string;
  userId?: string;
  amountCents: number;
  currency: string;
  description: string;
  idempotencyKey: string;
  paymentMethodId?: string;
  returnUrl?: string;
  customerId?: string;
  metadata?: Record<string, string>;
}

export interface ChargeResult {
  provider: ProviderName;
  providerChargeId: string;
  status: PaymentStatus;
  redirectUrl?: string;
  failureCode?: string;
  raw: unknown;
}

export interface SubscriptionInput {
  academyId: string;
  userId: string;
  customerId: string;
  /** Provider-side price/product id mapped from our membershipPlans.id. */
  providerPriceId: string;
  planId: string;
  amountCents: number;
  currency: string;
  interval: 'monthly' | 'quarterly' | 'annual';
  paymentMethodId?: string;
  trialDays?: number;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

export interface SubscriptionResult {
  provider: ProviderName;
  providerSubscriptionId: string;
  status: 'active' | 'trialing' | 'pending' | 'past_due';
  currentPeriodEnd?: string;
  redirectUrl?: string;
  raw: unknown;
}

export interface RefundInput {
  chargeId: string;
  amountCents?: number;
  reason: string;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'succeeded' | 'pending' | 'failed';
  raw: unknown;
}

export type NormalizedEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.pending'
  | 'subscription.renewed'
  | 'subscription.past_due'
  | 'subscription.canceled'
  | 'refund.succeeded'
  | 'unknown';

/** Provider-agnostic webhook shape consumed by the API's idempotent handler. */
export interface NormalizedWebhookEvent {
  id: string;
  provider: ProviderName;
  type: NormalizedEventType;
  occurredAt: string;
  academyId?: string;
  userId?: string;
  chargeId?: string;
  subscriptionId?: string;
  amountCents?: number;
  currency?: string;
  failureCode?: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  createCustomer(input: {
    academyId: string;
    userId: string;
    email?: string;
    name?: string;
  }): Promise<CustomerRef>;
  charge(input: ChargeInput): Promise<ChargeResult>;
  createSubscription?(input: SubscriptionInput): Promise<SubscriptionResult>;
  cancelSubscription?(providerSubscriptionId: string, reason?: string): Promise<void>;
  refund?(input: RefundInput): Promise<RefundResult>;
  verifyAndNormalizeWebhook(
    rawBody: string | Uint8Array,
    headers: Record<string, string>,
  ): Promise<NormalizedWebhookEvent>;
}
