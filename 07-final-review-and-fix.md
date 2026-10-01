# Prompt 07 - Final review and fix

Act as the senior engineer responsible for deciding whether Appraise is ready for a controlled pilot. Inspect the complete repository, architecture documents, migrations, RLS policies, tests, UI, worker, fixtures, generated XLSX files, and implementation-status claims.

Do not limit yourself to describing problems. Reproduce and fix material issues that are within the repository and the MVP scope. Preserve intentional product decisions.

Audit these areas:

- complete end-to-end user workflow;
- tenant isolation and private document access;
- authorization of confirmations, awards, exports, and actual costs;
- immutable source documents and provenance;
- extraction schemas, bounded retries, and human confirmation;
- Decimal money and quantity handling;
- raw versus normalized data preservation;
- matching hard constraints, confidence bands, overrides, and metrics;
- comparison explainability and versioning;
- proposal calculation and XLSX content;
- background-job idempotency and recovery;
- database constraints, indexes, migrations, and clean setup;
- accessibility and failure states;
- secrets, logs, and accidental exposure of sensitive commercial data;
- license compatibility and third-party notices;
- documentation accuracy.

Run a clean setup if practical, apply migrations, seed data, start required services, and execute the representative pilot scenario. Run focused security, domain, worker, integration, and build checks. Inspect at least one generated workbook structurally and visually when tooling allows.

Record findings by severity in `docs/pilot-readiness-review.md`, including evidence and the fix applied. Resolve all critical and high-severity issues that can be fixed in scope. Do not mark the pilot ready while a known cross-tenant leak, incorrect monetary calculation, silent extraction acceptance, untraceable price, broken export, or unrecoverable job failure remains.

Finish with one explicit verdict:

- `READY FOR CONTROLLED PILOT`
- `NOT READY FOR PILOT`

Support the verdict with passed checks, remaining limitations, and the exact next action. Update `docs/implementation-status.md` so it matches the verified state of the repository.
