# Gymlytics — Software Requirements Specification (SRS)

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Status | Baseline for 0.1.0 |
| Last updated | 2026-11-23 |
| Scope | API, web (admin/kiosk/waiver/widgets), Expo mobile, shared packages, jobs |
| Owner | Technical lead (name TBD) |
| Related documents | [PRD](prd.md) · [SAD](sad.md) · [Test Plan](test-plan.md) · [ADRs](adr/README.md) |

---

## 1. Purpose and scope

This SRS specifies the observable behaviour and constraints of Gymlytics 0.1.0. It is the contract between product requirements ([PRD](prd.md)) and implementation/test cases ([Test Plan](test-plan.md)). "Shall" denotes a normative requirement; "may" denotes an option.

Out of scope: internal implementation choices (see [SAD](sad.md)), infrastructure sizing beyond the stated constraints, and any feature listed as deferred in the PRD.

## 2. Definitions

| Term | Meaning |
| --- | --- |
| Academy | Tenant root; every domain table carries `academy_id`. |
| Principal | Authenticated user or kiosk device token calling the API. |
| Mutation | A client-generated change with a unique `mutationId`, HLC and origin device id. |
| Outbox | Durable local queue; a row is committed in the same transaction as its entity change. |
| HLC | Hybrid Logical Clock `<ISO-8601>-<counter>-<deviceId>` used for causal ordering. |
| LWW | Last-writer-wins resolution with deterministic device-id tie-break. |
| Idempotency key | Client-supplied key that guarantees one effect for repeated requests. |
| Capability | A provider feature flag: `recurring`, `savedCards`, `refunds`, currencies, countries, hosted checkout. |
| Gate | A precondition that blocks an action (e.g. valid waiver, active membership). |

## 3. Overall description

### 3.1 Product perspective

Four client surfaces (Vue admin, Vue offline kiosk/waiver/web widgets, Expo mobile, Fastify API) share Zod contracts and pure domain functions from `@gymlytics/shared`. The API owns authorisation, idempotency and all canonical writes; the kiosk owns local check-in and its outbox. The system is deployed as two containers (`api`, `web`) with SQLite on a named volume.

### 3.2 User classes

Owner, admin, coach, staff, student, guardian, dropin, kiosk device, public widget/pass token holder. Roles are enumerated in `users.role`; permissions are derived server-side from a role map and never trusted from the client.

### 3.3 Operating constraints

- Kiosk network may be unavailable for the duration of a check-in; the API may be a single process.
- SQLite has one writer; WAL mode and short transactions are required.
- Browser kiosk requires OPFS; managed Chromium is the supported environment.
- No raw PAN/CVV may be stored; only provider tokens.
- Every tenant-scoped query must include `academy_id` derived from the session or device token.

## 4. Functional requirements

Priority: **P0** release-blocking, **P1** high, **P2** desirable. Trace columns reference PRD user stories and Test Plan cases.

### 4.1 Identity, authorisation and tenancy

| ID | Requirement | Pri | Trace |
| --- | --- | --- | --- |
| FR-001 | The system shall authenticate users by academy slug + email + password and issue an access token and a refresh token. | P0 | US-001 / TC-01 |
| FR-002 | The system shall rotate refresh tokens on use and revoke the previous session. | P0 | US-001 / TC-01 |
| FR-003 | The system shall reject forged, expired or revoked access tokens on all `/v1/*` routes except the documented public exceptions. | P0 | US-001 / TC-02 |
| FR-004 | The system shall enforce role checks server-side using `owner`, `admin`, `coach`, `staff`, `student`, `guardian`, `dropin`. | P0 | US-001 / TC-02 |
| FR-005 | The system shall derive `academy_id` from the authenticated principal and include it in every domain query; a client-supplied academy id shall never grant access. | P0 | US-001 / TC-05 |
| FR-006 | The system shall pair a kiosk device with `KIOSK_DEVICE_KEY` and issue a device token bound to `X-Device-Id`. | P0 | US-002 / TC-05 |
| FR-007 | The system shall store only hashed passwords and HMAC-hashed PINs; raw secrets shall never be returned. | P0 | US-004 / TC-03 |
| FR-008 | The system shall support guardian→dependent links with `is_primary_billing`, `can_sign_waivers`, `can_view_progress`, `can_book_classes` flags. | P1 | US-003 / TC-14 |
| FR-009 | The system shall scope guardian endpoints to linked dependents unless the principal is staff. | P1 | US-003 / TC-14 |
| FR-010 | The system shall log every member create/update to a change log with actor and timestamp. | P1 | US-004 / TC-03 |

