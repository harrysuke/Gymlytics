# C4 Level 3 — Kiosk check-in & delta sync components

```mermaid
C4Component
    title Component diagram — offline kiosk check-in and sync
    updateLayoutConfig($c4ShapeInRow="3", $c4BoundaryInRow="1")

    Person(receptionist, "Front-desk staff")

    Container_Boundary(kiosk, "Vue 3 Kiosk (browser)") {
        Component(checkin_ui, "Check-In UI", "Vue SFC", "PIN / QR / name search; shows Queued count")
        Component(engine, "SyncEngine", "@gymlytics/sync", "Push + pull loops, online/offline listeners")
        Component(outbox, "Transactional Outbox", "sync_outbox table", "Durable mutation queue with backoff")
        Component(hlc, "HLC + LWW resolver", "@gymlytics/sync", "Causal ordering and conflict detection")
        Component(local_db, "Local SQLite", "sqlite-wasm + OPFS", "attendance_logs, users, bookings, waivers")
        Component(transport, "HttpSyncTransport", "fetch", "Bearer token, X-Device-Id, batches of 100")
    }

    Container_Boundary(api_boundary, "Fastify API") {
        Component(push_route, "POST /v1/sync/push", "Fastify route", "Zod-validated batch intake")
        Component(ledger, "Idempotency ledger", "applied_mutations", "Replays return the original ack")
        Component(applier, "Attendance applier", "Drizzle", "Insert once; flag duplicate entity ids")
        Component(pull_route, "GET /v1/sync/pull", "Fastify route", "HLC cursor, excludes own device")
        Component(cursor, "Sync cursors", "sync_cursors", "Per-device last server HLC")
    }

    ContainerDb(primary, "Primary DB", "SQLite → PostgreSQL", "System of record")

    Rel(receptionist, checkin_ui, "Enters PIN / scans QR")
    Rel(checkin_ui, local_db, "1. INSERT attendance_log (sync_status=local)")
    Rel(checkin_ui, outbox, "2. INSERT outbox row — SAME transaction")
    Rel(engine, outbox, "3. Claim due rows (max 100)")
    Rel(engine, hlc, "Tick HLC on write; observe on ack/pull")
    Rel(engine, transport, "4. push(batch)")
    Rel(transport, push_route, "HTTPS")
    Rel(push_route, ledger, "5. SELECT by mutation_id first")
    Rel(push_route, applier, "6. Insert canonical row")
    Rel(applier, primary, "write")
    Rel(push_route, engine, "7. SyncAck per mutation")
    Rel(engine, outbox, "8. ack / schedule retry with backoff")

    Rel(engine, transport, "9. pull(since=cursor)")
    Rel(transport, pull_route, "HTTPS")
    Rel(pull_route, cursor, "read + advance")
    Rel(pull_route, primary, "SELECT WHERE hlc > since")
    Rel(pull_route, engine, "changes + serverHlc")
    Rel(engine, hlc, "10. LWW compare")
    Rel(engine, local_db, "11. Upsert remote changes")
```

## Sequence: check-in with the network down

```mermaid
sequenceDiagram
    participant S as Staff
    participant K as Vue Kiosk
    participant L as Local SQLite
    participant E as SyncEngine
    participant A as API

    S->>K: Scan QR / enter PIN
    K->>L: BEGIN; INSERT attendance; INSERT outbox; COMMIT
    K-->>S: "Checked in — Queued (1)" (instant)
    Note over E,A: Wi-Fi is down. Outbox row survives reload and power loss.
    E->>E: Retry with exponential backoff (1s → 60s + jitter)
    Note over E,A: Browser fires 'online'
    E->>A: POST /v1/sync/push (batch of 100, idempotency keys)
    A->>A: mutation_id in applied_mutations? → return stored ack
    A-->>E: SyncAck[] + serverHlc
    E->>L: Mark rows acked, update sync_status='synced'
    E->>A: GET /v1/sync/pull?since=<cursor>
    A-->>E: Changes from other devices (LWW-applied)
    E-->>S: "Queued (0) · Synced just now"
```

## Why this design converges

1. **Client owns identity.** A check-in gets a UUIDv7 id and a mutation id offline. There is no
   server round-trip in the critical path and no autoincrement collision on merge.
2. **Atomic local commit.** Attendance and outbox share one SQLite transaction; there is no
   state where a check-in exists but sync does not know about it.
3. **Idempotent push.** The server's `applied_mutations` table turns at-least-once delivery into
   effectively-once application. Lost responses are harmless.
4. **Deterministic conflict handling.** HLC ordering plus device-id tie-break gives every device
   the same answer. Append-only facts dedupe; mutable rows surface a conflict card.
5. **Bounded memory.** Batches of 100 and HLC cursors keep sync cost O(changes), not O(table size).
