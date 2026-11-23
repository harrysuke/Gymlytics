# Gymlytics — Deployment Guide & Runbook

| Field | Value |
| --- | --- |
| Document version | 1.0 |
| Status | Baseline for 0.1.0 |
| Last updated | 2026-11-23 |
| Audience | System administrators, DevOps, on-call engineers |
| Related documents | [SAD](sad.md) · [Test Plan](test-plan.md) · [Release Notes](release-notes.md) |

---

## 1. Deployment overview

```
Internet
   │  :8080 → :80
   ▼
┌──────────────────────────┐
│ web (nginx:1.27-alpine)  │  static Vue SPA
│  /v1/*  ──proxy──┐       │  /assets/* immutable
└──────────────────┼───────┘
                   ▼
┌──────────────────────────┐
│ api (node:22 + pnpm/tsx) │  Fastify, jobs, webhooks
│  /health /ready          │
└──────────────────┼───────┘
                   ▼
        volume gymlytics-data → /data/gymlytics.db (SQLite, WAL)
```

- Only the `web` service publishes a port. The API is exposed internally at `api:3000`; nginx forwards `/v1/` and `/health`, so browser calls are same-origin.
- The API container's entrypoint runs migrations, seeds a demo academy **only when the SQLite file is new**, then starts `tsx src/main.ts`.
- Background jobs run inside the API process by default. Set `JOBS_ENABLED=false` on any additional API instance.
- Images are published to `ghcr.io/<owner>/gymlytics-api` and `gymlytics-web` with branch, tag, sha and `latest` tags.

## 2. Prerequisites

| Requirement | Notes |
| --- | --- |
| Docker Engine + Compose plugin | Used for local and server deployments. |
| Strong `JWT_SECRET` | At least 32 random bytes. Production refuses the development default. |
| `.env` file on the server | Never commit it; `.env` is gitignored. Start from `.env.example`. |
| DNS + TLS termination | nginx serves HTTP; put a TLS reverse proxy/load balancer in front in production. |
| Outbound network | To payment providers and Twilio/SendGrid if those integrations are enabled. |
| Backup location | See §8; automation is not yet included. |

Generate a secret: `openssl rand -hex 32`.

## 3. Configuration reference

### 3.1 Required / core

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | Production tightens CORS and enforces a non-default `JWT_SECRET`. |
| `JWT_SECRET` | dev placeholder | Access/device token signing. **Set explicitly in production.** |
| `API_HOST` / `API_PORT` | `0.0.0.0` / `3000` | Fastify listen address. |
| `DATABASE_URL` | `file:/data/gymlytics.db` | SQLite path; `/data` is the named volume. |
| `LOG_LEVEL` | `info` | Fastify log verbosity. |
| `CORS_ORIGIN` | `http://localhost:8080` | Comma-separated allowed browser origins (production). |
| `PUBLIC_API_URL` | `http://localhost:8080` | POS/iPay88 return URLs. |
| `PUBLIC_WEB_URL` | `http://localhost:8080` | Base URL for widget iframe snippets. |
| `JOBS_ENABLED` | `true` | Enables in-process reminder/dunning/scan timers. |

### 3.2 Tokens and kiosk

| Variable | Default | Purpose |
| --- | --- | --- |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | Access token lifetime. |
| `DEVICE_TOKEN_TTL_SECONDS` | `43200` | Kiosk device token lifetime (12 h). |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Refresh session expiry. |
| `KIOSK_DEVICE_KEY` | `dev-kiosk-key` | Shared secret for tablet pairing; rotate to force re-pairing. |
| `KIOSK_PIN_LENGTH`, `HLC_DEVICE_ID` | `4`, `kiosk-main-lobby` | Kiosk settings (compose environment). |

### 3.3 Sync (compose defaults; web kiosk currently uses hardcoded 100 / 5 s / 15 s)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SYNC_BATCH_SIZE` | `100` | Mutations per push batch. |
| `SYNC_PUSH_INTERVAL_MS` | `5000` | Push cadence. |
| `SYNC_BACKOFF_BASE_MS` / `SYNC_BACKOFF_MAX_MS` | `1000` / `60000` | Retry backoff bounds. |

