# ADR-0003: Custom HLC + outbox delta sync for the front-desk kiosk

- **Status:** Accepted
- **Date:** 2026-11-19
- **Deciders:** Principal Architect
- **Related:** [C4 component view](../architecture/c4-component-kiosk-sync.md)

## Context

A gym front desk cannot stop checking people in because the Wi-Fi dropped. Check-in must be
instant, must survive a tablet reboot, and must converge with the server without double
counting attendance when the connection returns. Competing writers are possible (two kiosks,
a coach on mobile, an admin in the dashboard), and device clocks drift.

The sync set is small and mostly append-only: attendance events, bookings, waiver signatures,
occasional drop-in registrations. We need bounded bandwidth and an auditable conflict story.

## Decision

Build a **custom delta-sync queue** in `@gymlytics/sync`:

1. **Local-first SQLite (OPFS).** The kiosk holds a subset of the server DDL in a browser
   SQLite file. PIN lookup and check-in never touch the network.
2. **Transactional outbox.** Attendance row + `sync_outbox` row commit in one local
   transaction. Each outbox row carries a client-generated UUID, a `mutationId` idempotency
   key, an HLC and a version.
3. **HLC ordering.** Hybrid Logical Clock `<ISO>-<counter>-<deviceId>` provides monotonic
   order across skewed clocks and causally advances on every ack/pull.
4. **Idempotent push.** `POST /v1/sync/push` checks `applied_mutations` by `mutationId` and
   returns the stored ack for replays. Batches of 100; exponential backoff 1s→60s with jitter.
5. **Cursor pull.** `GET /v1/sync/pull?since=<hlc>` returns rows newer than the device cursor,
   excluding rows that device authored. LWW resolves mutable entities; append-only facts
   dedupe; genuine conflicts are flagged, never silently discarded.
6. **UI contract.** `SyncState` (`online`, `queued`, `conflicts`, `lastSyncedAt`) is surfaced
   to the kiosk so staff can see "Queued (3)" without understanding sync internals.

## Consequences

### Positive

- Zero network dependency in the check-in path; no vendor lock-in for the offline store.
- Deterministic convergence and an auditable conflict trail.
- Transport and storage are injected interfaces — testable in Node, reusable for mobile later.

### Negative / risks

- We own correctness: retries, tombstones, conflict UI and schema evolution are our job.
  Mitigation: keep the engine small, heavily tested, and entity appliers generated from the
  shared schema.
- OPFS availability varies by browser. Mitigation: PWA kiosk on a managed Chromium browser;
  in-memory fallback for development only.
- Server must expose tunable tables; kiosk clock changes cannot break ordering because HLC
  advances from observed server HLCs.

## Alternatives considered

| Option | Why not |
| --- | --- |
| PowerSync | Excellent product, but adds a managed service and a second sync schema to operate; custom queue gives full control for a small, append-only change set |
| ElectricSQL | Similar trade-off; shape streaming is more than this workload needs |
| CouchDB/PouchDB replication | Attachment/replication model does not fit our relational Drizzle schema, and conflict semantics are per-document rather than per-field |
| Queue only to localStorage | Not durable enough for a shared kiosk and cannot participate in LWW on the server |
