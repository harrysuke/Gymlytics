import { describe, expect, it } from 'vitest';
import { BillplzProvider } from '../providers/billplz';
import { Ipay88Provider } from '../providers/ipay88';
import { StripeProvider } from '../providers/stripe';
import { createPaymentRegistry, createPaymentRouter } from '../index';

const stripe = new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'whsec_test' });
const billplz = new BillplzProvider({
  apiKey: 'bp_key',
  collectionId: 'col',
  signatureKey: 'sig',
  xSignatureKey: 'xsig',
});
const ipay88 = new Ipay88Provider({
  merchantCode: 'M0001',
  merchantKey: 'mk',
  signatureKey: 'sk',
  returnUrl: 'https://example.test/return',
});

function router() {
  return createPaymentRouter({
    stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_test' },
    billplz: { apiKey: 'bp_key', collectionId: 'col', signatureKey: 'sig', xSignatureKey: 'xsig' },
    ipay88: { merchantCode: 'M0001', merchantKey: 'mk', signatureKey: 'sk', returnUrl: 'https://example.test/return' },
  });
}

describe('createPaymentRegistry', () => {
  it('only registers configured providers', () => {
    const registry = createPaymentRegistry({ stripe: { secretKey: 'sk', webhookSecret: 'wh' } });
    expect([...registry.keys()]).toEqual(['stripe']);
  });

  it('registers every configured provider', () => {
    const registry = createPaymentRegistry({
      stripe: { secretKey: 'sk', webhookSecret: 'wh' },
      billplz: { apiKey: 'k', collectionId: 'c', signatureKey: 's', xSignatureKey: 'x' },
      ipay88: {
        merchantCode: 'M0001',
        merchantKey: 'mk',
        signatureKey: 'sk',
        returnUrl: 'https://example.test/return',
      },
    });
    expect([...registry.keys()].sort()).toEqual(['billplz', 'ipay88', 'stripe']);
  });
});

describe('PaymentRouter.select — capability matching', () => {
  it('never routes a subscription to Billplz, which has no recurring support', () => {
    const chosen = router().select({
      purpose: 'subscription',
      currency: 'MYR',
      countryCode: 'MY',
      method: 'card',
    });
    expect(chosen.name).not.toBe('billplz');
  });

  it('prefers Billplz for Malaysian online banking (FPX)', () => {
    const chosen = router().select({
      purpose: 'one_time',
      currency: 'MYR',
      countryCode: 'MY',
      method: 'online_banking',
    });
    expect(chosen.name).toBe('billplz');
  });

  it('sends non-Malaysian traffic to Stripe', () => {
    const chosen = router().select({ purpose: 'subscription', currency: 'USD', countryCode: 'US' });
    expect(chosen.name).toBe('stripe');
  });

  it('falls back to iPay88 when Stripe is not configured', () => {
    const onlyIpay = createPaymentRouter({
      ipay88: {
        merchantCode: 'M0001',
        merchantKey: 'mk',
        signatureKey: 'sk',
        returnUrl: 'https://example.test/return',
      },
    });
    expect(onlyIpay.select({ purpose: 'subscription', currency: 'MYR', countryCode: 'MY' }).name).toBe(
      'ipay88',
    );
  });

  it('honours an explicit preference when that provider can serve the request', () => {
    const chosen = router().select({
      purpose: 'subscription',
      currency: 'MYR',
      countryCode: 'MY',
      preferredProvider: 'ipay88',
    });
    expect(chosen.name).toBe('ipay88');
  });

  it('ignores a preference the provider cannot serve', () => {
    const chosen = router().select({
      purpose: 'subscription',
      currency: 'MYR',
      countryCode: 'MY',
      preferredProvider: 'billplz',
    });
    expect(chosen.name).not.toBe('billplz');
  });

  it('throws a descriptive error when nothing can serve the request', () => {
    const onlyBillplz = createPaymentRouter({
      billplz: { apiKey: 'k', collectionId: 'c', signatureKey: 's', xSignatureKey: 'x' },
    });
    expect(() =>
      onlyBillplz.select({ purpose: 'subscription', currency: 'USD', countryCode: 'US' }),
    ).toThrow(/No payment provider supports subscription in USD\/US/);
  });
});

describe('provider capabilities', () => {
  it('declares the recurring matrix the router relies on', () => {
    expect(stripe.capabilities.recurring).toBe(true);
    expect(ipay88.capabilities.recurring).toBe(true);
    expect(billplz.capabilities.recurring).toBe(false);
  });

  it('restricts Billplz to Malaysian ringgit', () => {
    expect(billplz.capabilities.currencies).toEqual(['MYR']);
    expect(billplz.capabilities.countries).toEqual(['MY']);
  });

  it('treats an empty country list as global', () => {
    expect(stripe.capabilities.countries).toHaveLength(0);
  });
});
