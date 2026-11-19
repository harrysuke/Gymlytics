import type { NormalizedWebhookEvent, PaymentProvider, ProviderName } from './types';
import { PaymentProviderError } from './errors';

/** Normalise Fastify/Express header shapes into the simple map adapters expect. */
export function normalizeHeaders(
  source: Headers | Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (source instanceof Headers) {
    source.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
    return result;
  }
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') result[key.toLowerCase()] = value;
    else if (Array.isArray(value) && value[0]) result[key.toLowerCase()] = value[0];
  }
  return result;
}

export function processIncomingWebhook(
  registry: Map<ProviderName, PaymentProvider>,
  providerName: ProviderName,
  rawBody: string | Uint8Array,
  headers: Record<string, string>,
): Promise<NormalizedWebhookEvent> {
  const provider = registry.get(providerName);
  if (!provider) {
    throw new PaymentProviderError(
      `Unknown payment provider: ${providerName}`,
      'UNKNOWN_PROVIDER',
      providerName,
      false,
    );
  }
  return provider.verifyAndNormalizeWebhook(rawBody, headers);
}
