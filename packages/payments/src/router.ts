import type { ProviderName } from './types';
import type { PaymentProvider } from './types';

export interface ProviderSelectionInput {
  purpose: 'subscription' | 'one_time';
  currency: string;
  countryCode: string;
  /** 'card' or 'online_banking' — FPX/Billplz only makes sense for the latter. */
  method?: 'card' | 'online_banking';
  preferredProvider?: ProviderName;
}

/**
 * Capability-first routing. Business code never hardcodes `if (provider === 'stripe')`.
 * Adding a fourth gateway = add an adapter + a capability row, no call-site edits.
 */
export class PaymentRouter {
  constructor(private readonly providers: Map<ProviderName, PaymentProvider>) {}

  select(input: ProviderSelectionInput): PaymentProvider {
    const preferred = input.preferredProvider
      ? this.providers.get(input.preferredProvider)
      : undefined;
    if (preferred && this.matches(preferred, input)) return preferred;

    const candidates = [...this.providers.values()].filter((p) => this.matches(p, input));
    const ranked = candidates.sort((a, b) => score(b, input) - score(a, input));
    const chosen = ranked[0];
    if (!chosen) {
      throw new Error(
        `No payment provider supports ${input.purpose} in ${input.currency}/${input.countryCode} (${input.method ?? 'any method'})`,
      );
    }
    return chosen;
  }

  private matches(provider: PaymentProvider, input: ProviderSelectionInput): boolean {
    const cap = provider.capabilities;
    if (!cap.currencies.includes(input.currency)) return false;
    if (cap.countries.length && !cap.countries.includes(input.countryCode)) return false;
    if (input.purpose === 'subscription' && !cap.recurring) return false;
    if (input.method === 'card' && !cap.savedCards && input.purpose === 'subscription') {
      return false;
    }
    return true;
  }
}

function score(provider: PaymentProvider, input: ProviderSelectionInput): number {
  let points = provider.capabilities.recurring ? 2 : 0;
  if (provider.capabilities.savedCards) points += 1;
  if (input.method === 'online_banking' && provider.name === 'billplz') points += 5;
  if (input.method === 'card' && provider.name === 'ipay88' && input.countryCode === 'MY') {
    points += 4;
  }
  if (input.countryCode !== 'MY' && provider.name === 'stripe') points += 5;
  return points;
}

