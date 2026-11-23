# Gymlytics — Project Charter / Statement of Work (SOW)

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Status | Approved for planning |
| Last updated | 2026-11-23 |
| Product version | 0.1.0 (pre-GA) |
| Sponsor | Academy owner / product sponsor (name TBD) |
| Project lead | Technical lead (name TBD) |
| Related documents | [PRD](prd.md) · [SRS](srs.md) · [SAD](sad.md) · [Test Plan](test-plan.md) · [Deployment & Runbook](deployment-runbook.md) · [Release Notes](release-notes.md) · [Architecture index](README.md) |

> This charter describes the project as it exists in the repository at `v0.1.0`. Where a number or owner is not recorded in the repository (for example the approved budget or named individuals), the field is marked **TBD** rather than invented.

---

## 1. Business case

Martial-arts academies run on a mixture of spreadsheets, messaging apps and paper waivers. Front-desk check-in stops when the Wi-Fi drops; belt progression is tracked by memory; guardians pay for children but cannot see their progress; recurring payments fail silently; and owners have no reliable view of attendance, revenue or retention.

Gymlytics is a single platform that combines academy operations, offline-first check-in, curriculum and belt progression, e-signed waivers, billing/POS and analytics. It is sold as a multi-tenant SaaS to academies, with an optional network of branch locations.

## 2. Project purpose and objectives

| # | Objective | Measurable success criterion |
| --- | --- | --- |
| O1 | Keep the front desk running without network | A check-in is committed locally and shown instantly; queued mutations survive reload and power loss; replay after reconnect never double-counts attendance (verified by integration test). |
| O2 | One source of truth across four clients | Web admin, kiosk, waiver flow, Expo mobile and API all consume `@gymlytics/shared` Zod contracts and pure domain functions; one typecheck run catches contract drift. |
| O3 | Reduce payment and billing operations | Idempotent webhooks, provider adapters (Stripe, Billplz, iPay88) and a dunning schedule (days 1, 3, 5, 7, 12) with no manual double-extension of memberships. |
| O4 | Make progression and compliance auditable | Versioned curriculum, immutable promotion history, SHA-256-hashed waiver text, guardian attribution and on-demand signed PDF. |
| O5 | Give owners actionable visibility | Dashboard plus 7 analytics views and 11 on-demand reports, all tenant-scoped. |
| O6 | Ship safely and repeatably | CI verifies typecheck, tests, build, smoke walkthrough and both Docker images on every PR; CD publishes images and can deploy with a documented rollback path. |

## 3. Scope

### 3.1 In scope (delivered in 0.1.0)

- **Identity & tenancy** — academy slug login, refresh rotation, hashed PINs, kiosk device pairing, 7 roles, guardian→dependent links with per-edge permissions.
- **Members & scheduling** — member roster/dossiers, class templates and instances, booking/waitlist, capacity and membership-quota checks, attendance log with check-in/check-out.
- **Offline kiosk** — Vue PWA with local SQLite (OPFS), transactional outbox, HLC ordering, idempotent push, cursor pull, LWW/conflict flags and a visible "Queued" state.
- **Curriculum & progression** — programs, IBJJF belt ladders, techniques, requirements, class technique logs, recaps, eligibility evaluation, promotion records.
- **Waivers** — versioned templates with document hash, canvas e-signature, minor guardian consent, expiry, verification gate at check-in/day-pass, PDF rendering.
- **Billing & retail** — plans, memberships, freeze/unfreeze, cancellation, POS with idempotency, day passes, family pricing, unified transaction ledger, payment-method tokens only.
- **Analytics & reporting** — overview, progression, attendance, retention, financial, leads, member drilldown; 11 report builders; dashboard alerts.
- **Intake & compliance** — lead funnel, incident log.
- **SaaS & growth** — tier plans and feature gates, onboarding checklist, multi-site network rollup, CSV imports, public embeds/widgets, cross-training passes/affiliations.
- **Mobile** — Expo student/guardian app: login, home, schedule/booking, bookings, family, curriculum, profile.
- **Operations** — in-process job runner (reminders, eligibility scan, dunning), notification queue, Docker images, GitHub Actions CI/CD.

### 3.2 Explicitly out of scope for 0.1.0

