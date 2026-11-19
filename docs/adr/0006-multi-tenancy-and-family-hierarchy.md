# ADR-0006: Tenant-scoped schema with graph-based family/guardian links

- **Status:** Accepted
- **Date:** 2026-11-19

## Context

The product should be sellable to multiple academies without a database per customer. Every
domain query therefore needs a tenant boundary. At the same time, billing and waivers are
household-level concerns: a parent pays for two children, signs their waivers, and may book
classes on their behalf. A simple `parent_id` column on `users` cannot express two guardians,
per-guardian permissions, or a guardian who is not themselves a student.

## Decision

- Every domain table carries `academy_id`. The API derives it from the authenticated session
  (or `X-Academy-Id` for kiosk sync) and includes it in query predicates; no endpoint trusts a
  client-supplied tenant id for authorisation.
- `users` is one table for all humans, with a `role` and a `status`. Children and drop-ins may
  have no email or password — they authenticate through a guardian link, PIN or QR token.
- `family_links` is an edge table `(academy_id, guardian_id, dependent_id, relationship)` with
  per-edge permission flags: `is_primary_billing`, `can_sign_waivers`, `can_view_progress`,
  `can_book_classes`. A child can have multiple guardians; a guardian can manage many children.
- Money flows through `transactions.userId` (the beneficiary) and `transactions.payerId`
  (the paying guardian). Membership plans carry `family_discount_percent` and `max_dependents`;
  pricing logic is shared in `@gymlytics/shared/domain/pricing`.
- Waivers store `guardian_user_id` and a `date_of_birth_snapshot` so a minor's signature is
  legally attributable and survives later edits to the child's profile.

## Consequences

### Positive

- One deployment serves many academies with clear data isolation.
- Household structure is data, not code: custody changes are an UPDATE, not a migration.
- Auditors can trace who paid for whom and who signed which version of a waiver.

### Negative / risks

- Forgetting `academy_id` in a query is a cross-tenant leak. Mitigation: repository helpers
  that always accept a tenant scope; integration tests asserting isolation; RLS on PostgreSQL
  after the dialect migration.
- Recursive permission checks can get expensive. Mitigation: cache the guardian→dependent
  adjacency list in the session token for the common case.

## Alternatives considered

| Option | Why not |
| --- | --- |
| Database-per-academy | Simple isolation, but painful migrations and unusable cross-academy analytics |
| `parent_id` column on users | Cannot model two guardians or per-guardian permissions |
| Separate Guardian and Student tables | Duplicates identity; a guardian may also train |
