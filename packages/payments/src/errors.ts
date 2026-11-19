export class PaymentProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly provider: string,
    public readonly retryable: boolean,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export class CapabilityNotSupportedError extends PaymentProviderError {
  constructor(provider: string, capability: string) {
    super(`${provider} does not support ${capability}`, 'CAPABILITY_UNSUPPORTED', provider, false);
    this.name = 'CapabilityNotSupportedError';
  }
}

export class WebhookSignatureError extends PaymentProviderError {
  constructor(provider: string) {
    super('Webhook signature verification failed', 'INVALID_SIGNATURE', provider, false);
    this.name = 'WebhookSignatureError';
  }
}

export function isRetryableFailure(code: string | undefined): boolean {
  if (!code) return true;
  const hard = [
    'card_declined',
    'insufficient_funds',
    'expired_card',
    'invalid_number',
    'duplicateCharge',
  ];
  return !hard.includes(code);
}
