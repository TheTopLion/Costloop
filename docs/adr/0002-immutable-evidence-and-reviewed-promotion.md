# ADR 0002: Immutable evidence and reviewed promotion

- Status: Accepted
- Date: 2026-09-16

## Decision

Store every upload as an immutable `SourceDocument`. Parser/model attempts create append-only `ExtractionRun` records and editable review drafts. Only an explicit human confirmation command atomically promotes reviewed fields into canonical specification or quote entities. Provenance is retained per value/line where available.

## Consequences

Users can trace canonical values back to source pages, sheets, rows, cells, or evidence. Reprocessing and corrections create versions rather than erasing history. Storage and database use increase, and promotion logic needs transactional idempotency.
