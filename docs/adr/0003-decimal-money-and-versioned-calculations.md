# ADR 0003: Decimal money and versioned calculations

- Status: Accepted
- Date: 2026-09-16

## Decision

Use PostgreSQL `numeric`, Python `Decimal`, and a TypeScript Decimal implementation for quantities and money. Serialize decimals as strings. Currency, rounding, unit conversion, exchange-rate snapshot, tax basis, markup basis, and calculation-rule version are explicit inputs. Persist raw and normalized values separately.

## Consequences

Calculations are reproducible and avoid binary floating-point errors. Boundary validation is mandatory, JSON consumers cannot assume numeric tokens, and comparison/export tests must verify rounding and totals.
