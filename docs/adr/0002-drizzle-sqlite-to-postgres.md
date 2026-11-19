# ADR-0002: Drizzle ORM on SQLite with a mechanical PostgreSQL path

- **Status:** Accepted
- **Date:** 2026-11-19
- **Deciders:** Principal Architect

## Context

A single academy needs a cheap, zero-ops database: SQLite is ideal for a small gym, a
front-desk kiosk and local development. But a successful multi-academy SaaS eventually
needs PostgreSQL for connection pooling, replication and larger analytical queries. We do
not want to rewrite the schema at that point.

We also need the kiosk's local SQLite to have *the same shape* as the server database so
remote changes can be applied with a generic upsert.

## Decision

Use **Drizzle ORM** with `drizzle-orm/sqlite-core` now, and constrain the schema to a
portable subset:

- All ids are `text` UUIDs (UUIDv7 for client-created rows) — never autoincrement.
- Timestamps are ISO-8601 `text`; booleans are `integer(mode:'boolean')`; money is integer
  minor units; enums are `text({ enum: [...] })`; JSON is `text(mode:'json')`.
- No SQLite-only DDL: no STRICT tables, generated columns, or SQLite-specific triggers.
- Column helpers live in `packages/db/src/schema/_shared.ts` so dialect mapping is centralised.
- A future migration swaps imports to `drizzle-orm/pg-core`, maps `text id → uuid`,
  `integer boolean → boolean`, regenerates migrations, and runs a one-off ETL. Because ids
  and ISO timestamps are preserved, sync cursors survive the cutover.

## Consequences

### Positive

- Kiosk and server share the DDL subset; no field-name drift on sync.
- Client-generated ids are safe to merge — the single most important property for offline.
- Drizzle is typesafe and thin; queries are inspectable SQL, no hidden runtime magic.

### Negative / risks

- SQLite has one writer. Mitigation: WAL mode, short transactions, and a single API process
  initially; move to PostgreSQL before write contention becomes visible.
- `onConflictDoNothing()` plus explicit idempotency ledgers is required — SQLite will not
  enforce cross-table invariants for us.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Prisma | Generated client is heavier to share with a browser kiosk; raw SQL escape hatch less direct |
| PostgreSQL from day one | Ops overhead disproportionate for a single academy; poor local/offline story |
| MongoDB | Relational curriculum/promotion/billing data does not benefit from a document store |
