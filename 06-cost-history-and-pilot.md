# Prompt 06 - Cost history and pilot hardening

Finish the Appraise MVP for a real pilot. Preserve the existing workflow and focus on actual costs, reliability, observability, and recoverability.

Implement project completion and actual-cost entry per specification line. Preserve supporting evidence and allow authorized corrections through versioned records or audit events rather than silent overwrites.

Show:

- estimated cost;
- awarded/selected cost;
- actual cost;
- absolute and percentage variance;
- project totals;
- missing actuals;
- lines with unusually high variance based on a simple configurable threshold.

Do not implement ML risk prediction or historical auto-fill. Structure completed line items so v1.5 can later generate versioned embeddings and use Supabase pgvector without changing stable business IDs.

Harden background jobs for upload processing, extraction, embeddings if present, and export generation. Add idempotency, bounded retries, failure states, safe reprocessing, useful user-facing errors, and operator diagnostics. Ensure reprocessing creates a new extraction or comparison version rather than corrupting accepted data.

Review and fix:

- tenant RLS and private file access;
- role checks for confirmation, awards, exports, and actual-cost changes;
- file validation and size limits;
- secret handling;
- audit coverage;
- Decimal arithmetic;
- database constraints and indexes;
- N+1 queries and obvious performance issues;
- accessibility and keyboard use in the main comparison workflow;
- loading, empty, partial, and failure states;
- backup and migration documentation.

Create `docs/pilot-runbook.md` describing setup, onboarding, supported document types, known limitations, recovery steps, and how to report a bad extraction or match.

Create a realistic end-to-end pilot fixture and verify:

`upload -> review -> confirm -> compare -> resolve matches -> award -> export -> complete -> actual costs -> variance`

The stage is complete when the documented clean-environment setup works and the full pilot scenario passes without manual database edits or mock-only paths. Update `docs/implementation-status.md` with evidence and remaining non-MVP work.

