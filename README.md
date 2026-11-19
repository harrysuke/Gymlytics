# Gymlytics

Offline-first martial arts academy management platform. pnpm + Turborepo monorepo.

## Quick start

```bash
corepack enable
cp .env.example .env
pnpm install
pnpm db:generate && pnpm db:migrate
pnpm db:seed          # demo academy, members, classes, waivers, products
pnpm dev
```

- API: http://localhost:3000 · Web (admin / kiosk / waiver / family / embeds): http://localhost:5173
- Mobile: `pnpm --filter @gymlytics/mobile start`

## Analytics & reporting

Live, tenant-scoped analytics are available at `/v1/analytics/*` and `/admin/analytics`:

- **Overview** — headline KPIs and revenue/attendance/signup trends
- **Progression** — belt and stripe distribution, rank readiness, promotion timeline
- **Attendance** — class popularity, capacity, no-shows, peak days/hours and coach impact
- **Retention** — churn, tenure buckets, signup cohorts, drop-off reasons, at-risk members
- **Financial** — MRR, ARPU, LTV, revenue mix, failed payments, expiring cards, cash-flow projection
- **Leads** — trial funnel, conversion speed, source attribution and follow-up queue
- **Member drilldown** — `/admin/analytics/member/:id` or `/v1/analytics/member/:id`; students can fetch their own view at `/v1/analytics/me`

The report centre lives at `/admin/reports` and `GET /v1/reports`. Eleven live reports cover
belt eligibility, daily rosters, instructor payroll, MIA alerts, membership changes, trial
follow-up, failed payments, revenue & tax, pro-shop inventory, waiver audits and incidents.
Each report supports date/month/window filters and CSV export.

Leads and incidents are captured through `POST /v1/leads` and `POST /v1/incidents`; cancellations
accept a `reason` and `note` so churn reporting has real data. Charts are hand-built SVG
components — no chart dependency was added.

## Multi-tenant SaaS & member experience

Subscription tiers are stored in `saas_plans` and resolved per request by
`subscriptionFor()` in `apps/api/src/lib/saas.ts`. Starter covers the core
academy; Growth adds marketing, CSV import, widgets, curriculum and
cross-training; Network adds multi-site rollups. Gated endpoints fail closed
with `upgradeRequired: true`, and the admin console links those errors to
`/admin/plan`.

| Area | Admin UI | API surface |
| ---- | -------- | ----------- |
| Network / branches | `/admin/network` | `GET /v1/network/overview`, `POST /v1/network/locations` |
| Plans & entitlements | `/admin/plan` | `GET /v1/saas/plans`, `GET /v1/saas/subscription` |
| Guided setup | `/admin/onboarding` | `GET/POST /v1/saas/onboarding[/steps]` |
| CSV migration | `/admin/imports` | `POST /v1/imports`, `GET /v1/imports/template/:type` |
| Embeddable widgets | `/admin/embeds`, `/embed/:kind/:token` | `/v1/widgets`, `/v1/widgets/public/:token/*` |
| Curriculum & recaps | `/admin/curriculum` | `/v1/curriculum/videos`, `/v1/classes/:id/recap` |
| Family portal | `/family` | `/v1/family/dependents[/:id/schedule|progression]` |
| Drop-in passes | `/admin/passes` | `/v1/affiliations`, `/v1/passes`, `/v1/passes/public/:token` |

Network rollups read across descendant academies with a recursive CTE but never
grant a branch admin another branch's roster. Widget and QR-pass endpoints are
token-gated rather than session-gated, so they work from a third-party website
or a phone camera. A visiting grappler cannot check in until a signed,
unexpired waiver exists for that visitor; the check-in mutation is idempotent
through `applied_mutations`.

`PUBLIC_WEB_URL` controls the origin inside generated iframe snippets; leave
`VITE_API_URL` unset in development so the web app uses the Vite `/v1` proxy.

## Seeded demo data

All demo accounts use the password `Password123!` on academy slug `gymlytics-demo`.

| Role      | Email                    | Kiosk PIN |
| --------- | ------------------------ | --------- |
| Owner     | `owner@gymlytics.test`   | `1234`    |
| Coach     | `coach@gymlytics.test`   | `1235`    |
| Front desk| `frontdesk@gymlytics.test` | `1236`  |
| Guardian  | `parent@gymlytics.test`  | `1240`    |
| Student   | `daniel@student.test`    | `1200`    |

The seeded branch admin is `branch-admin@gymlytics.test` / `Password123!` on
academy slug `gymlytics-demo-pj` (PIN `1300`). Sign in as the root owner to see
the combined network view; sign in as the branch admin to verify roster
isolation.

Every staff member has a distinct PIN because the kiosk resolves people by PIN
hash — duplicates would always check in whichever row sorted first.

Kiosk pairing: open `/kiosk`, enter the device key (`KIOSK_DEVICE_KEY`, defaults
to `dev-kiosk-key`), and the tablet receives a device token. From then on it
works from its local SQLite cache and flushes the outbox when the network returns.

## Verification

```bash
pnpm typecheck   # 7 packages, strict TS
pnpm test        # 214 tests across shared, sync, payments, api
pnpm build       # API (tsup) + web (vite)
pnpm --filter @gymlytics/api smoke   # 27-check end-to-end walkthrough
```