### 3.4 Integrations (leave empty to disable)

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY` | Global cards/subscriptions. |
| `BILLPLZ_API_KEY`, `BILLPLZ_COLLECTION_ID`, `BILLPLZ_SIGNATURE_KEY`, `BILLPLZ_X_SIGNATURE_KEY` | Malaysian FPX bills. |
| `IPAY88_MERCHANT_CODE`, `IPAY88_MERCHANT_KEY`, `IPAY88_SIGNATURE_KEY` | SEA cards/FPX/recurring. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS notifications. |
| `SENDGRID_API_KEY`, `EMAIL_FROM` | Email notifications. |
| `VITE_API_URL` | Web build-time API URL; leave unset for same-origin `/v1`. |
| `VITE_KIOSK_DEVICE_ID` | Kiosk device id in the web build. |
| `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_ACADEMY_SLUG` | Mobile bundle-time config. |
| `GHCR_OWNER`, `IMAGE_TAG`, `WEB_PORT` | Compose image owner/tag and host port. |

## 4. Local development and verification

```bash
cd <repo-root>
cp .env.example .env          # then set JWT_SECRET
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:seed
pnpm typecheck && pnpm test && pnpm build
pnpm --filter @gymlytics/api smoke
pnpm dev                       # web at :5173, API at :3000
```

Useful endpoints: `GET http://localhost:3000/health`, `GET /ready`. Mobile on a physical device needs `EXPO_PUBLIC_API_URL` set to the machine's LAN address (`localhost` resolves to the phone).

## 5. Building and deploying the stack

### 5.1 First deployment

1. Create the deployment directory and copy `docker-compose.yml`, `.env.example` and any TLS/proxy config to the server.
2. Create `.env` with `JWT_SECRET`, `GHCR_OWNER`, `WEB_PORT`, `PUBLIC_*` URLs and integration credentials. Use production values for `CORS_ORIGIN` and `NODE_ENV=production`.
3. If GHCR images are private, authenticate: `echo "$CR_PAT" | docker login ghcr.io -u <user> --password-stdin`.
4. Start: `docker compose pull && docker compose up -d`.
5. Verify: `curl -fsS http://localhost:8080/health` and `/ready`; open the SPA and log in with the seeded demo academy (new database only).
6. Put TLS in front and confirm `PUBLIC_API_URL`/`PUBLIC_WEB_URL` use the public HTTPS origin.

### 5.2 Building locally instead of pulling

```bash
JWT_SECRET=<random> docker compose up --build -d
```

The API Dockerfile runs a build step for validation but the runtime uses the workspace source via `tsx` (workspace packages are externalised by tsup). Do not strip the source tree from the image.

### 5.3 Routine release

1. Confirm CI is green on the target commit.
2. Tag the release (`v0.1.x`) so CD publishes a stable image tag.
3. On the server: `cd $DEPLOY_PATH && docker compose pull && docker compose up -d --remove-orphans`.
4. Run the post-deploy checklist (§9).
5. Add the release note entry (see [Release Notes](release-notes.md)).

## 6. CI/CD pipelines

| Workflow | Trigger | Steps |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Push to `master`/`main`, PR, manual | pnpm 9.12.0 / Node 22 → install → `db:migrate` + `db:seed` → typecheck → test → build → API smoke → build both Docker images with GHA cache (no push). |
| `.github/workflows/cd.yml` | Push to `master`/`main`, `v*` tags, manual | Build & push both images to GHCR with branch/tag/sha/`latest` tags; optional `deploy` job on `master` when `DEPLOY_ENABLED=true`, SSHing to run `docker compose pull && docker compose up -d --remove-orphans`. |