### 4.2 Members, classes and bookings

| ID | Requirement | Pri | Trace |
| --- | --- | --- | --- |
| FR-011 | The system shall provide paginated, searchable member rosters and full member dossiers. | P1 | US-004 / TC-03 |
| FR-012 | The system shall create a QR token for each member and allow PIN-based kiosk lookup offline. | P0 | US-004 / TC-05 |
| FR-013 | The system shall maintain programs, belt ranks, techniques and rank requirements per academy. | P1 | US-012 / TC-09 |
| FR-014 | The system shall auto-seed the IBJJF belt ladder when a program is created. | P2 | US-012 / TC-09 |
| FR-015 | The system shall maintain recurring class templates and materialised class instances with capacity. | P1 | US-005 / TC-06 |
| FR-016 | The system shall compute and expose `spotsLeft` for a class. | P1 | US-005 / TC-06 |
| FR-017 | The system shall accept a booking only when the class is not cancelled/started and the member passes `assertCanBook`. | P0 | US-005 / TC-06 |
| FR-018 | The system shall waitlist a booking when capacity is reached and cancel bookings with counter adjustment. | P1 | US-005 / TC-06 |
| FR-019 | The system shall enforce membership freeze, past-due, expiry and weekly class-quota gates before booking. | P0 | US-005 / TC-06 |
| FR-020 | The system shall prevent duplicate active bookings for the same class/user. | P1 | US-005 / TC-06 |

### 4.3 Attendance and offline sync

| ID | Requirement | Pri | Trace |
| --- | --- | --- | --- |
| FR-021 | The system shall accept check-in methods `pin`, `qr`, `name_search`, `admin`, `mobile`, `guardian`. | P0 | US-006 / TC-04 |
| FR-022 | The system shall commit an attendance row and its outbox row in one local transaction on the kiosk. | P0 | US-009 / TC-05 |
| FR-023 | The system shall generate UUIDv7 entity ids and mutation ids on the client before any network call. | P0 | US-009 / TC-05 |
| FR-024 | The system shall block check-in when a valid waiver or active membership is absent, except for a change-logged staff override. | P0 | US-006 / TC-04 |
| FR-025 | The system shall deduplicate check-ins by `mutationId` and uniquely constrain (class, user) for non-deleted rows. | P0 | US-006 / TC-05 |
| FR-026 | The system shall update booking status, class counters, HLC and change log atomically on check-in. | P0 | US-006 / TC-04 |
| FR-027 | The system shall push outbox mutations in batches of 100 with exponential backoff from 1 s to 60 s and jitter. | P0 | US-010 / TC-05 |
| FR-028 | The system shall return the stored ack when a previously applied `mutationId` is replayed. | P0 | US-010 / TC-05 |
| FR-029 | The system shall serve pull deltas since an HLC cursor, excluding rows authored by the requesting device. | P0 | US-010 / TC-05 |
| FR-030 | The system shall resolve mutable conflicts by LWW with a device-id tie-break, dedupe append-only facts and flag genuine conflicts. | P0 | US-010 / TC-05 |
| FR-031 | The system shall display sync state (`online`, `queued`, `conflicts`, `lastSyncedAt`) to kiosk staff. | P0 | US-009 / TC-05 |
| FR-032 | The system shall register drop-ins offline with `role:'dropin'`, `status:'pending_waiver'`. | P2 | US-011 / TC-05 |
| FR-033 | The system shall compute mat minutes from scan deltas capped at 4 hours, falling back to class length. | P2 | US-007 / TC-07 |

### 4.4 Curriculum and progression

| ID | Requirement | Pri | Trace |
| --- | --- | --- | --- |
| FR-034 | The system shall store technique requirements per belt rank and stripe level. | P1 | US-012 / TC-09 |
| FR-035 | The system shall evaluate promotion eligibility using one shared pure function across API, coach UI and mobile. | P0 | US-013 / TC-09 |
| FR-036 | The system shall write immutable promotion history with class/mat-hour snapshots and reject exact duplicates. | P1 | US-013 / TC-10 |
| FR-037 | The system shall log techniques taught and per-class recaps, visible to attendees. | P2 | US-008 / TC-18 |
| FR-038 | The system shall enqueue belt-eligibility notifications once per (user, rank) via a dedupe key. | P1 | US-013 / TC-10 |

