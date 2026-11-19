# Architecture Decision Records

Chronological log of consequential design decisions. Keep each record short, immutable and
superseded explicitly rather than edited. Format follows [MADR](https://adr.github.io/madr/).

| ADR | Decision | Status |
| --- | --- | --- |
| [0001](0001-typescript-monorepo.md) | TypeScript pnpm/Turborepo monorepo with shared packages | Accepted |
| [0002](0002-drizzle-sqlite-to-postgres.md) | Drizzle ORM on SQLite with a mechanical PostgreSQL path | Accepted |
| [0003](0003-offline-first-kiosk-sync.md) | Custom HLC + outbox delta sync for the front-desk kiosk | Accepted |
| [0004](0004-payment-provider-adapter.md) | Capability-based PaymentProvider adapter with idempotent webhooks | Accepted |
| [0005](0005-shared-domain-web-mobile.md) | Vue web + Expo mobile sharing Zod contracts and pure domain logic | Accepted |
| [0006](0006-multi-tenancy-and-family-hierarchy.md) | Tenant-scoped schema with graph-based family/guardian links | Accepted |

[Template](0000-template.md) · [Architecture diagrams](../README.md)
