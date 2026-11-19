import { BillplzProvider, type BillplzConfig } from './providers/billplz';
import { Ipay88Provider, type Ipay88Config } from './providers/ipay88';
import { StripeProvider, type StripeConfig } from './providers/stripe';
import { PaymentRouter } from './router';
import type { PaymentProvider, ProviderName } from './types';

export * from './types';
export * from './errors';
export * from './crypto';
export * from './router';
export * from './dunning';
export * from './webhooks';
export { StripeProvider, type StripeConfig } from './providers/stripe';
export { BillplzProvider, type BillplzConfig } from './providers/billplz';
export { Ipay88Provider, type Ipay88Config } from './providers/ipay88';

export interface PaymentConfigs {
  stripe?: StripeConfig;
  billplz?: BillplzConfig;
  ipay88?: Ipay88Config;
}

export function createPaymentRegistry(configs: PaymentConfigs): Map<ProviderName, PaymentProvider> {
  const registry = new Map<ProviderName, PaymentProvider>();
  if (configs.stripe) registry.set('stripe', new StripeProvider(configs.stripe));
  if (configs.billplz) registry.set('billplz', new BillplzProvider(configs.billplz));
  if (configs.ipay88) registry.set('ipay88', new Ipay88Provider(configs.ipay88));
  return registry;
}

export function createPaymentRouter(configs: PaymentConfigs): PaymentRouter {
  return new PaymentRouter(createPaymentRegistry(configs));
}