### 4.5 Waivers and compliance

| ID | Requirement | Pri | Trace |
| --- | --- | --- | --- |
| FR-039 | The system shall version waiver templates with a SHA-256 `documentHash` and uniqueness per (academy, type, version). | P0 | US-014 / TC-08 |
| FR-040 | The system shall accept an e-signature as an SVG path with signer IP, user agent and timestamp. | P0 | US-014 / TC-08 |
| FR-041 | The system shall verify the submitted hash against the active template before accepting a signature. | P0 | US-014 / TC-08 |
| FR-042 | The system shall require a linked guardian with `can_sign_waivers` and store DOB snapshot for minors. | P0 | US-014 / TC-08 |
| FR-043 | The system shall reject duplicate signatures for the same (user, type, version) and expire drop-in waivers after 1 day, others after 365 days. | P1 | US-014 / TC-08 |
| FR-044 | The system shall render a signed waiver and signature to PDF on request from immutable text. | P1 | US-015 / TC-08 |
| FR-045 | The system shall enforce a valid-waiver gate on check-in, day pass and cross-training check-in. | P0 | US-016 / TC-08 |

### 4.6 Billing, payments and retail

| ID | Requirement | Pri | Trace |
| --- | --- | --- | --- |
| FR-046 | The system shall store membership plans with type, interval, price in minor units, family discount and freeze allowance. | P1 | US-017 / TC-11 |
| FR-047 | The system shall create memberships as `pending_payment` for hosted providers or `active` for manual payment. | P0 | US-017 / TC-11 |
| FR-048 | The system shall select a payment provider by currency, country, method and required capability, throwing when none supports the request. | P1 | US-017 / TC-20 |
| FR-049 | The system shall store only provider customer/payment-method tokens and payment-brand metadata. | P0 | US-017 / TC-11 |
| FR-050 | The system shall verify webhook signatures per provider before applying side effects. | P0 | US-018 / TC-12 |
| FR-051 | The system shall insert a `(provider, external_event_id)` ledger row before side effects and treat conflicts as already processed. | P0 | US-018 / TC-12 |
| FR-052 | The system shall normalise provider events to payment/subscription/refund domain events and update memberships/transactions accordingly. | P0 | US-018 / TC-12 |
| FR-053 | The system shall retry failed charges on days 1, 3, 5, 7, 12 with key `retry-<id>` and record every attempt. | P1 | US-019 / TC-13 |
| FR-054 | The system shall freeze/unfreeze memberships within the annual allowance and extend the period by remaining days. | P1 | US-020 / TC-20 |
| FR-055 | The system shall cancel memberships locally and at the provider when the capability exists, recording reason and note. | P1 | US-020 / TC-20 |
| FR-056 | The system shall process POS sales idempotently, compute price via shared logic and decrement stock. | P0 | US-021 / TC-11 |
| FR-057 | The system shall sell day passes only to members with a signed waiver. | P0 | US-021 / TC-08 |
| FR-058 | The system shall record beneficiary and payer separately and apply capped family discounts. | P2 | US-022 / TC-21 |

### 4.7 Analytics, reports and growth

