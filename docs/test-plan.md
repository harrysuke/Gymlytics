# Gymlytics — Test Plan & Test Cases

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Status | Baseline for 0.1.0 |
| Last updated | 2026-11-23 |
| Owner | QA lead (name TBD) |
| Related documents | [PRD](prd.md) · [SRS](srs.md) · [Deployment & Runbook](deployment-runbook.md) |

---

## 1. Purpose and scope

This plan defines the QA strategy, environments, automated coverage and manual/UAT cases for Gymlytics 0.1.0. It covers API, shared domain packages, payments, sync engine, web kiosk/admin/waiver, Expo mobile and deployment. Requirements traceability is in [SRS §8](srs.md#8-traceability-summary).

## 2. QA strategy

| Level | Scope | Owner | Automation |
| --- | --- | --- | --- |
| Unit | Pure domain functions, HLC/conflict/outbox, payment routing/webhooks/dunning | Engineers | Vitest in `packages/*/src/__tests__/` |
| Integration | API modules via `app.inject()` against a seeded copy of SQLite | Engineers | Vitest in `apps/api/src/__tests__/` |
| Smoke | End-to-end happy path against the real seeded DB | CI/ops | `apps/api/scripts/smoke.ts` |
| Contract | Zod schemas shared by all clients | Engineers | Typecheck + unit tests; a schema edit breaks all consumers |
| Browser/visual | Kiosk, admin, waiver tablet walkthrough | QA | Manual script `scripts/screenshots.mjs` (not in CI) |
| UAT | Pilot-academy workflows and sign-off | Pilot staff + product | This document, §10 |

**Risk-based priority:** P0 cases cover tenant isolation, offline check-in convergence, waiver gates, webhook idempotency and money mutations. These block release. P1 covers core workflows; P2 covers growth features and edge cases.

## 3. Test environments

| Environment | Purpose | Setup |
| --- | --- | --- |
| Local dev | Developer loop | `pnpm install` → `pnpm db:migrate` → `pnpm db:seed` → `pnpm dev`. |
| Test (automated) | CI and `pnpm test` | Vitest copies the seeded DB into `data/api-test.db` and `data/api-saas-test.db`; `fileParallelism: false`, Node environment, 30 s test / 60 s hook timeouts. |
| Container | Image/stack verification | `docker compose up --build` with `JWT_SECRET` set; web at `http://localhost:8080`. |
| Staging | **Not provisioned in 0.1.0** | Recommended before GA; use the runbook's deploy procedure with a separate host and DB volume. |
| Production | Live academy data | CD deploy job, gated by `DEPLOY_ENABLED=true`. Never run tests against it. |

## 4. Tooling and commands

| Command | Effect |
| --- | --- |
| `pnpm typecheck` | Strict TS check across the monorepo. |
| `pnpm test` | All Vitest suites via Turborepo. |
| `pnpm --filter @gymlytics/api test` | API integration suites only. |
| `pnpm --filter @gymlytics/api smoke` | Smoke walkthrough against the seeded DB. |
| `pnpm db:migrate && pnpm db:seed` | Recreate local/CI test database. |
| `pnpm build` | Build API + web; catches bundling regressions. |
| `node scripts/screenshots.mjs` | Manual Playwright/Edge visual walkthrough (fails on console errors). |
| `docker compose up --build` | Verify container stack; check `/health` and `/ready`. |

CI runs: install → migrate+seed → typecheck → test → build → smoke → both Docker image builds (`.github/workflows/ci.yml`).

## 5. Existing automated coverage

| Suite | File(s) | What is covered |
| --- | --- | --- |
| API integration A | `apps/api/src/__tests__/api.test.ts` | Health/ready; login/refresh/forged token/role denial; check-in waiver gate, staff override, mutation replay, cross-academy rejection; sync push ack/replay/conflict/pull cursor; POS idempotency; analytics role gates and `/me` isolation; all 11 reports; leads/incidents. |
| API integration B | `apps/api/src/__tests__/saas.test.ts` | Tier plans, downgrade fail-closed, onboarding idempotency, network rollup scoping, CSV imports/templates, public widgets/trial form/disable, pass waiver gate and idempotent check-in, curriculum videos/recaps, guardian scoping. |
| Domain unit | `packages/shared/src/domain/__tests__/` | Analytics helpers, mat minutes/streak, booking gates/quota/freeze, family pricing/sale/proration, belt/stripe eligibility, SaaS features/CSV parsers. |
| Payments unit | `packages/payments/src/__tests__/` | Router capability scoring, provider signature verification, replay rejection, normalisation/dispatch, dunning ladder and escalation. |
| Sync unit | `packages/sync/src/__tests__/` | HLC parse/compare/monotonicity/remote absorb; LWW/append-only/conflict; outbox enqueue/drain/acks/backoff/batch limits. |
| Smoke | `apps/api/scripts/smoke.ts` | Health, login/refresh, dashboard, members, programs, kiosk bootstrap, check-in idempotency + waiver block, waiver PDF, POS idempotency, sync push/pull, unsigned webhook rejection, eligibility. |

**Coverage gaps (0.1.0):** no automated browser e2e in CI; no mobile device/instrumentation tests; no automated DB backup/restore test; no load/performance test. These are tracked as follow-ups, not silently assumed covered.

## 6. Manual test cases

Each case lists preconditions, steps and expected results. "API" calls are made with a valid academy-scoped token unless stated. IDs are referenced by the PRD and SRS.

### TC-01 — Login and token rotation
**Pre:** Seeded academy `gymlytics-demo` with a staff user.
1. `POST /v1/auth/login` with correct slug/email/password.
2. Call `GET /v1/auth/me` with the returned access token.
3. `POST /v1/auth/refresh` with the refresh token; retry the old refresh token.
4. `POST /v1/auth/login` with a wrong password.
**Expected:** (1) 200 with tokens, user, permissions, academy. (2) 200 with matching identity. (3) New refresh token issued; old one rejected. (4) 401 and no token.

### TC-02 — Role enforcement and forged tokens
**Pre:** Student and staff tokens.
1. `GET /v1/dashboard/summary` with a student token.
2. `GET /v1/analytics/financial` with a coach token.
3. Call any `/v1/*` route with a tampered JWT.
4. Call `GET /v1/waivers/templates` with a valid student token.
**Expected:** 403 for (1) and (2); 401 for (3); 200 for (4) — read of active templates is allowed.

### TC-03 — Member creation and PIN privacy
**Pre:** Admin token.
1. `POST /v1/members` with a name and family links.
2. `POST /v1/members/:id/pin` with a 4-digit PIN.
3. `GET /v1/members/:id` and inspect the response.
**Expected:** Member, family links, QR token and change-log row created; PIN stored only as HMAC hash; no raw PIN in any response.

### TC-04 — Check-in gates and staff override
**Pre:** A student with no signed waiver; a class scheduled today.
1. `POST /v1/check-in` for that student with a PIN.
2. Sign a waiver, then repeat check-in.
3. Repeat check-in a second time.
4. As admin, check in a different student without a waiver using `method:'admin'`.
**Expected:** (1) rejected with waiver requirement. (2) check-in succeeds, booking/counters/HLC/change log updated. (3) idempotent replay returns the same result, no second attendance row. (4) allowed and change-logged with actor.

### TC-05 — Offline check-in and sync convergence (P0)
**Pre:** Kiosk paired via `POST /v1/auth/device`; member with PIN locally cached from `/v1/kiosk/bootstrap`; network controllable.
1. Disconnect the network; check in the member by PIN.
2. Reload the tablet (and, if possible, power-cycle) and inspect the Queued count.
3. Reconnect; watch the sync engine push and pull.
4. Query `GET /v1/attendance` for the class.
5. Replay the same `mutationId` directly via `POST /v1/sync/push`.
6. Push a mutation carrying a different academy id.
**Expected:** (1) instant "Queued (1)" with no network. (2) Attendance and outbox rows both survive. (3) Queue drains; "Queued (0) · Synced just now". (4) Exactly one attendance row. (5) Stored ack returned, no new row. (6) Conflict ack, no cross-tenant write.

### TC-06 — Booking capacity and membership gates
**Pre:** A class with capacity 1 and one booking; a frozen member; a student with a weekly quota plan.
1. Book the full class as a second student.
2. Cancel the first booking and retry.
3. Attempt to book as a frozen member.
4. Attempt to book as a quota-exceeded member.
5. Attempt a duplicate active booking.
**Expected:** (2) becomes `waitlisted`; (3) after cancel becomes `booked` with counter updated; frozen/quota/duplicate attempts rejected with a clear reason; counters never negative.

### TC-07 — Check-out and mat minutes
**Pre:** An active check-in.
1. `POST /v1/check-out` with the attendance id.
2. `GET /v1/me/attendance`.
3. Compare a scan with a >4 h delta and one with no check-out.
**Expected:** Status `checked_out`, timestamp set; history shows the row; mat minutes capped at 4 h and fallback to class length for missing check-out.

### TC-08 — Waiver signing, hash, guardian and PDF (P0)
**Pre:** Active waiver template; a minor user and a guardian link; a drop-in user.
1. `GET /v1/waivers/templates` and note the active version/hash.
2. Submit a signature with a mismatched hash.
3. Submit with the correct hash as the guardian for the minor.
4. Submit a duplicate for the same (user, type, version).
5. `GET /v1/waivers/:id/pdf`; attempt a day pass for the unsigned drop-in.
6. Advance time past the drop-in expiry and retry check-in.
**Expected:** (2) rejected; (3) stored with signer IP, UA, DOB snapshot and guardian id; (4) rejected as duplicate; PDF renders the stored version with signature; day pass/check-in blocked until signed; expired waiver no longer satisfies the gate.

### TC-09 — Program ladder and eligibility
**Pre:** Owner token; a student with attendance and promotion history.
1. `POST /v1/programs` for `gi_bjj`.
2. Inspect ranks; add a custom rank and technique requirement.
3. `GET /v1/promotions/eligibility` and `GET /v1/me/progression` for the same student.
4. Trigger/observe a belt-eligibility notification scan.
**Expected:** IBJJF ladder seeded; custom rank/requirement saved; both endpoints report identical eligibility from the shared evaluator; at most one notification per (user, rank).

### TC-10 — Promotion record and audit
**Pre:** Coach token; eligible student.
1. `POST /v1/promotions` with from/to rank and stripe.
2. Repeat the identical request.
3. Inspect the member dossier and promotion history.
**Expected:** Immutable row with class/mat-hour snapshots; duplicate rejected; dossier shows the promotion; history is retained for audit.

### TC-11 — POS, plan purchase and token-only storage
**Pre:** Owner/staff token; active plan and retail product.
1. `POST /v1/billing/pos` with an idempotency key and one line item.
2. Replay the same key; submit an unknown product and an empty cart.
3. `POST /v1/billing/memberships` with a hosted provider and with manual payment.
4. Inspect `payment_methods` data surface.
**Expected:** One sale and one stock decrement; replay is a no-op; invalid carts rejected; hosted membership is `pending_payment`, manual is `active`; only provider tokens and brand metadata are stored — no PAN/CVV.

### TC-12 — Webhook signature and replay (P0)
**Pre:** Provider webhook secret configured; captured webhook fixtures.
1. Send a valid Stripe event; send the same `event_id` again.
2. Send a Billplz callback with an invalid `X-Signature`.
3. Send an iPay88 event with a valid signature and a stale timestamp.
4. Inspect `webhook_events` and membership state.
**Expected:** (1) first event applies once, replay returns 200 with no side effects; (2) 4xx and no ledger row; (3) rejected per provider rules; ledger records provider, event id, signature validity, status/attempts/last error.

### TC-13 — Dunning ladder and job control
**Pre:** A membership with a saved payment method and a simulated failed charge.
1. Run/observe the dunning job for a due retry.
2. Simulate success on a later attempt; simulate final failure after attempt 5.
3. Set `JOBS_ENABLED=false` on a second API instance and observe timers.
**Expected:** Attempts occur on days 1/3/5/7/12 with `retry-<id>` keys; success activates membership and marks transaction succeeded; final failure marks past-due/cancelled/abandoned as configured; no timers run on the disabled instance.

### TC-14 — Guardian scoping and permissions
**Pre:** Two guardians linked to one child, one with `can_book_classes=false`.
1. `GET /v1/family/dependents` as each guardian.
2. Request the child's schedule and progression as each guardian.
3. Attempt a booking on the child's behalf with the restricted guardian.
4. Attempt access to an unlinked child.
**Expected:** Each guardian sees only their dependents with their flags; allowed reads succeed; restricted guardian cannot book; unlinked child returns 404/403.

### TC-15 — Dashboard and analytics access
**Pre:** Owner, coach, student tokens; seeded data.
1. `GET /v1/dashboard/summary` as owner.
2. `GET /v1/analytics/overview`, `progression`, `attendance`, `retention`, `leads`.
3. `GET /v1/analytics/financial` as coach; as owner.
4. Compare MRR/revenue/attendance figures with the underlying ledgers.
**Expected:** KPIs and alerts present; staff views render; coach denied financial; owner allowed; figures reconcile with transactions/attendance.

### TC-16 — Self analytics isolation
**Pre:** Two student accounts with different data.
1. `GET /v1/analytics/me` as student A.
2. Request `GET /v1/analytics/member/:userId` for student B as student A.
3. Request a report slug as a student.
**Expected:** (1) only A's data; (2) 403; (3) 403 — reports are staff-only.

### TC-17 — Reports, leads and incidents
**Pre:** Staff token; seeded data including leads and incidents.
1. `GET /v1/reports` and check the 11 slugs.
2. Call each `GET /v1/reports/:slug` and inspect rows/columns.
3. `POST /v1/leads` via widget trial form and via staff route.
4. `POST /v1/incidents` and verify it appears in the incident-log report.
**Expected:** Catalog matches definitions; all 11 build without error; trial submissions create leads; incidents appear in the report.

### TC-18 — Curriculum logging and recaps
**Pre:** Coach token; a scheduled class and a technique.
1. `POST /v1/classes/:id/techniques`.
2. `PUT /v1/classes/:id/recap`.
3. `GET /v1/me/recaps` as an attendee.
4. Delete the video via `DELETE /v1/curriculum/videos/:id`.
**Expected:** Technique and recap stored; attendee sees the recap; deletion removes the video; duplicate technique per class rejected.

### TC-19 — Mobile core flows
**Pre:** Expo app pointed at a reachable API; student account.
1. Log in and confirm tokens persist in Secure Store.
2. Home shows progression and bookings; Schedule shows classes.
3. Book and cancel a class; Family tab shows dependents.
4. Switch to airplane mode and attempt a booking.
**Expected:** Screens load with correct data; booking/cancellation reflected; network failure shows a retryable error — no silent offline queue in 0.1.0.

### TC-20 — Freeze, unfreeze, cancel and provider routing
**Pre:** Active membership with a freeze allowance.
1. Freeze for more days than the annual allowance.
2. Freeze for a valid window, then unfreeze.
3. Cancel with a reason; observe provider cancellation when supported.
4. Exercise `PaymentRouter.select()` for MYR online banking, non-MY card and a subscription without a recurring-capable provider.
**Expected:** (1) clamped to allowance with min 1 day; (2) period end extended by remaining days; (3) local and provider state align; (4) Billplz/Stripe/iPay88 selected per rules, explicit "no provider" error when unsupported.

### TC-21 — Family pricing
**Pre:** A family plan with discount and `maxDependents`.
1. Compute a total for a guardian plus two children.
2. Add a fourth dependent.
3. Inspect `transactions.payerId` vs `userId`.
**Expected:** Additional seats discounted and capped; extra dependent not discounted/admitted per plan; payer recorded separately from beneficiary.

### TC-22 — SaaS gates, network, imports, widgets and passes
**Pre:** Owner token; starter and higher-tier academies.
1. Create a widget and embed code; downgrade below the `widgets` feature.
2. Attempt CSV import and cross-training pass creation on the starter tier.
3. Complete an onboarding step twice.
4. Create a branch and view network overview as branch admin.
5. Submit a public trial form; disable the widget and retry.
6. Issue a pass, attempt visitor check-in without and with a waiver; replay check-in.
**Expected:** (1)(2) gated features fail closed after downgrade; (3) step counted once; (4) branch admin sees only own subtree; (5) trial creates a lead, disabled widget stops public access; (6) waiver gate enforced, check-in idempotent.

### TC-23 — Container health and deployment smoke
**Pre:** `docker compose up --build` with a strong `JWT_SECRET`.
1. `curl /health` and `/ready` through port 8080.
2. Load the SPA, log in, open `/admin/analytics` directly (history fallback).
3. Inspect image tags and `gymlytics-data` volume.
4. Re-run compose with an existing volume and confirm no demo re-seed.
**Expected:** Both endpoints healthy; SPA and deep link load; images tagged as configured; data volume persists and seed is skipped on an existing DB.

### TC-24 — Rollback and job-disable drill
**Pre:** Two published image tags (current and previous); staging host.
1. Record the current `IMAGE_TAG`.
2. Set `IMAGE_TAG` to the previous release and `docker compose up -d`.
3. Verify `/health`, login and a check-in.
4. Restore the previous tag; confirm `JOBS_ENABLED=false` prevents timer ownership on an extra API process.
**Expected:** Rollback completes without data loss; core flows pass on the old tag; no duplicate jobs from the extra process.

## 7. Defect management

| Severity | Definition | Response |
| --- | --- | --- |
| S1 Critical | Cross-tenant data exposure, duplicate money effect, lost attendance, production down | Stop release; fix and re-run P0 cases. |
| S2 High | Core workflow blocked with no workaround | Fix before UAT sign-off. |
| S3 Medium | Workflow degraded, workaround exists | Fix or explicitly defer with product approval. |
| S4 Low | Cosmetic or documentation issue | Backlog. |

Document defects with: environment, build/tag, steps, expected vs actual, logs (redact tokens/PII), severity and owner.

## 8. Entry and exit criteria

**Entry to UAT:** CI green; all P0 cases passed; seeded demo data available; kiosk tablet and waiver tablet prepared; known S1/S2 defects closed.

**Exit / release gate:** All P0 and P1 cases passed; all S1/S2 defects closed; P2 defects either fixed or accepted in writing; UAT sign-off table complete; release notes entry published; rollback drill (TC-24) passed.

## 9. Test data and environment hygiene

- Use the seeded demo academy (`gymlytics-demo`) for tests; never production data.
- Integration tests copy the seeded DB; `data/` is gitignored and must be regenerated on each CI runner.
- Rotate `KIOSK_DEVICE_KEY` and `JWT_SECRET` after a compromised test device.
- Redact signatures, medical notes and token values from logs and bug reports.

## 10. User Acceptance Testing (UAT)

Pilot participants: academy owner, front-desk staff, coach, guardian. Duration and dates: **TBD by sponsor**.

| # | UAT scenario | Participant | Pass criteria | Result | Sign-off |
| --- | --- | --- | --- | --- | --- |
| U1 | Open the academy, add a member and set a PIN | Owner | Member appears in roster; PIN works at kiosk | ☐ Pass ☐ Fail | |
| U2 | Run a normal front-desk check-in and check-out | Front desk | Instant confirmation; attendance log correct | ☐ Pass ☐ Fail | |
| U3 | Check in with Wi-Fi off, then reconnect | Front desk | Queue visible; no duplicates after sync | ☐ Pass ☐ Fail | |
| U4 | Book a class and cancel from mobile | Student | Booking and cancellation reflected in roster | ☐ Pass ☐ Fail | |
| U5 | Sign a minor's waiver on the tablet | Guardian | Signature accepted; PDF retrievable | ☐ Pass ☐ Fail | |
| U6 | Record a promotion after eligibility appears | Coach | Eligibility matches expectation; history written | ☐ Pass ☐ Fail | |
| U7 | Purchase a plan and a retail item | Owner | Payment/POS completes once; ledger correct | ☐ Pass ☐ Fail | |
| U8 | Review dashboard, one analytics view and one report | Owner | Figures match the pilot's own records | ☐ Pass ☐ Fail | |
| U9 | Approve a failed-payment retry outcome | Owner | Dunning result and membership state correct | ☐ Pass ☐ Fail | |

**UAT sign-off**

| Role | Name | Signature | Date | Decision |
| --- | --- | --- | --- | --- |
| Academy owner / sponsor | | | | Accept / Reject |
| Front-desk representative | | | | Accept / Reject |
| Coach representative | | | | Accept / Reject |
| QA lead | | | | Accept / Reject |
| Product lead | | | | Accept / Reject |

Open items / accepted deviations: ______________________________________________
