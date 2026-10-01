# Prompt 00 - Product architecture

You are the lead engineer for Appraise, a multi-tenant B2B SaaS application for project-based industrial cost estimation. Its initial users are ship-repair estimators, but its terminology and domain model must stay usable for construction and industrial services.

Read the repository, all instruction files, the Appraise product specification, and the five research documents if they are available. Preserve existing work. Do not implement speculative features outside the MVP.

The MVP must support this flow:

`project -> specification -> supplier quotations -> extraction review -> line matching -> bid comparison -> award -> markup/tax -> XLSX proposal -> actual costs -> variance`

Create or refine the technical architecture. Use Next.js/TypeScript for the web application, Supabase/Postgres/Auth/Storage for the system of record, and a Python worker for document extraction, matching, and XlsxWriter export. Use Claude through an interface with Instructor/Pydantic structured output. Keep AI away from monetary arithmetic, authorization, state transitions, and final decisions.

Produce these repository artifacts:

- `docs/architecture.md`
- `docs/domain-model.md`
- `docs/security-and-tenancy.md`
- `docs/implementation-status.md`
- `docs/adr/` with short records for major technology choices
- a proposed monorepo structure and exact local-development commands

Formalize entities for Company, membership, Project, SourceDocument, ExtractionRun, SpecItem, Supplier, SupplierQuote, QuoteLine, LineMatch, ComparisonSnapshot, ComparisonCell, AwardDecision, ProposalVersion, ActualCost, and AuditEvent.

Explicitly document:

- immutable source documents versus normalized business entities;
- raw versus normalized monetary and quantity values;
- Decimal/numeric handling;
- tenant isolation and RLS ownership paths;
- versioning of extraction, normalization, matching, exchange rates, comparisons, and exports;
- background-job boundaries and idempotency;
- which open-source components are dependencies and which projects are references only;
- MVP exclusions.

Then inspect the implementation and begin the smallest safe foundation changes that are clearly required. Do not stop after writing documents if the repository is ready for implementation. Run appropriate checks and update `docs/implementation-status.md` with completed work and the next stage.

