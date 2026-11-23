# Architecture documentation

Views follow the [C4 model](https://c4model.com): Context → Container → Component.
Diagrams are Mermaid `C4*` diagrams and render in GitHub, GitLab and most Markdown viewers.

| Level | Question it answers | Document |
| --- | --- | --- |
| L1 Context | Who uses the platform, what external systems exist? | [system-context.md](architecture/c4-context.md) |
| L2 Container | Which apps/services/databases make up the platform? | [containers.md](architecture/c4-container.md) |
| L3 Component | How does the offline kiosk sync actually work? | [kiosk-sync-components.md](architecture/c4-component-kiosk-sync.md) |
| Decisions | Why these choices, and what did we reject? | [ADR index](adr/README.md) |

## Architectural at a glance

1. **One codebase, three clients.** Vue web (admin + kiosk + waiver), Expo mobile and the
   Fastify API all consume `@gymlytics/shared` for Zod contracts and pure domain logic.
2. **Two databases, one schema.** The API writes SQLite via Drizzle today; the kiosk keeps a
   subset of the same DDL in a browser SQLite file (OPFS). Column types are chosen so a
   PostgreSQL dialect swap is mechanical.
3. **Attendance is append-only and client-identified.** UUIDv7 ids + mutation ids are created
   on the tablet before the network is involved. An outbox row commits in the same local
   transaction as the check-in.
4. **Payments are capability-routed.** Business code calls `PaymentProvider`; the router picks
   Stripe, Billplz or iPay88 based on currency, country and recurring capability.
5. **Everything that mutates money is idempotent.** Webhooks use a unique `(provider, event_id)`
   ledger; mutations use an `applied_mutations` ledger; POS/checkout use idempotency keys.

## Key quality attributes

| Attribute | Mechanism |
| --- | --- |
| Availability at the front desk | Local SQLite + outbox; check-in never blocks on Wi-Fi |
| Data integrity on reconnect | Mutation-id dedupe, HLC/LWW, conflict flags, tombstones |
| PCI scope reduction | Only provider tokens stored; no PAN/CVV in our database |
| Multi-tenancy | `academy_id` on every domain table; scoped queries in every route |
| Testability | Pure domain functions; injectable `LocalDatabase`, `SyncTransport`, `Notifier` |

## Product and delivery documentation

| Document | What it answers |
| --- | --- |
| [Project Charter / SOW](project-charter.md) | Why the project exists, scope, deliverables, milestones, budget structure, stakeholders and sign-off. |
| [Product Requirements Document](prd.md) | Who the product serves, which features are in scope, and testable user stories. |
| [Software Requirements Specification](srs.md) | Exact functional and non-functional requirements with PRD/test traceability. |
| [Software Architecture Document](sad.md) | Tech stack, runtime and data flows, API surface and database schema. |
| [Test Plan & Test Cases](test-plan.md) | QA strategy, environments, automated coverage, 24 step-by-step cases and UAT sign-off. |
| [Deployment & Runbook](deployment-runbook.md) | CI/CD, configuration, deployment, database backup/restore, rollback and troubleshooting. |
| [Release Notes](release-notes.md) | What changed in each release and how a release is published. |

Architecture views (C4 and ADRs) remain the authoritative source for design decisions; the documents above reference them rather than duplicating them.

## End-user help

These three guides are written for non-technical users and are the ones to share with academy staff, members and guardians.

| Document | What it covers |
| --- | --- |
| [End-User Manual](end-user-manual.md) | Onboarding tutorials, role-based walkthroughs for the staff console, kiosk, waiver tablet, mobile app, family portal and widgets, plus everyday recipes and a glossary. |
| [FAQ](faq.md) | Short answers about accounts, bookings, waivers, billing, family access, reports and the mobile app. |
| [Self-Service Troubleshooting](troubleshooting.md) | Symptom-based fixes for sign-in, kiosk, waiver, booking and widget problems, known limits and an escalation checklist. |
