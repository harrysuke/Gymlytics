import { describe, expect, it } from 'vitest';
import { hmacHex, hashHex } from '../crypto';
import { PaymentProviderError, WebhookSignatureError } from '../errors';
import { BillplzProvider } from '../providers/billplz';
import { Ipay88Provider } from '../providers/ipay88';
import { StripeProvider } from '../providers/stripe';
import { normalizeHeaders, processIncomingWebhook } from '../webhooks';
import { createPaymentRegistry } from '../index';
import type { ProviderName } from '../types';

const billplz = new BillplzProvider({
  apiKey: 'bp_key',
  collectionId: 'col',
  signatureKey: 'sig',
  xSignatureKey: 'x-signature-key',
});

const ipay88 = new Ipay88Provider({
  merchantCode: 'M0001',
  merchantKey: 'mk',
  signatureKey: 'sig-key',
  returnUrl: 'https://example.test/return',
});

const stripe = new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'whsec_test' });

const registry = createPaymentRegistry({
  stripe: { secretKey: 'sk_test', webhookSecret: 'whsec_test' },
  billplz: { apiKey: 'bp_key', collectionId: 'col', signatureKey: 'sig', xSignatureKey: 'x-signature-key' },
  ipay88: {
    merchantCode: 'M0001',
    merchantKey: 'mk',
    signatureKey: 'sig-key',
    returnUrl: 'https://example.test/return',
  },
});

describe('normalizeHeaders', () => {
  it('lowercases plain object keys and collapses arrays', () => {
    expect(normalizeHeaders({ 'X-Signature': 'abc', 'x-other': ['one', 'two'] })).toEqual({
      'x-signature': 'abc',
      'x-other': 'one',
    });
  });

  it('drops undefined values', () => {
    expect(normalizeHeaders({ a: undefined })).toEqual({});
  });

  it('reads a Fetch Headers instance', () => {
    const headers = new Headers({ 'Stripe-Signature': 't=1,v1=abc' });
    expect(normalizeHeaders(headers)['stripe-signature']).toBe('t=1,v1=abc');
  });
});

