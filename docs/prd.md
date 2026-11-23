# Gymlytics — Product Requirements Document (PRD)

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Status | Baseline for 0.1.0 |
| Last updated | 2026-11-23 |
| Product version | 0.1.0 |
| Owner | Product lead (name TBD) |
| Related documents | [Charter / SOW](project-charter.md) · [SRS](srs.md) · [SAD](sad.md) · [Test Plan](test-plan.md) |

---

## 1. Product vision

> For martial-arts academies, Gymlytics is an offline-tolerant operating system that keeps the front desk moving, makes progression and waivers auditable, and turns attendance and billing data into decisions — without asking staff to change how they run a class.

## 2. Product objectives

| # | Objective | User outcome | Success measure |
| --- | --- | --- | --- |
| P1 | Instant, network-independent check-in | Staff never turn a student away because Wi-Fi is down | 100% of offline check-ins commit locally and converge with zero duplicates (TC-05). |
| P2 | Self-service for students and guardians | Members book, track stripes and pay without messaging staff | Booking and progression available on web and mobile. |
| P3 | Household-aware billing and consent | A parent pays for and signs for multiple children | Family links with per-edge `can_sign_waivers` / `can_book_classes` / `can_view_progress`. |
| P4 | Auditable compliance | Versioned waiver text, guardian attribution, signed PDF | Every signed waiver resolves to a hash and a rendered PDF. |
| P5 | Operational insight | Owners see KPIs, cohort retention and revenue mix | Dashboard + 7 analytics views + 11 reports. |
| P6 | Multi-tenant SaaS readiness | One deployment serves many academies and branch networks | All domain rows scoped by `academy_id`; feature gates by tier. |

## 3. Target audience and personas

| Persona | Goal | Surfaces | Key constraints |
| --- | --- | --- | --- |
| **Student** (adult or teen) | Book classes, see mat hours/stripes, sign waivers | Mobile app, web, waiver tablet | Limited time; may train on a drop-in basis. |
| **Guardian / payer** | Pay for dependents, sign minor waivers, view child progress | Web family portal, mobile Family tab | May not train; needs explicit per-child permission. |
| **Coach / front-desk staff** | Check in quickly, run the roster, log techniques, approve promotions | Kiosk tablet, admin console | Network may be unreliable; speed matters more than features. |
| **Academy owner / admin** | Configure programs, plans, staff, pricing and network | Admin console | Needs financial and retention reporting; owns billing. |
| **Branch admin** | Run one location within a network | Admin console (scoped) | Must only see own subtree. |
| **Prospective member** | Find a class, submit a trial request, sign a drop-in waiver | Public widget embeds | No account yet. |

## 4. Feature inventory

| Epic | Capabilities in 0.1.0 |
| --- | --- |
| E1 Identity & tenancy | Academy-slug login, access/refresh rotation, device pairing with shared key, role-based permissions, guardian links, PIN/QR/password auth. |
| E2 Members & scheduling | Roster and dossier, programs and belt ranks, class templates/instances, bookings/waitlist, capacity and quota gates, attendance log. |
| E3 Offline kiosk | Local SQLite + OPFS, transactional outbox, HLC/LWW, idempotent batch push, cursor pull, conflict flags, visible sync state, drop-in registration. |
| E4 Curriculum & progression | Technique library, rank requirements, class technique logs and recaps, eligibility evaluator, promotion history. |
| E5 Waivers | Versioned templates with SHA-256 hash, canvas signature, minor guardian consent, duplicate/expiry rules, check-in gate, PDF rendering. |
| E6 Billing & retail | Plans, memberships, freeze/unfreeze, cancellation reasons, Stripe/Billplz/iPay88 adapters, idempotent webhooks, dunning, POS, day passes, family pricing, retail stock. |
| E7 Analytics & reporting | Dashboard KPIs/alerts, 7 analytics views, member drilldown, 11 reports, lead and incident tracking. |
| E8 SaaS & growth | Tier plans/feature gates, onboarding progress, multi-site network rollup, CSV imports, widgets/embeds, cross-training affiliations and passes, curriculum videos. |

## 5. User stories and acceptance criteria

