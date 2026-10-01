# ADR 0006: Row-level security as authorization boundary

- Status: Accepted
- Date: 2026-09-16

## Decision

Every tenant-owned table carries `company_id`, uses cross-tenant integrity constraints, and has forced PostgreSQL RLS based on active company membership. Private Storage uses congruent tenant policies. Server checks supplement but do not replace RLS. Elevated worker access is isolated and still explicitly tenant-scoped.

## Consequences

Direct client access remains tenant-safe when policies are correct. Migrations must never introduce an exposed tenant table without deny-by-default RLS, and two-tenant adversarial database/storage tests are release gates.