describe('Billplz webhook', () => {
  const body = 'id=bill_1&transaction_id=txn_1&status=paid&amount=200.00&reference_1=academy&reference_2=member';

  it('accepts a correctly signed callback and normalises it', async () => {
    const signature = hmacHex('sha512', 'x-signature-key', 'bill_1|txn_1|paid');
    const event = await billplz.verifyAndNormalizeWebhook(body, { 'x-signature': signature });

    expect(event.provider).toBe('billplz');
    expect(event.type).toBe('payment.succeeded');
    expect(event.chargeId).toBe('bill_1');
    expect(event.amountCents).toBe(20_000);
    expect(event.currency).toBe('MYR');
    expect(event.academyId).toBe('academy');
    expect(event.userId).toBe('member');
  });

  it('rejects a forged signature', async () => {
    await expect(
      billplz.verifyAndNormalizeWebhook(body, { 'x-signature': 'deadbeef' }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('rejects a callback with no signature at all', async () => {
    await expect(billplz.verifyAndNormalizeWebhook(body, {})).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('rejects a body whose signed fields were tampered with', async () => {
    const signature = hmacHex('sha512', 'x-signature-key', 'bill_1|txn_1|paid');
    const tampered = body.replace('status=paid', 'status=fail');
    await expect(
      billplz.verifyAndNormalizeWebhook(tampered, { 'x-signature': signature }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('maps a failed payment', async () => {
    const signature = hmacHex('sha512', 'x-signature-key', 'bill_1|txn_1|fail');
    const event = await billplz.verifyAndNormalizeWebhook(body.replace('status=paid', 'status=fail'), {
      'x-signature': signature,
    });
    expect(event.type).toBe('payment.failed');
  });
});

describe('iPay88 webhook', () => {
  function signedForm(overrides: Record<string, string> = {}) {
    const fields: Record<string, string> = {
      MerchantCode: 'M0001',
      RefNo: 'REF-1',
      Amount: '150.00',
      Currency: 'MYR',
      Status: '1',
      TransactionId: 'TXN-9',
      ...overrides,
    };
    // iPay88 signs <key><merchantCode><refNo><amount without decimal><currency>
    const signature = hashHex(
      'md5',
      `sig-key${fields.MerchantCode}${fields.RefNo}${fields.Amount?.replace('.', '')}${fields.Currency}`,
    );
    return { body: new URLSearchParams({ ...fields, Signature: signature }).toString(), signature };
  }

  it('accepts a valid MD5-signed result', async () => {
    const { body } = signedForm();
    const event = await ipay88.verifyAndNormalizeWebhook(body, {});
    expect(event.provider).toBe('ipay88');
    expect(event.type).toBe('payment.succeeded');
    expect(event.amountCents).toBe(15_000);
    expect(event.chargeId).toBe('REF-1');
  });

  it('rejects a wrong signature', async () => {
    // The provider trusts the form's Signature field over any header, so the
    // forgery has to be in the body.
    const { body } = signedForm();
    const forged = body.replace(/Signature=[0-9a-f]{32}/, 'Signature=deadbeefdeadbeefdeadbeefdeadbeef');
    await expect(ipay88.verifyAndNormalizeWebhook(forged, {})).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('rejects a valid signature issued for a different merchant', async () => {
    const { body } = signedForm({ MerchantCode: 'OTHER' });
    await expect(ipay88.verifyAndNormalizeWebhook(body, {})).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('maps a declined payment and carries the failure code', async () => {
    const { body } = signedForm({ Status: '2', ErrDesc: 'Insufficient funds' });
    const event = await ipay88.verifyAndNormalizeWebhook(body, {});
    expect(event.type).toBe('payment.failed');
    expect(event.failureCode).toBe('Insufficient funds');
    expect(event.amountCents).toBeUndefined();
  });
});

describe('Stripe webhook', () => {
  function signed(payload: unknown, timestamp = Math.floor(Date.now() / 1_000)) {
    const raw = JSON.stringify(payload);
    const signature = hmacHex('sha256', 'whsec_test', `${timestamp}.${raw}`);
    return { raw, header: `t=${timestamp},v1=${signature}` };
  }

  const payload = {
    id: 'evt_1',
    type: 'payment_intent.succeeded',
    created: 1_772_000_000,
    data: {
      object: {
        id: 'pi_1',
        amount: 12_000,
        currency: 'myr',
        metadata: { academyId: 'academy', userId: 'member' },
      },
    },
  };

  it('accepts a fresh, correctly signed event', async () => {
    const { raw, header } = signed(payload);
    const event = await stripe.verifyAndNormalizeWebhook(raw, { 'stripe-signature': header });
    expect(event.type).toBe('payment.succeeded');
    expect(event.academyId).toBe('academy');
    expect(event.userId).toBe('member');
    expect(event.occurredAt).toBe(new Date(1_772_000_000_000).toISOString());
  });

  it('rejects a signature from a different secret', async () => {
    const { raw } = signed(payload);
    const signature = hmacHex('sha256', 'wrong_secret', `${Math.floor(Date.now() / 1_000)}.${raw}`);
    const timestamp = Math.floor(Date.now() / 1_000);
    await expect(
      stripe.verifyAndNormalizeWebhook(raw, { 'stripe-signature': `t=${timestamp},v1=${signature}` }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('rejects a replayed event older than five minutes', async () => {
    const { raw, header } = signed(payload, Math.floor(Date.now() / 1_000) - 600);
    await expect(
      stripe.verifyAndNormalizeWebhook(raw, { 'stripe-signature': header }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('rejects a malformed signature header', async () => {
    const { raw } = signed(payload);
    await expect(
      stripe.verifyAndNormalizeWebhook(raw, { 'stripe-signature': 'garbage' }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});

describe('processIncomingWebhook', () => {
  it('dispatches to the named provider', async () => {
    const body = 'id=bill_1&transaction_id=txn_1&status=paid';
    const signature = hmacHex('sha512', 'x-signature-key', 'bill_1|txn_1|paid');
    const event = await processIncomingWebhook(registry, 'billplz', body, { 'x-signature': signature });
    expect(event.provider).toBe('billplz');
  });

  it('throws a non-retryable error for an unknown provider', () => {
    let caught: unknown;
    try {
      void processIncomingWebhook(registry, 'paypal' as ProviderName, '', {});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PaymentProviderError);
    expect((caught as PaymentProviderError).code).toBe('UNKNOWN_PROVIDER');
    expect((caught as PaymentProviderError).retryable).toBe(false);
  });
});
