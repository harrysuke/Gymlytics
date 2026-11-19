# C4 Level 2 — Containers

```mermaid
C4Container
    title Container diagram for Gymlytics
    updateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")

    Person(coach, "Front desk / Coach", "Tablet check-in and class management")
    Person(student, "Student / Guardian", "Web + mobile self-service")

    Container_Boundary(platform, "Gymlytics platform") {
        Container(web_admin, "Admin Dashboard", "Vue 3, TS, Tailwind", "Scheduling, curriculum, members, billing")
        Container(web_kiosk, "Front-Desk Kiosk", "Vue 3, TS, sqlite-wasm", "PIN / QR / name check-in; works offline")
        Container(web_waiver, "Waiver Flow", "Vue 3, TS, Canvas", "E-signature capture + PDF request")
        Container(mobile, "Mobile App", "Expo, React Native, TS", "Bookings and belt progression (iOS + Android)")

        Container(api, "API Server", "Node.js, Fastify, TS", "Auth, domain rules, idempotent webhooks")
        Container(scheduler, "Job Runner", "Node.js cron", "Reminders, belt alerts, payment dunning")
        Container(primary_db, "Primary Database", "SQLite (Drizzle) → PostgreSQL", "System of record, all tenant data")
        Container(kiosk_db, "Kiosk Local DB", "SQLite via OPFS", "Offline check-ins + durable outbox")
    }

    Container_Boundary(shared, "Shared workspace packages") {
        Container(pkg_shared, "@gymlytics/shared", "Zod + pure TS", "DTOs, domain logic, constants")
        Container(pkg_sync, "@gymlytics/sync", "TypeScript", "HLC, outbox, LWW, push/pull engine")
        Container(pkg_pay, "@gymlytics/payments", "TypeScript", "Provider adapters + routing")
        Container(pkg_db, "@gymlytics/db", "Drizzle schema", "One schema, two dialects")
    }

    System_Ext(stripe, "Stripe")
    System_Ext(billplz, "Billplz")
    System_Ext(ipay88, "iPay88")
    System_Ext(twilio, "Twilio / SendGrid")

    Rel(coach, web_kiosk, "Checks in students")
    Rel(student, web_admin, "Guardian portal")
    Rel(student, mobile, "Books classes, tracks rank")
    Rel(student, web_waiver, "Signs waivers")

    Rel(web_admin, api, "HTTPS / JSON")
    Rel(web_kiosk, api, "Delta sync push/pull")
    Rel(web_kiosk, kiosk_db, "Reads/writes locally")
    Rel(web_waiver, api, "Submits signed payload")
    Rel(mobile, api, "HTTPS / JSON")

    Rel(web_admin, pkg_shared, "imports")
    Rel(web_kiosk, pkg_sync, "imports")
    Rel(mobile, pkg_shared, "imports")
    Rel(api, pkg_shared, "imports")
    Rel(api, pkg_pay, "imports")
    Rel(api, pkg_db, "imports")
    Rel(pkg_sync, pkg_db, "shares DDL shape")

    Rel(api, primary_db, "Drizzle queries")
    Rel(scheduler, primary_db, "Due-job queries")
    Rel(scheduler, twilio, "SMS / email")
    Rel(api, stripe, "Subscriptions + webhooks")
    Rel(api, billplz, "FPX bills + callbacks")
    Rel(api, ipay88, "Hosted checkout + callbacks")
```

## Container responsibilities

| Container | Owns | Never does |
| --- | --- | --- |
| Kiosk | Local check-in, outbox, queue UI | Direct calls to payment providers |
| API | Authorisation, idempotency, domain writes | Store raw card data or signature images on CDN |
| Job Runner | Time-based side effects | Mutate domain state without a ledger row |
| Primary DB | Durable system of record | Accept unsynchronised client-generated ids without dedupe |
| `@gymlytics/shared` | Pure functions and schemas | Import Node or browser APIs |
| `@gymlytics/sync` | Transport + conflict resolution | Know about Vue or React Native |
| `@gymlytics/payments` | Provider mechanics | Decide *which* membership plan a student gets |

## Deployment shape

- **Admin / waiver / API / job runner**: single Node process plus static asset hosting initially;
  split the job runner into its own container once cron volume justifies it.
- **Kiosk**: one tablet browser per front desk, PWA-installable, OPFS storage, locked to a
  device id. Losing the network degrades to local-only, never to "cannot check in".
- **Mobile**: standard Expo application; no offline write queue in v1 (read-heavy screens only).
