# ADR-0001: TypeScript pnpm/Turborepo monorepo with shared packages

- **Status:** Accepted
- **Date:** 2026-11-19
- **Deciders:** Principal Architect

## Context

We ship four surfaces — Vue admin web, Vue kiosk, Vue waiver flow, Expo mobile — plus a
Fastify API. They all need the same validation rules (a check-in is a check-in everywhere),
the same belt eligibility rules, and the same API response types. Four repositories would
duplicate business logic and guarantee drift: a promotion eligible on mobile but not in the
coach dashboard is a support ticket waiting to happen.

The team is small and TypeScript-first; we want one install, one typecheck graph, and the
ability to share code without publishing internal packages to a registry.

## Decision

Use a **pnpm workspace + Turborepo** monorepo:

- `apps/*`: `api`, `web`, `mobile`
- `packages/*`: `db`, `shared`, `sync`, `payments`
- `tsconfig.base.json` enforces `strict` and defines `@gymlytics/*` path aliases.
- Workspace packages export **TypeScript source** via `package.json#exports`, so no build
  step is required for internal consumption; Turbo's `dependsOn: ["^build"]` handles the
  cases where a build is needed (API/container output).
- Every shared rule lives in `@gymlytics/shared` as a Zod schema or a pure function.

## Consequences

### Positive

- Single source of truth for DTOs and domain rules; a schema edit surfaces compile errors in
  all four consumers immediately.
- pnpm's content-addressed store keeps installs small; strict dependency boundaries prevent
  accidental undeclared imports.
- Turborepo caches typecheck/test/build outputs locally and in CI.

### Negative / risks

- Expo's Metro resolver can be fussy with workspace packages. Mitigation: keep
  `@gymlytics/shared` dependency-light (only Zod) and Expo-friendly (`type: module`, no
  Node-only imports).
- Sharing TS source means consumer builds must transpile it. Mitigation: explicit package
  `exports` and no decorators or path magic inside shared code.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Separate repos + published npm packages | Release coupling, slow feedback, version skew across clients |
| Single Next.js app + RN app | Vue is a fixed constraint; framework mismatch defeats reuse |
| Nx | Capable, but heavier plugin surface than this monorepo needs |
