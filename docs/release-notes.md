# Gymlytics — Release Notes

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com); the package version is `0.1.0` in every `package.json`.

> **Versioning note:** no git tags exist in this repository yet. CD publishes container images tagged with branch, tag, sha and `latest` (default branch). Use the git sha or an image digest as the authoritative deployed version until the first `v*` tag is created.

---

## [Unreleased]

Changes on `master` after the 0.1.0 baseline that have not been tagged.

### Added — 2026-11-23 (`2b45318`, "Docker container and CI/CD automation update")

- Multi-stage `Dockerfile.api` (Node 22, native `better-sqlite3`, `/data` volume, healthcheck) and entrypoint that migrates, seeds only a brand-new database, then starts the API.
- Multi-stage `Dockerfile.web` (Vite build → nginx 1.27) with an nginx template proxying `/v1` and `/health` to the API, immutable asset caching and SPA history fallback.
- `docker-compose.yml` with `api` + `web`, a named `gymlytics-data` volume, healthchecks and `web` as the only published port.
- `.github/workflows/ci.yml`: install → migrate + seed → typecheck → test → build → API smoke walkthrough → both Docker image builds (no push).
- `.github/workflows/cd.yml`: build and push both images to `ghcr.io` with branch/tag/sha/`latest` tags, plus an optional SSH deploy job gated by `DEPLOY_ENABLED=true`.
- `.dockerignore` and `.env.example` covering runtime, auth, kiosk, sync, payment-provider and notification settings.

### Documentation added with this release

- [Project Charter / SOW](project-charter.md), [PRD](prd.md), [SRS](srs.md), [SAD](sad.md), [Test Plan](test-plan.md), [Deployment & Runbook](deployment-runbook.md) and this file.

---

## [0.1.0] — 2026-11-19 (`75455b7`, "First commit")

Initial platform release: monorepo, API, all three web surfaces, Expo mobile, shared packages, tests and architecture documentation.

### Added — Platform

- pnpm 9.12 / Turborepo TypeScript monorepo with `apps/{api,web,mobile}` and `packages/{db,shared,sync,payments}`; strict TypeScript and `@gymlytics/*` path aliases.
- Drizzle schema on SQLite with a portable PostgreSQL migration path, migrations, demo seed and UUIDv7 ids.
- Fastify API with default-deny `/v1` authorisation, Zod-validated routes, change logging and `/health` + `/ready` probes.
- Multi-tenancy with `academy_id` on every domain table and graph-based `family_links` with per-edge permissions.

### Added — Academy operations

- Member roster and dossiers, PIN/QR creation, class templates/instances, booking and waitlist, attendance log and check-in/check-out.
- Programs, IBJJF belt ladders, technique library, rank requirements, class technique logs and recaps.
- Belt-eligibility evaluation, promotion history and a shared evaluator used by API, coach UI, cron alerts and mobile.

### Added — Offline kiosk and waivers

- Vue 3 kiosk with local SQLite (OPFS), transactional outbox, client-generated ids, HLC/LWW conflict handling and a visible queued/synced state.
- Idempotent `POST /v1/sync/push` with `applied_mutations`, cursor-based `GET /v1/sync/pull` with `sync_changes`, backoff and conflict acks.
- Versioned waiver templates with SHA-256 document hash, canvas e-signature, minor guardian consent, expiry, check-in/day-pass gates and PDF rendering.

### Added — Money and growth

- Membership plans, memberships, freeze/unfreeze/cancel, family pricing and unified transaction ledger.
- Payment adapters for Stripe, Billplz and iPay88 with capability-based routing, signature-verified idempotent webhooks and dunning on days 1/3/5/7/12.
- POS with idempotency and stock decrement, day passes, retail products.
- Dashboard KPIs/alerts, seven analytics views, eleven report builders, leads and incidents.
- SaaS tier plans and feature gates, onboarding, branch network rollup, CSV imports, token-gated public widgets and cross-training passes.

### Added — Clients and quality

- Vue admin console (dashboard, members, schedule, attendance, promotions, billing, POS, programs, waivers, analytics, reports, network, plan, setup, imports, embeds, curriculum, passes), public waiver flow and widget embeds.
- Expo mobile app with login, home, schedule, bookings, family, curriculum and profile tabs.
- Vitest unit suites for domain, sync and payments; API integration suites; smoke walkthrough; manual Playwright screenshot script.
- C4 architecture views (context/container/component) and ADR-0001…ADR-0006.

### Known limitations at 0.1.0

- Mobile has no offline write queue; the outbox is kiosk-only.
- Refunds for Billplz/iPay88 are handled in the provider portal, not in-app.
- No automated database backup, staging environment, leader election for jobs or mobile build pipeline.
- `PaymentRouter` is available as a library but billing routes currently pass an explicit provider.
- No browser e2e tests in CI; no load/performance test run recorded.
- See the [runbook's known gaps](deployment-runbook.md#13-known-gaps-and-follow-ups) for the follow-up list.

---

## Release procedure

1. Confirm CI is green and all P0/P1 test cases in the [Test Plan](test-plan.md) pass.
2. Complete UAT sign-off (Test Plan §10).
3. Create a `v0.1.x` tag; CD publishes stable image tags to GHCR.
4. Deploy using the [runbook](deployment-runbook.md#53-routine-release) and complete the post-deploy checklist.
5. Move the `[Unreleased]` entries into a new dated version section above, with the commit sha and image tag actually deployed.

### Section template

```markdown
## [x.y.z] — YYYY-MM-DD (`<sha>`, short description)

### Added
- ...

### Changed
- ...

### Fixed
- ...

### Known issues
- ...
```