- Offline write queue on mobile (mobile is read/book online only; the outbox exists in the web kiosk).
- Automated refunds for Billplz/iPay88 (staff use the provider portal).
- Automated database backup/restore, staging environment, leader election for the job runner, mobile build-and-submit pipeline (see [Runbook, Known gaps](deployment-runbook.md#14-known-gaps-and-follow-ups)).
- PostgreSQL runtime, Kubernetes/Helm, video hosting infrastructure (videos are URL references).
- Raw card data storage (PAN/CVV never enter the database).

## 4. Deliverables

| Deliverable | Repository location |
| --- | --- |
| Fastify API with tenant-scoped REST + sync routes | `apps/api/src/` |
| Vue 3 admin, kiosk, waiver and public-widget surfaces | `apps/web/src/` |
| Expo mobile app | `apps/mobile/src/` |
| Shared contracts/domain, sync engine, payments, Drizzle schema | `packages/{shared,sync,payments,db}/src/` |
| Migrations and demo seed | `packages/db/src/` |
| C4 architecture views and ADRs | `docs/architecture/`, `docs/adr/` |
| Product/requirements/architecture/test/ops docs | `docs/*.md` (this document set) |
| Unit, integration and smoke tests | `**/*.test.ts`, `apps/api/scripts/smoke.ts` |
| Container images and CI/CD workflows | `Dockerfile.api`, `Dockerfile.web`, `docker-compose.yml`, `.github/workflows/` |

## 5. Milestones

| Milestone | Status | Evidence / target |
| --- | --- | --- |
| M0 — Foundation & domain core | Complete | `First commit` (2026-11-19): monorepo, Drizzle schema, shared contracts, kiosk sync, API modules. |
| M1 — Client surfaces | Complete | Vue admin/kiosk/waiver/views and Expo screens present in the initial commit. |
| M2 — Quality & delivery automation | Complete | `Docker container and CI/CD automation update` (2026-11-23): Dockerfiles, compose, CI/CD workflows. |
| M3 — UAT & sign-off | Planned | Execute [UAT sign-off](test-plan.md#10-user-acceptance-testing-uat) with pilot academy. Date TBD by sponsor. |
| M4 — Production release 0.1.0 | Planned | Tag `v0.1.0`; CD publishes images; deploy job enabled via `DEPLOY_ENABLED=true`. Date TBD. |
| M5 — PostgreSQL migration evaluation | Backlog | See [ADR-0002](adr/0002-drizzle-sqlite-to-postgres.md). Trigger: write contention or analytics growth. |

## 6. Budget and resourcing

No approved budget is recorded in the repository. The table below is the budget **structure** to be completed by the sponsor before M3; no figures are asserted here.

| Cost category | Basis | Approved amount |
| --- | --- | --- |
| Engineering (design, implementation, QA) | TBD — team size and rate card | TBD |
| Infrastructure (server, domain, TLS, object storage) | TBD — hosting provider | TBD |
| Payment gateway setup & transaction fees | Per provider merchant agreement | TBD |
| SMS/email (Twilio, SendGrid) | Usage-based | TBD |
| External pen test / legal review of waivers | TBD — required before GA in some jurisdictions | TBD |
| Contingency | TBD — recommended 10–15% | TBD |

Sign-off on this charter implies agreement on the scope above and authority to fill the TBD fields before the UAT gate.

## 7. Stakeholders and RACI

R = Responsible, A = Accountable, C = Consulted, I = Informed. Names are not stored in the repository; roles are.

| Activity | Academy owner (Sponsor) | Product lead | Tech lead / engineers | QA lead | Academy staff (pilot) |
| --- | --- | --- | --- | --- | --- |
| Approve charter / scope changes | **A** | R | C | C | I |
| Prioritise user stories | C | **A/R** | C | C | C |
| Architecture & technical decisions | I | C | **A/R** | C | I |
| Requirements & acceptance criteria | C | **A/R** | C | C | C |
| Implement & unit test | I | I | **A/R** | C | I |
| Test plan execution | I | C | C | **A/R** | C |
| UAT and sign-off | **A** | R | C | R | R |
| Production deployment approval | **A** | C | R | C | I |
| Incident response in production | I | C | **A/R** | C | I |

## 8. Constraints, assumptions and risks

| Type | Item | Mitigation / owner |
| --- | --- | --- |
| Constraint | Web stack is Vue 3 + TypeScript + Tailwind; mobile is Expo/React Native. | Shared logic lives in `@gymlytics/shared`, never in UI components (ADR-0005). |
| Constraint | SQLite has a single writer. | WAL mode, short transactions, one API writer process; PostgreSQL path documented (ADR-0002). |
| Constraint | OPFS availability varies by browser. | Managed Chromium kiosk; in-memory fallback for development only (ADR-0003). |
| Constraint | PCI scope must stay low. | Provider tokens only; no PAN/CVV stored (ADR-0004). |
| Assumption | Pilot academy has stable power at the front desk; network may be intermittent. | Outbox + HLC design; test case TC-05 exercises reconnect. |
| Assumption | Guardians can be identified by email/PIN/QR; minors may not have email. | One `users` table with family links and PIN/QR auth (ADR-0006). |
| Risk | Missing `academy_id` predicate causes cross-tenant leakage. | Repository scoping helpers and integration tests; RLS after PostgreSQL migration. |
| Risk | Provider signature schemes change. | Adapter-local verification plus captured webhook fixtures (ADR-0004). |
| Risk | Single scheduler process owns timers; no leader election yet. | `JOBS_ENABLED=false` on any second API instance; leader election backlog. |
| Risk | No automated DB backup on the production volume. | Documented manual backup procedure; automation is M4+ follow-up. |

## 9. Change control and acceptance

1. Changes to scope, budget or milestone dates require sponsor approval recorded against this document's version.
2. Requirements changes flow through [PRD](prd.md) → [SRS](srs.md) → [Test Plan](test-plan.md) so acceptance criteria stay traceable.
3. Architecture-significant changes require a new ADR in `docs/adr/` (template: [0000](adr/0000-template.md)).
4. Acceptance for M3/M4 requires: CI green, all P0/P1 test cases passed, UAT sign-off table completed, and a published release-note entry.

## 10. Sign-off

| Role | Name | Decision | Date |
| --- | --- | --- | --- |
| Sponsor / Academy owner | TBD | Approved / Rejected | TBD |
| Product lead | TBD | Approved / Rejected | TBD |
| Technical lead | TBD | Approved / Rejected | TBD |
| QA lead | TBD | Approved / Rejected | TBD |