| ID | Requirement | Pri | Trace |
| --- | --- | --- | --- |
| FR-059 | The system shall expose dashboard KPIs and alerts (past due, waiver expiry, low stock) to staff roles only. | P1 | US-023 / TC-15 |
| FR-060 | The system shall expose overview, progression, attendance, retention, financial, leads and per-member analytics views. | P1 | US-024 / TC-15 |
| FR-061 | The system shall restrict financial analytics to owner/admin/staff and scope `/v1/analytics/me` to the caller. | P0 | US-024 / TC-16 |
| FR-062 | The system shall expose the 11 report definitions and build each on request. | P1 | US-025 / TC-17 |
| FR-063 | The system shall capture leads and incidents and expose them to reports and analytics. | P2 | US-026 / TC-17 |
| FR-064 | The system shall gate widgets, CSV imports and cross-training features by the active SaaS plan, failing closed on downgrade. | P1 | US-027 / TC-22 |
| FR-065 | The system shall record onboarding step completion idempotently and report progress. | P2 | US-027 / TC-22 |
| FR-066 | The system shall create branch academies and roll up network data with branch-admin subtree scoping. | P1 | US-028 / TC-22 |
| FR-067 | The system shall import members, belt ranks and billing mandates from CSV with per-row errors and downloadable templates. | P2 | US-029 / TC-22 |
| FR-068 | The system shall generate token-gated public widget endpoints for schedule, trial and waiver, and stop serving them when disabled. | P2 | US-029 / TC-22 |
| FR-069 | The system shall issue verified cross-training passes with idempotent, waiver-gated visitor check-in. | P2 | US-030 / TC-22 |
| FR-070 | The system shall provide Expo mobile login, home, schedule, bookings, family, curriculum and profile screens over the same API. | P1 | US-031 / TC-19 |

### 4.8 Background jobs and notifications

| ID | Requirement | Pri | Trace |
| --- | --- | --- | --- |
| FR-071 | The system shall run reminders every 60 s, dunning every 15 min and reminder scans every 6 h when jobs are enabled. | P1 | US-019 / TC-13 |
| FR-072 | The system shall enqueue dedupe-keyed notifications for missed classes, belt eligibility, waiver expiry, past-due memberships and freezes ending. | P1 | US-013 / TC-10 |
| FR-073 | The system shall deliver notifications via SMS/email when credentials exist and fall back to console logging otherwise. | P2 | US-013 / TC-10 |
| FR-074 | The system shall retry failed notification deliveries up to 3 times with 15-minute backoff. | P2 | FR-073 / TC-13 |
| FR-075 | The system shall allow jobs to be disabled on a secondary API instance via `JOBS_ENABLED=false`. | P1 | Charter §8 / TC-24 |

## 5. Non-functional requirements

Targets marked *(design target)* are engineering goals, not measured production SLAs; they must be validated under load before GA.

