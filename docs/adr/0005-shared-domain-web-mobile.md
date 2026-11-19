# ADR-0005: Vue web + Expo mobile sharing Zod contracts and pure domain logic

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The web stack is fixed (Vue 3 + TypeScript + Tailwind); mobile must be React Native/Expo for
iOS and Android. React and Vue have different reactivity models and component APIs, so UI
code cannot be shared. What *can* and must be shared is the contract layer: request/response
shapes, validation, and business rules such as "is this student eligible for a blue belt?".

Without a shared layer, the mobile app would validate differently from the API and coaches
would see different eligibility than students.

## Decision

- `@gymlytics/shared` contains **Zod schemas** for every API input/output, inferred
  TypeScript types, constants (disciplines, IBJJF ladders, dunning days), and **pure domain
  functions** with no I/O: `evaluatePromotionEligibility`, `canBookClass`, `calculateSale`,
  `calculateFamilyTotal`, `prorateCents`.
- The API parses incoming bodies with those same schemas; web forms and mobile screens parse
  locally before calling the API. Validation errors are identical everywhere.
- Domain functions take plain objects and `Date` values via parameters (never read the clock
  directly except through an optional `now` argument), making them deterministic and testable.
- Web uses TanStack-free simple `fetch` wrappers for v1; mobile has its own `apiRequest`
  because token storage differs (Secure Store vs kiosk session). The *contract* is shared;
  the transport adapter is not.
- Belt eligibility alerts from the cron job, coach dashboard badges and mobile progression
  cards all call the same evaluator.

## Consequences

### Positive

- One place to fix a rule; three consumers update on the next typecheck.
- Zod schemas double as runtime validation and compile-time types — no hand-maintained DTOs.
- Pure functions run in unit tests without a database or a device.

### Negative / risks

- Shared package must stay dependency-light and free of Node/browser globals. Mitigation:
  separate `./schemas`, `./domain` export paths and a lint rule against platform imports.
- Expo/Metro sometimes needs explicit transpilation of workspace packages. Mitigation:
  `exports` pointing at plain `.ts`, no JSX in the shared package.
- Sharing types does not share state; optimistic UI must still be implemented per platform.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Code generation from OpenAPI | Adds a build step and a spec to keep in sync; Zod already gives runtime validation |
| Shared component library | Vue and React Native components are not interchangeable; effort would be wasted |
| Duplicate schemas in each app | Guaranteed drift; explicitly rejected |
