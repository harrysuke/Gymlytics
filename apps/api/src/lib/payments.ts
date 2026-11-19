import { createPaymentRegistry, type PaymentProvider, type ProviderName } from '@gymlytics/payments';

/**
 * One provider registry per process. Missing credentials simply omit that
 * adapter; the router then reports that no provider supports the request
 * instead of failing at import time.
 */
export const paymentRegistry: Map<ProviderName, PaymentProvider> = createPaymentRegistry({
  ...(process.env.STRIPE_SECRET_KEY
    ? {
        stripe: {
          secretKey: process.env.STRIPE_SECRET_KEY,
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
        },
      }
    : {}),
  ...(process.env.BILLPLZ_API_KEY
    ? {
        billplz: {
          apiKey: process.env.BILLPLZ_API_KEY,
          collectionId: process.env.BILLPLZ_COLLECTION_ID ?? '',
          signatureKey: process.env.BILLPLZ_SIGNATURE_KEY ?? '',
          xSignatureKey: process.env.BILLPLZ_X_SIGNATURE_KEY ?? '',
        },
      }
    : {}),
  ...(process.env.IPAY88_MERCHANT_CODE
    ? {
        ipay88: {
          merchantCode: process.env.IPAY88_MERCHANT_CODE,
          merchantKey: process.env.IPAY88_MERCHANT_KEY ?? '',
          signatureKey: process.env.IPAY88_SIGNATURE_KEY ?? '',
          returnUrl: process.env.PUBLIC_API_URL ?? 'http://localhost:3000',
        },
      }
    : {}),
});
