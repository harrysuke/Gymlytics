# ADR-0004: Capability-based PaymentProvider adapter with idempotent webhooks

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

Stripe handles global cards and subscriptions. Billplz is strong for Malaysian FPX/banking
one-off payments but has no reusable card credential or true recurring billing. iPay88 covers
SEA local cards and recurring where the merchant account enables it. Their APIs, signature
schemes and webhook payloads share almost nothing.

Billing code must not sprout `if provider === ...` branches, and a retried webhook must never
extend a membership twice. A failed renewal must be retried automatically with a defined
dunning schedule.

## Decision

Define a single **`PaymentProvider` interface** with `createCustomer`, `charge`,
`createSubscription?`, `cancelSubscription?`, `refund?` and
`verifyAndNormalizeWebhook`. Add a `capabilities` object
(`recurring`, `savedCards`, `refunds`, `currencies`, `countries`, `hostedCheckout`).

- `PaymentRouter.select()` picks a provider from currency, country, payment method and
  required capability. Optional methods are guarded by capability flags, so `billplz` can
  legitimately omit `createSubscription`.
- Provider-specific webhooks are verified in the adapter (Stripe `t,v1` HMAC with 5-minute
  tolerance; Billplz `X-Signature`; iPay88 MD5 signature) and normalised to domain events
  such as `subscription.past_due`.
- The API inserts into `webhook_events` with `UNIQUE(provider, external_event_id)` **before**
  applying side effects. A conflict means "already seen" → HTTP 200, no action.
- Dunning retries are stored in `payment_retries`, scheduled by a pure `nextRetryAt()`
  function (days 1, 3, 5, 7, 12), and each charge uses `Idempotency-Key: retry-<id>`.
- Only provider tokens (`providerPaymentMethodId`) are stored. PAN/CVV never enter our DB.

## Consequences

### Positive

- Adding a gateway means adding an adapter and a capability row — no changes in billing code.
- One webhook handler for all providers; signature verification is isolated and testable.
- Idempotency at both webhook and charge layers makes at-least-once delivery safe.

### Negative / risks

- Capability flags must reflect the merchant account, not just the gateway. Mitigation:
  make capabilities configuration-driven per academy, not hardcoded constants, in v2.
- Local gateway signature formulas change between versions. Mitigation: adapter-local
  verification with a documented "confirm against dashboard" note and integration tests
  using captured webhook fixtures.
- iPay88/Billplz refunds are not automated in v1; staff use the provider portal.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Stripe only | Excludes Malaysian/SEA members who pay by FPX/local cards |
| Direct provider calls in billing service | Couples domain logic to three SDKs and makes testing painful |
| Generic "payment gateway" with lowest-common-denominator API | Loses recurring capability and forces every provider into an inaccurate model |