| ID | Category | Requirement | Priority |
| --- | --- | --- | --- |
| NFR-001 | Performance | Kiosk PIN lookup and check-in shall complete without any network round-trip. | P0 |
| NFR-002 | Performance | Check-in UI shall acknowledge a queued check-in immediately after the local transaction commits *(design target: < 100 ms)*. | P0 |
| NFR-003 | Performance | API read endpoints shall return in under 300 ms at p95 for a single academy with 10k members *(design target)*. | P1 |
| NFR-004 | Performance | Sync push/pull shall cost O(changes), using batches of 100 and HLC cursors rather than full-table scans. | P0 |
| NFR-005 | Availability | A front-desk check-in shall never fail solely because the network is unavailable. | P0 |
| NFR-006 | Availability | The API shall expose `/health` (liveness) and `/ready` (DB probe) endpoints for container orchestration. | P0 |
| NFR-007 | Integrity | Every mutation that moves money shall be idempotent at the request and webhook layers. | P0 |
| NFR-008 | Integrity | Replay, reordering and loss of individual sync messages shall not create duplicate attendance or double-apply payments. | P0 |
| NFR-009 | Security | Only provider tokens shall be stored; PAN/CVV shall never be written to the database or logs. | P0 |
| NFR-010 | Security | Passwords and PINs shall be hashed; refresh tokens shall be stored as SHA-256 hashes and be individually revocable. | P0 |
| NFR-011 | Security | Every domain query shall be tenant-scoped; integration tests shall assert cross-tenant requests are rejected. | P0 |
| NFR-012 | Security | Webhook signatures shall be verified with timing-safe comparison where supported; invalid signatures shall be rejected. | P0 |
| NFR-013 | Security | Production shall refuse to start with the development `JWT_SECRET` default. | P0 |
| NFR-014 | Security | CORS origins shall be explicit in production; the deployed SPA shall use same-origin `/v1` via nginx. | P1 |
| NFR-015 | Scalability | The schema shall use a portable Drizzle subset so a PostgreSQL dialect swap is mechanical (ADR-0002). | P1 |
| NFR-016 | Scalability | SQLite shall run in WAL mode with short transactions and a single writer process until migration. | P0 |
| NFR-017 | Compatibility | Supported clients: managed Chromium kiosk with OPFS, current Chrome/Firefox/Safari for admin/waiver, Expo 52 iOS/Android. | P1 |
| NFR-018 | Maintainability | Shared rules shall live in `@gymlytics/shared` as Zod schemas or pure functions; no platform APIs in that package. | P0 |
| NFR-019 | Maintainability | Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`) shall pass for all packages. | P0 |
| NFR-020 | Testability | Domain functions shall be pure and injectable transports/databases shall be used so unit tests need no device or network. | P1 |
| NFR-021 | Observability | The API shall log at `LOG_LEVEL` with request context; outbox/webhook/notification rows shall retain attempt counts and last errors. | P1 |
| NFR-022 | Auditability | Waivers shall retain document hash, signer IP, user agent, guardian id and DOB snapshot; promotions and member changes shall be change-logged. | P0 |
| NFR-023 | Recovery | The production SQLite database shall be restorable from a documented copy procedure; automation is a follow-up. | P1 |
| NFR-024 | Deployability | CI shall gate merges on typecheck, unit/integration tests, build, smoke walkthrough and both image builds. | P0 |

## 6. External interfaces

| Interface | Direction | Contract / notes |
| --- | --- | --- |
| Stripe | Outbound + webhook | Cards/subscriptions; `t,v1` HMAC verification with 5-minute tolerance; PaymentIntents and customer tokens. |
| Billplz | Outbound + callback | Malaysian FPX one-off bills; `X-Signature` HMAC-SHA512; no recurring/saved cards/refunds. |
| iPay88 | Outbound + callback | SEA local cards/FPX, hosted checkout, recurring where enabled; MD5 signature. |
| Twilio / SendGrid | Outbound | SMS/email for reminders, dunning and eligibility; console fallback when unconfigured. |
| PDF renderer (`pdf-lib`) | Local library | Renders versioned waiver text + SVG signature on demand; no third-party service. |
| Browser OPFS / sqlite-wasm | Local | Kiosk offline store; same DDL subset as server. |
| Public widgets / passes | Inbound | Token-gated iframe endpoints; no session cookie required. |
| Expo Secure Store | Local | Mobile token storage; web kiosk uses session storage. |

## 7. Data requirements

- All ids are text UUIDs (UUIDv7 for client-created rows); timestamps are ISO-8601 text; booleans are integer flags; money is integer minor units; enums are text unions; JSON is text-mode JSON.
- Every domain table carries `academy_id`; the full table inventory and keys are in [SAD §8](sad.md#8-database-schema).
- Personal data includes name, contact details, DOB, emergency contacts, medical notes and signature artifacts; access is role- and tenant-scoped.
- Retention/erasure policy is not implemented in 0.1.0 and must be defined before GA in jurisdictions that require it.

## 8. Traceability summary

| PRD epic | Functional requirements | Test cases |
| --- | --- | --- |
| E1 Identity & family | FR-001…FR-010 | TC-01, TC-02, TC-03, TC-14 |
| E2 Scheduling & attendance | FR-011…FR-020, FR-033 | TC-04, TC-06, TC-07 |
| E3 Offline sync | FR-021…FR-032 | TC-05 |
| E4 Curriculum & progression | FR-034…FR-038 | TC-09, TC-10, TC-18 |
| E5 Waivers | FR-039…FR-045 | TC-08 |
| E6 Billing & retail | FR-046…FR-058 | TC-08, TC-11, TC-12, TC-13, TC-20, TC-21 |
| E7 Analytics & intake | FR-059…FR-063 | TC-15, TC-16, TC-17 |
| E8 SaaS & growth | FR-064…FR-070 | TC-19, TC-22 |
| Jobs & ops | FR-071…FR-075, NFR-024 | TC-13, TC-23, TC-24 |

Full step-by-step cases are in the [Test Plan](test-plan.md).

## 9. Assumptions and dependencies

1. Pilot academies operate in MYR/USD/SGD/THB/IDR/PHP/EUR/GBP/AUD with a configured timezone (default `Asia/Kuala_Lumpur`).
2. Provider merchant accounts are provisioned externally; capability flags must reflect what the account actually supports.
3. The kiosk runs on a managed Chromium browser where OPFS is available.
4. A single API process owns background timers in 0.1.0; leader election is a documented follow-up.
5. Legal review of waiver wording and signature capture is the academy's responsibility.