The API suites run against throwaway copies of the seeded database
(`data/api-test.db`, `data/api-saas-test.db`), so they never mutate working data.

## Troubleshooting

**"Failed to fetch" on login.** This is a browser network error, not a bad
password. Check `curl http://localhost:3000/health` first — if the API process
is down, the front end can only report a fetch failure. If the API is up, check
which origin you opened the web app from: local development now proxies `/v1`
through the Vite dev server and uses a same-origin URL, so `localhost`,
`127.0.0.1` and the desktop preview panel all work without CORS. Production
still uses the explicit `CORS_ORIGIN` allow-list.

**Native module ABI errors (`ERR_DLOPEN_FAILED`).** `better-sqlite3` ships a
native binary compiled for one Node ABI. This machine has Node 22 in WorkBuddy
and Node 26 on the system PATH; installing under the wrong one leaves a binary
the other cannot load. It is pinned to `11.10.0` in the root `pnpm` overrides
so all peer resolutions agree. Reinstall with the Node you intend to run:
`npm_config_target=22.22.2 pnpm install`.

## Monorepo folder structure

```
gymlytics/
├── apps/
│   ├── api/                     Fastify backend
│   │   └── src/
│   │       ├── main.ts          bootstrap
│   │       ├── app.ts           plugin + route registration
│   │       ├── plugins/db.ts    Drizzle/better-sqlite3 client
│   │       ├── modules/
│   │       │   ├── sync/        /v1/sync/push + /v1/sync/pull (idempotent)
│   │       │   └── webhooks/    /v1/webhooks/:provider (signature + ledger)
│   │       └── jobs/
│   │           ├── reminders.ts SMS/email cron (churn, belt, waiver)
│   │           └── dunning.ts   failed-payment retry cron
│   ├── web/                     Vue 3 + TS + Tailwind (Vite)
│   │   └── src/
│   │       ├── views/admin/     Dashboard
│   │       ├── views/kiosk/     Tablet check-in (offline-first)
│   │       ├── views/waiver/    Canvas e-signature flow
│   │       └── lib/             OPFS SQLite + sync engine wiring
│   └── mobile/                  Expo / React Native (iOS + Android)
│       └── src/
│           ├── app/             expo-router: login, (tabs), class/[id]
│           │                    tabs include family portal and curriculum library
│           ├── components/      shared RN primitives (Screen, Card, Button)
│           └── lib/             api client, session, auth context, theme
├── packages/
│   ├── db/                      Drizzle schema + migrations + client
│   │   └── src/schema/
│   │       ├── _shared.ts       portable column helpers (UUID, ISO, cents)
│   │       ├── saas.ts          plans, subscriptions, widgets, passes, curriculum
│   │       ├── tenancy.ts       academies (self-referencing parent)
│   │       ├── users.ts         users, familyLinks
│   │       ├── programs.ts      programs, beltRanks, curriculum
│   │       ├── classes.ts       classTemplates, classes, bookings
│   │       ├── attendance.ts    attendanceLogs + sync flags, outbox, cursors
│   │       ├── ranks.ts         promotions
│   │       ├── waivers.ts       signed waivers
│   │       ├── billing.ts       plans, memberships, paymentMethods, retries
│   │       ├── commerce.ts      retailProducts, transactions
│   │       ├── operations.ts    webhookEvents, notificationJobs
│   │       └── relations.ts     Drizzle relational query graph
│   ├── shared/                  Zod DTOs, API types, pure domain logic
│   │   └── src/
│   │       ├── schemas/         validated API contracts (web + mobile + API)
│   │       ├── types/api.ts     ApiResponse, KioskState
│   │       ├── domain/          promotion eligibility, entitlements, pricing
│   │       └── constants.ts     disciplines, belt ladders, dunning schedule
│   ├── sync/                    Offline delta-sync engine
│   │   └── src/
│   │       ├── hlc.ts           hybrid logical clock + total order
│   │       ├── conflict.ts      LWW / append-only resolution
│   │       ├── outbox.ts        transactional outbox + exponential backoff
│   │       ├── engine.ts        push/pull loops, online/offline events
│   │       └── adapters/        sqlite-wasm (OPFS) + fetch transport
│   └── payments/                Provider-agnostic billing
│       └── src/
│           ├── types.ts         PaymentProvider interface + capabilities
│           ├── router.ts        capability-based provider selection
│           ├── dunning.ts       retry schedule
│           ├── webhooks.ts      signature verification + normalisation
│           └── providers/       stripe, billplz, ipay88
├── docs/
│   ├── adr/                     Architecture Decision Records
│   └── architecture/            C4 context / container / component diagrams
├── package.json                 workspace scripts
├── pnpm-workspace.yaml
├── turbo.json
└── tsconfig.base.json           strict TS + @gymlytics/* path aliases
```

## Documentation

- [Architecture overview & C4 diagrams](docs/README.md)
- [Architecture Decision Records](docs/adr/README.md)
- [Database schema](packages/db/src/schema/index.ts)
- [Offline sync design](docs/adr/0003-offline-first-kiosk-sync.md)
- [Payment abstraction](docs/adr/0004-payment-provider-adapter.md)
