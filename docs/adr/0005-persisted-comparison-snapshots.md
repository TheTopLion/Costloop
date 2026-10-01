# ADR 0005: Persisted comparison snapshots

- Status: Accepted
- Date: 2026-09-16

## Decision

Materialize bid leveling as immutable `ComparisonSnapshot` and `ComparisonCell` records rather than a transient join. Cells separately record raw, normalized, converted, commercially adjusted, and evaluated values plus warnings, exclusions, and match evidence. Awards reference a snapshot version.

## Consequences

Past decisions remain explainable after quotes, rates, or rules change. Refresh creates a new snapshot and consumes storage. Snapshot creation requires deterministic hashing/idempotency and careful invalidation UX.