Priorities: **P0** = release-blocking, **P1** = high, **P2** = desirable. Each story references the API surface in the [SAD](sad.md#7-api-surface) and a test case in the [Test Plan](test-plan.md).

### E1 — Identity, tenancy and family

**US-001 (P0) — Academy-scoped login and token rotation**
As a staff member, I want to log in with my academy slug and credentials so that I only ever see my academy's data.
- AC1: `POST /v1/auth/login` returns access + refresh tokens, the user, their permission map and academy.
- AC2: Wrong password is rejected without a token; `POST /v1/auth/refresh` rotates the refresh token and revokes the old one.
- AC3: A forged or expired access token is rejected on any `/v1/*` route; `/v1/webhooks/*` and public widget/pass routes are the only unauthenticated exceptions.
- AC4: Roles are limited to `owner`, `admin`, `coach`, `staff`, `student`, `guardian`, `dropin`.
- Verification: TC-01, TC-02.

**US-002 (P0) — Kiosk device pairing**
As a front-desk lead, I want to pair a tablet once so that it can check people in without a staff login at every shift.
- AC1: `POST /v1/auth/device` accepts academy slug + `KIOSK_DEVICE_KEY` + `deviceId` and returns a scoped `role:'kiosk'`, `typ:'device'` token.
- AC2: Device tokens expire per `DEVICE_TOKEN_TTL_SECONDS` (default 12 h) and must match `X-Device-Id` on sync pull.
- Verification: TC-05.

**US-003 (P1) — Guardian manages dependents**
As a guardian, I want to see and book for my children so that I can manage the household in one place.
- AC1: `GET /v1/family/dependents` returns only linked children, with their permissions and membership status.
- AC2: Schedule and progression endpoints call `assertGuardianAccess`; a guardian without `can_book_classes` cannot book on a child's behalf.
- AC3: A child can have multiple guardians; permissions are per `family_links` edge.
- Verification: TC-14.

**US-004 (P1) — Member records and PINs**
As an admin, I want to create members with QR/PIN credentials so that children and drop-ins without email can check in.
- AC1: `POST /v1/members` creates a user, optional family links, a QR token and a change-log row.
- AC2: `POST /v1/members/:id/pin` stores only an HMAC hash; raw PINs are never returned by the API.
- AC3: `GET /v1/members/:id` returns a dossier with guardians, dependents, memberships, waivers, promotions and attendance count.
- Verification: TC-03.

### E2 — Scheduling and attendance

**US-005 (P0) — Browse and book a class**
As a student, I want to see spots left and book or join a waitlist so that I know whether I can attend.
- AC1: `GET /v1/classes` returns classes in a date window with computed `spotsLeft`.
- AC2: `POST /v1/classes/:id/bookings` rejects cancelled/started classes, honours family permissions and calls `assertCanBook` (freeze, past-due, expiry, weekly quota).
- AC3: At capacity the booking becomes `waitlisted`; `DELETE /v1/bookings/:id` cancels and decrements counters.
- Verification: TC-06.

**US-006 (P0) — Kiosk check-in with compliance gates**
As front-desk staff, I want to check in by PIN, QR or name search so that the queue moves quickly.
- AC1: `POST /v1/check-in` supports `pin`, `qr`, `name_search`, `admin`, `mobile`, `guardian` methods.
- AC2: A member without a current signed waiver or an active membership is blocked unless the caller uses `method:'admin'` (staff override, change-logged).
- AC3: Check-in is idempotent by `mutationId`; a replay returns the original result and never creates a second attendance row for the same class/user.
- AC4: Booking status, class `checked_in_count`, HLC and change log are updated atomically with the attendance row.
- Verification: TC-04, TC-05.

**US-007 (P1) — Check-out and attendance history**
As a coach, I want to check students out and review the log so that mat time and no-shows are accurate.
- AC1: `POST /v1/check-out` sets `checked_out_at` and status `checked_out`.
- AC2: `GET /v1/attendance` filters by academy, date, class and user; `GET /v1/me/attendance` returns the caller's last 50 check-ins.
- AC3: `computeMatMinutes` caps a real scan delta at 4 hours and falls back to class length for missing check-outs.
- Verification: TC-07.

**US-008 (P2) — Class curriculum logging**
As a coach, I want to record techniques taught so that students can see what they learned.
- AC1: `POST /v1/classes/:id/techniques` logs a technique against a class with `taughtBy`.
- AC2: `GET/PUT /v1/classes/:id/recap` upsert a recap; `GET /v1/me/recaps` lists recaps for classes the caller attended.
- Verification: TC-18.

### E3 — Offline kiosk sync

**US-009 (P0) — Check in with the network down**
As front-desk staff, I want check-in to work with no Wi-Fi so that the queue never stops.
- AC1: The kiosk keeps a subset of the server DDL in browser SQLite (OPFS); PIN lookup is local.
- AC2: Attendance row and `sync_outbox` row commit in the **same** transaction; there is no state where one exists without the other.
- AC3: The UI shows "Queued (n)" immediately and `SyncState` (`online`, `queued`, `conflicts`, `lastSyncedAt`) updates on reconnect.
- AC4: The outbox survives reload and power loss.
- Verification: TC-05.

**US-010 (P0) — Converge without duplicates on reconnect**
As a system, I want offline mutations applied exactly once so that attendance and money are never counted twice.
- AC1: `POST /v1/sync/push` accepts batches of 100, checks `applied_mutations` by `mutationId` first and returns the stored ack on replay.
- AC2: Retries use exponential backoff from 1 s to 60 s with jitter; a lost response is harmless.
- AC3: `GET /v1/sync/pull?since=<hlc>` returns changes newer than the device cursor, excludes rows authored by that device, and advances `sync_cursors`.
- AC4: HLC `<ISO>-<counter>-<deviceId>` plus device-id tie-break gives deterministic LWW; append-only facts dedupe; genuine conflicts are flagged, never silently dropped.
- Verification: TC-05.

**US-011 (P2) — Drop-in registration at the kiosk**
As front-desk staff, I want to register a drop-in offline so that a visitor can train and sign later.
- AC1: `POST /v1/kiosk/drop-in` creates a `role:'dropin'`, `status:'pending_waiver'` user.
- AC2: `GET /v1/kiosk/bootstrap` supplies active members (PIN hashes/QR/waiver and membership state), the next 7 days of classes and server HLC.
- Verification: TC-05.

### E4 — Curriculum and progression

**US-012 (P1) — Configurable belt ladder**
As an owner, I want to configure belts and requirements so that promotion rules match my curriculum.
- AC1: `POST /v1/programs` creates a program and auto-seeds the IBJJF ladder for its discipline.
- AC2: `POST /v1/programs/:id/ranks` and `/techniques` add custom ranks and techniques; `POST /v1/curriculum-requirements` maps a technique to a rank/stripe requirement.
- AC3: Minimum months, classes and mat hours per rank are data, not code.
- Verification: TC-09.

**US-013 (P1) — Eligibility and promotion**
As a coach, I want to see who is eligible and record promotions so that progression is consistent and auditable.
- AC1: `GET /v1/promotions/eligibility` uses the shared `evaluatePromotionEligibility` function; `GET /v1/me/progression` gives the student the same answer.
- AC2: Belt-alert cron, coach badges and mobile cards all call the same evaluator.
- AC3: `POST /v1/promotions` writes an immutable history row with `classesSincePromotion` and `matHoursSincePromotion` snapshots; duplicate (user, program, rank, stripe, date) is rejected.
- Verification: TC-09, TC-10.

### E5 — Waivers and compliance

**US-014 (P0) — Sign a waiver on a tablet**
As a guardian, I want to sign a waiver with my finger so that my child can train without paperwork.
- AC1: `GET /v1/waivers/templates` lists active templates by type.
- AC2: `POST /v1/waivers` verifies the submitted document hash against the active template version, stores signature as SVG path, signer IP, user agent and timestamp.
- AC3: A minor's waiver requires a linked guardian with `can_sign_waivers` and captures `date_of_birth_snapshot` plus `guardian_user_id`.
- AC4: Duplicate (user, type, version) is rejected; drop-in waivers expire in 1 day, others in 365 days.
- Verification: TC-08.

**US-015 (P1) — Retrieve a signed waiver PDF**
As an owner, I want an on-demand PDF so that audits and disputes can be resolved.
- AC1: `GET /v1/waivers/:id/pdf` renders the immutable legal text and signature via `pdf-lib`.
- AC2: The stored `documentHash` reproduces the exact wording agreed to at signature time.
- Verification: TC-08.

**US-016 (P0) — Enforce waiver at the door**
As a system, I want check-in and day-pass sales blocked until a valid waiver exists so that uninsured visitors never enter.
- AC1: `GET /v1/waivers/requirements/:userId` reports current waiver status.
- AC2: `POST /v1/check-in` and `POST /v1/billing/day-pass` reject members with no valid waiver, unless a staff admin explicitly overrides at check-in with a change-log entry.
- Verification: TC-04, TC-08.

### E6 — Billing, payments and retail

**US-017 (P0) — Start a membership through the right provider**
As a member, I want to pay by a method available in my country so that I can join.
- AC1: `GET /v1/billing/plans` lists active plans; `POST /v1/billing/memberships` creates a `pending_payment` for hosted providers or an `active` manual transaction.
- AC2: Provider adapters advertise capabilities (`recurring`, `savedCards`, `refunds`, currencies, countries); `PaymentRouter` selects by currency/country/method/capability.
- AC3: Only provider tokens (`providerPaymentMethodId`) are stored; PAN and CVV never enter the database.
- Verification: TC-11.

**US-018 (P0) — Safe webhook processing**
As a system, I want provider webhooks applied once so that a retry never extends a membership twice.
- AC1: `POST /v1/webhooks/:provider` verifies the provider signature (Stripe HMAC 5-min tolerance, Billplz `X-Signature`, iPay88 MD5) before side effects.
- AC2: The handler inserts into `webhook_events` with `UNIQUE(provider, external_event_id)` first; a replay returns HTTP 200 with no action.
- AC3: Events normalise to `payment.succeeded/failed`, `subscription.renewed/past_due/canceled`, `refund.succeeded` and map to membership/transaction state.
- Verification: TC-12.

**US-019 (P1) — Automatic retry of failed renewals**
As an owner, I want failed charges retried automatically so that members are not lost to a transient card failure.
- AC1: Dunning retries follow days 1, 3, 5, 7, 12 via pure `nextRetryAt()`.
- AC2: Every retry uses `Idempotency-Key: retry-<id>`; success activates the membership and marks the transaction succeeded.
- AC3: Past-due/cancelled state is set only after `shouldCancelMembership` is reached; the outcome is recorded in `payment_retries`.
- Verification: TC-13.

**US-020 (P1) — Freeze, unfreeze and cancel**
As a member, I want to pause my membership when travelling so that I do not lose paid days.
- AC1: `POST /v1/billing/memberships/:id/freeze` uses `computeFreezeWindow` and clamps to the annual allowance.
- AC2: Unfreeze extends `currentPeriodEnd` by the remaining days; total frozen days are recorded.
- AC3: Cancel sets status, reason and `cancelAtPeriodEnd`, and cancels at the provider when `cancelSubscription` is supported.
- Verification: TC-20.

**US-021 (P1) — Point of sale and day passes**
As front-desk staff, I want to sell retail and day passes so that all revenue lands in one ledger.
- AC1: `POST /v1/billing/pos` accepts an idempotency key, computes price via `calculateSale`, decrements stock and writes a `transactions` row with items.
- AC2: An unknown product or empty cart is rejected; a replayed idempotency key does not create a second sale.
- AC3: `POST /v1/billing/day-pass` requires a signed waiver.
- Verification: TC-11, TC-08.

**US-022 (P2) — Family pricing**
As a guardian, I want a discount for additional family members so that the household plan is affordable.
- AC1: `calculateFamilyTotal` applies `familyDiscountPercent` to additional seats and caps at `maxDependents`.
- AC2: `transactions.payerId` records the paying guardian separately from the beneficiary `userId`.
- Verification: TC-21.

### E7 — Analytics, reports and intake

**US-023 (P1) — Owner dashboard**
As an owner, I want today's numbers and alerts on one screen so that I can act immediately.
- AC1: `GET /v1/dashboard/summary` returns active members, today's classes/check-ins, MRR, 30-day revenue, today's classes and alerts (past due, waiver expiry, low stock).
- AC2: Staff-only; students receive `403`.
- Verification: TC-15.

**US-024 (P1) — Analytics views**
As an owner, I want cohort retention, attendance patterns and financial projections so that I can grow the academy.
- AC1: Seven views are available: overview, progression, attendance, retention, financial, leads and member drilldown, plus `/v1/analytics/me` for students.
- AC2: `financial` is restricted to owner/admin/staff; `/v1/analytics/me` returns only the caller's data.
- AC3: Calculations use shared pure functions (cohorts, cash-flow projection, streak, risk levels).
- Verification: TC-15, TC-16.

**US-025 (P1) — On-demand reports**
As staff, I want to export operational lists so that I can run payroll, audits and follow-ups.
- AC1: `GET /v1/reports` lists the 11 report definitions.
- AC2: `GET /v1/reports/:slug` builds belt eligibility, daily roster, instructor payroll, MIA at-risk, membership changes, trial follow-up, failed payments, revenue/tax, pro-shop inventory, waiver audit and incident log.
- Verification: TC-17.

**US-026 (P2) — Leads and incidents**
As staff, I want to capture trials and safety incidents so that follow-up is not lost.
- AC1: `GET/POST/PATCH /v1/leads` manage the funnel; `GET/POST/PATCH /v1/incidents` manage safety records.
- AC2: Widget trial submissions create a lead; incidents feed the incident-log report.
- Verification: TC-17, TC-22.

### E8 — SaaS, growth and integrations

**US-027 (P1) — Plans and feature gates**
As an academy owner, I want to change my SaaS tier so that I only pay for features I use.
- AC1: `GET /v1/saas/plans` lists tiers; `GET /v1/saas/subscription` returns current features (starter fallback).
- AC2: Widgets, CSV import and cross-training passes fail closed when the active tier lacks the feature; downgrade disables them immediately.
- AC3: `GET /v1/saas/onboarding` reports progress; completing a step is idempotent.
- Verification: TC-22.

**US-028 (P1) — Branch network**
As a network owner, I want to see all locations so that I can compare performance.
- AC1: `POST /v1/network/locations` creates a branch and subscription (manual `multi_site` check).
- AC2: `GET /v1/network/overview` rolls up the network; branch admins see only their subtree.
- Verification: TC-22.

**US-029 (P2) — CSV import and public widgets**
As an owner, I want to import members and publish class widgets so that onboarding is fast and marketing is self-service.
- AC1: `POST /v1/imports` accepts members, belt ranks and billing mandates with per-row errors; `GET /v1/imports/template/:type` returns a template.
- AC2: Widgets generate iframe embed code; public schedule, trial form and waiver endpoints are token-gated, not session-gated; disabling a widget stops public access.
- Verification: TC-22.

**US-030 (P2) — Cross-training passes**
As staff, I want to issue and check in partner-academy visitors so that reciprocal training is tracked.
- AC1: Affiliations require a verification code; passes carry a signed QR token and a linked waiver.
- AC2: `POST /v1/passes/:id/check-in` is idempotent and blocks without a signed waiver; `/v1/passes/public/:token` reports pass and waiver status.
- Verification: TC-22.

**US-031 (P1) — Mobile self-service**
As a student, I want the app to show my schedule, bookings and progression so that I can manage training on my phone.
- AC1: Login, Home, Schedule, Bookings, Family, Curriculum, Profile tabs are implemented with Expo Router.
- AC2: Network failures surface a retryable error; the app never stores card data.
- AC3: Mobile has no offline write queue in 0.1.0 — a failed booking is reported, not silently queued.
- Verification: TC-19.

## 6. Non-functional expectations

Captured as testable requirements in [SRS §5](srs.md#5-non-functional-requirements); the headline expectations are: instant local check-in, tenant isolation on every query, no PAN/CVV in our database, idempotency on every money-moving mutation, and an auditable conflict trail.

## 7. Release sequencing and deferred ideas

- **0.1.0 (current):** all epics E1–E8 above.
- **Next:** automated DB backup, staging environment, leader election for jobs, mobile build pipeline, capability configuration per academy, automated Billplz/iPay88 refunds.
- **Later:** PostgreSQL runtime, mobile offline write queue, RLS after dialect migration, provider-native push notifications.

Items not listed here are out of scope until a PRD version bump. Questions of *how* are answered in the [SRS](srs.md) and [SAD](sad.md).