To enable automatic deployment, set repository variable `DEPLOY_ENABLED=true` and secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_PATH`. The environment is named `production`. Deployment can also be performed manually as in §5.3.

## 7. Database operations

### 7.1 Migrations and seed

- Automatic: the API entrypoint runs `pnpm --filter @gymlytics/db migrate` on every container start.
- Manual: `pnpm db:migrate` and `pnpm db:seed` from the repo root (or inside the container against the mounted volume).
- Demo seed runs **only** when the database file was absent before migration. Existing data is never overwritten by a restart.

### 7.2 Backup

Automation is not included in 0.1.0. Use one of these procedures on a schedule before releases:

**Option A — volume snapshot (stop the stack first for a consistent copy):**
```bash
docker compose stop api
docker run --rm -v gymlytics-data:/data -v "$PWD/backups":/backup alpine:3.20 \
  sh -c "mkdir -p /backup/\$(date +%F) && cp -a /data/. /backup/\$(date +%F)/"
docker compose start api
```

**Option B — copy from the stopped container (keeps WAL/SHM files together):**
```bash
docker compose stop api
mkdir -p backups
docker cp "$(docker compose ps -q api)":/data .   # copy the entire /data directory
docker compose start api
```

Store backups off-host, encrypt them, and record the image tag they correspond to. A backup taken while the API is writing may be inconsistent — always stop the writer or use a proper SQLite `.backup` API.

### 7.3 Restore

1. Stop the stack: `docker compose down` (the named volume is retained).
2. Preserve the current volume state using §7.2 first.
3. Restore the chosen snapshot into the volume, e.g.:
   ```bash
   docker run --rm -v gymlytics-data:/data -v "$PWD/backups/<date>":/backup alpine:3.20 \
     sh -c "cp -a /backup/. /data/"
   ```
4. Start with the matching image tag: `IMAGE_TAG=<tag> docker compose up -d`.
5. Verify `/health`, `/ready`, login, and a check-in (TC-23).

Migrations are forward-only. Restoring an old database into a newer image requires running the intervening migrations before the API starts; always test restore on staging first.

## 8. Rollback procedure

1. Record the currently deployed tag: note `IMAGE_TAG` in `.env` and the digest from `docker compose images`.
2. Take a database backup (§7.2) **before** rolling back code.
3. Set `IMAGE_TAG` to the previous known-good tag (a sha tag is safest).
4. `docker compose pull && docker compose up -d --remove-orphans`.
5. Verify `/health`, `/ready`, login, dashboard and one check-in; run TC-24 on staging when possible.
6. If the release included a migration, decide explicitly: either keep the new schema (usually safe if compatible) or restore the matching DB snapshot. Do not assume the old image understands new columns.
7. Update [Release Notes](release-notes.md) with the rollback reason.

## 9. Post-deploy checklist

- [ ] `curl -fsS http://<host>:8080/health` returns `{"ok":true,...}`.
- [ ] `curl -fsS http://<host>:8080/ready` returns success (DB readable).
- [ ] SPA loads; deep link such as `/admin/analytics` renders (nginx history fallback).
- [ ] Login works; dashboard shows expected KPIs.
- [ ] Kiosk pairs and one test check-in syncs without duplicates.
- [ ] Webhook endpoint rejects an unsigned request (smoke script covers this locally).
- [ ] `docker compose logs --tail=200 api` shows no startup errors or repeated retry storms.
- [ ] Jobs run in exactly one process (`JOBS_ENABLED=false` on extras).
- [ ] TLS certificate and `PUBLIC_*` URLs are correct.
- [ ] Backup for the pre-release state exists off-host.

