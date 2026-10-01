# Prompt 03 - Document ingestion and extraction

Add safe, auditable document ingestion to Appraise. Preserve the working manual workflow and use the same canonical domain entities after human confirmation.

Implement immutable `SourceDocument`, versioned `ExtractionRun`, and reviewable extraction drafts. Original uploads must never be overwritten. Store hashes, media type, size, storage location, parser version, model, prompt version, schema version, status, errors, and provenance.

For XLSX:

- parse workbook structure deterministically;
- preserve sheet names, rows, cells, merged ranges, original and displayed values, and formulas where relevant;
- create LLM-friendly blocks without flattening away coordinates;
- handle multi-row headers, empty separator rows, multiple tables per sheet, and comma decimals.

For PDF:

- support digital-text PDFs first;
- define a clear scanned/image fallback;
- preserve page numbers and evidence text, and bounding boxes when available;
- handle tables continuing across pages.

Use a model-provider interface. Implement Claude Sonnet using Instructor and Pydantic structured output, plus a deterministic fake provider for tests and local development. Define separate schemas for specification extraction and supplier-quote extraction. Use bounded retries on schema or arithmetic validation errors. Never use an infinite retry loop.

Validate quantities, prices, totals, subtotal/tax/grand-total consistency, headers misclassified as rows, unsupported units, currency ambiguity, negative amounts, duplicate positions, and values without provenance.

Build an extraction-review screen that shows editable extracted fields beside their source page, sheet, row, or cell evidence. Nothing becomes a canonical SpecItem, SupplierQuote, or QuoteLine until a user confirms it.

Create realistic fixtures:

- irregular multi-sheet XLSX;
- PDF table across pages;
- scanned/image PDF or a documented fixture strategy;
- malformed and partially supported files;
- a model response that fails validation before succeeding on a bounded retry.

The stage is complete when different XLSX and PDF fixtures produce reviewable drafts with provenance, failures are recoverable, the fake provider makes tests deterministic, and confirmation promotes drafts into the existing manual workflow.

Run relevant tests, lint, type checks, and builds. Update `docs/implementation-status.md` with extraction limitations and evidence.