## 10. Troubleshooting playbook

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `web` returns 502/504 on `/v1` | API not healthy or `API_UPSTREAM` wrong | Check `docker compose ps`, `logs api`; verify `API_UPSTREAM=api:3000` and `/health`; restart web after API is healthy. |
| API exits on startup with a secret error | `JWT_SECRET` missing or dev default in production | Generate `openssl rand -hex 32`, set in `.env`, restart. |
| `/ready` fails but `/health` passes | DB path/permissions or corrupt SQLite | Check `DATABASE_URL`, `/data` mount permissions, `docker compose logs api`; restore from backup if corrupt. |
| Kiosk shows "Queued (n)" forever | Network blocked, wrong `X-Device-Id`, token expired, or API rejects academy | Check browser online state, re-pair device (`POST /v1/auth/device`), check sync route logs and `applied_mutations`; verify academy id on the token. |
| Duplicate check-in after reconnect | Client reused a different `mutationId`; unique constraint should prevent this | Inspect `attendance_logs.mutation_id` and outbox rows; re-run TC-05; treat as S1 if reproduced. |
| Conflicts appearing on kiosk | Simultaneous edits from another device | Review `conflict_of_id`/`last_error`, apply LWW policy or resolve manually; do not delete conflict rows silently. |
| Payment webhook returns error / repeats | Bad signature secret, provider key rotation, or stale event | Check provider dashboard and `webhook_events.status/last_error`; confirm signature key config; replay from provider after fixing. |
| Membership renewed twice | Idempotency ledger missing row or manual re-apply | Inspect `webhook_events` and `transactions.idempotency_key`; restore correct state and open an S1 defect. |
| Dunning retries not running | `JOBS_ENABLED=false`, no due rows, or no saved payment method | Check env, `payment_retries` due rows and provider capability; confirm only one instance owns timers. |
| SMS/email never arrives | Credentials absent or queue failed | Notifier falls back to console; check Twilio/SendGrid env and `notification_jobs.status/attempts/last_error`. |
| Mobile cannot reach API | `EXPO_PUBLIC_API_URL` points to localhost on a phone | Use the LAN IP and rebuild the Expo bundle. |
| Ops cannot access `/admin` after deploy | nginx SPA fallback broken or hashed assets missing | Check `try_files` template, `/assets/` response headers and browser console errors. |
| Disk filling up | SQLite/WAL growth or backups inside the volume | Monitor `/data`; move backups off-host; consider VACUUM after a maintenance window with the API stopped. |
| Two schedulers running | Second API instance left `JOBS_ENABLED=true` | Set `JOBS_ENABLED=false` on all but one instance and restart. |

## 11. Security operations

- Rotate `JWT_SECRET` (forces all users to log in) and `KIOSK_DEVICE_KEY` (forces tablets to re-pair) on a schedule or after a suspected compromise.
- Rotate provider webhook secrets in the provider dashboard and update the matching env var together; monitor `webhook_events` for signature failures.
- Never paste tokens, PINs, signature images or medical notes into logs/tickets.
- Keep the API unpublished; expose only nginx and terminate TLS upstream.
- Review role assignments (`users.role`) and `family_links` permissions when staff or custody changes.

## 12. Monitoring recommendations

Not yet automated in 0.1.0; recommended minimum before GA:

1. Alert on `/health` and `/ready` failures (container healthchecks already configured: 30 s interval, 5 retries for API; 3 retries for web).
2. Alert on `webhook_events.status='failed'`, `notification_jobs.attempts>=3`, and `sync_outbox.status='failed'` growth.
3. Track API error rate and p95 latency, SQLite file size, and queue depth (`Queued (n)` on kiosks).
4. Centralise logs with redaction; the API logs at `LOG_LEVEL`.

## 13. Known gaps and follow-ups

| Gap | Impact | Follow-up |
| --- | --- | --- |
| No automated database backup/restore | Manual process; human error risk | Schedule volume snapshots with retention and test restores. |
| No staging environment | Production is the first real deploy target | Add a staging host with separate DB/volume. |
| No leader election for jobs | Multiple API instances duplicate timers | Dedicated job runner or advisory lock; use `JOBS_ENABLED=false` meanwhile. |
| No mobile build/submit pipeline | Mobile releases are manual | Add Expo EAS workflow. |
| No browser e2e in CI | UI regressions found manually | Add Playwright job using a seeded test DB. |
| `PaymentRouter` not used by billing routes | Provider choice is explicit, not capability-selected | Make capabilities configuration-driven and wire routing. |
| `SYNC_*` env vars not read by backend | Sync behaviour hardcoded in web kiosk | Read config from a shared source. |
