# Appraise implementation prompt for Codex

You are the lead engineer responsible for building Appraise from an empty or partially initialized repository into a working pilot-ready MVP.

## How to work

Infer routine implementation details from the repository and this prompt. Bias toward action and carry the work through to a runnable, tested result. Do not stop after writing a plan or scaffolding placeholder screens. When a decision is reversible and does not materially change the product scope, choose a sensible default, document it, and continue.

Before asking me a question, complete all work that is possible without the answer. Ask only when missing information would materially change the architecture, cause an external cost, require credentials, or trigger an irreversible external action.

Start by inspecting the repository, its instructions, current code, configuration, and git state. Preserve existing user work. If the repository is empty, initialize it using the architecture below. Create a concise implementation plan and then execute it. Keep a living `docs/implementation-status.md` containing completed work, current decisions, validation commands, and the next milestone.

Use subagents for independent research, code review, or parallel implementation only when the environment supports them and the work can be safely isolated. Keep ownership of integration and final verification.

Run appropriate tests and checks after meaningful changes. Do not write tests that merely duplicate the implementation. Prefer tests for monetary calculations, tenant isolation, document validation, matching rules, state transitions, and export correctness.

At the end of each milestone, report:

1. What is now usable.
2. Important architectural decisions.
3. Tests and checks that passed.
4. Remaining risks or blocked integrations.
5. The next milestone you will execute.

Continue into the next milestone while safe and useful work remains. Do not wait for approval between internal implementation stages.

## Product

Appraise is a multi-tenant B2B SaaS application for project-based industrial cost estimation. The initial market is ship repair in the Kazakhstan Caspian region, but the terminology and data model must remain industry-neutral so the product can later support construction and industrial services.

Companies currently spend up to two weeks preparing cost estimates because repair statements, work specifications, and supplier quotes arrive in inconsistent PDF and Excel formats. Appraise converts those documents into structured line items, compares multiple supplier offers, lets an estimator select suppliers, produces a client-facing commercial proposal, and later records estimated versus actual costs.

Use neutral UI terms such as `Project`, `Specification`, `Line item`, `Supplier quote`, and `Proposal`. Do not hardcode ship-repair terminology into the core domain.

## MVP outcome

A company user must be able to:

1. Register and create a company workspace.
2. Create a project and enter a specification manually.
3. Upload an XLSX or PDF specification and review extracted line items before saving.
4. Add multiple suppliers and upload their quotations.
5. Review and correct extracted quote rows.
6. Match supplier quote rows to specification rows.
7. Compare normalized prices side by side, including missing bids and price-spread warnings.
8. Select a winning supplier per line or for the whole quotation.
9. Add markup and tax and generate a polished client-facing XLSX proposal.
10. Mark a project complete and record actual costs per line item.
11. View estimated cost, actual cost, and variance.

Historical semantic search, automatic historical price filling, advanced ML risk prediction, purchase orders, accounting, inventory, supplier portals, and team invitations are outside the MVP unless required as small internal foundations.

## Required architecture

Use this architecture unless the existing repository already contains a compatible and clearly better implementation:

- Web application: Next.js with TypeScript and the App Router.
- Database, authentication, row-level authorization, and file storage: Supabase with PostgreSQL and Storage.
- Data access: choose a typed approach that works cleanly with Supabase and migrations. Keep domain logic out of React components.
- Background processing: a Python worker/service for document preparation, LLM extraction, normalization, matching, and XLSX generation.
- Structured extraction: Pydantic models with Instructor and Claude Sonnet as the default model. Put the model provider behind an interface so it can be replaced or mocked.
- XLSX input: parse workbook structure deterministically before calling the model. Preserve sheet name, row number, cell coordinates, merged ranges, displayed values, formulas where relevant, and original values.
- PDF input: preserve page numbers and, when available, bounding boxes or quoted evidence.
- XLSX output: XlsxWriter for new client-facing workbooks. Use openpyxl only when editing a pre-existing template becomes necessary.
- Matching baseline: deterministic normalization, RapidFuzz lexical features, multilingual embeddings for candidate retrieval, hard technical constraints, and a human-review state for uncertain matches.
- Future historical retrieval: design stable IDs and versioned embeddings so Supabase pgvector can be added later, but do not build the v1.5 UI in the MVP.

The Next.js application and Python worker may live in a monorepo. Prefer a structure similar to:

```text
apps/
  web/
  worker/
packages/
  domain-contracts/
  database/
  ui/
supabase/
  migrations/
  seed.sql
docs/
```

Adapt this if the repository already uses a coherent structure.

## Non-negotiable design rules

### AI boundaries

AI may extract fields, suggest normalized attributes, propose matches, and explain uncertainty. Deterministic code must own:

- monetary arithmetic;
- currency and unit conversions;
- taxes, markups, subtotals, and totals;
- authorization and tenant isolation;
- persistence and state transitions;
- final award decisions;
- proposal generation;
- acceptance of extracted data.

Never silently save LLM output as canonical business data. Every extraction run must create a reviewable draft. A human confirms or edits it before promotion.

Do not ask an LLM to recreate a table as Markdown and then parse that Markdown with regular expressions. Send normalized document blocks to a schema-constrained extraction call and receive validated domain JSON.

### Auditability

The original uploaded file is immutable evidence. Do not model a source document as the normalized quotation itself.

Keep separate entities for:

- `SourceDocument`: original object, hash, storage path, media type, size, upload metadata.
- `ExtractionRun`: model, prompt version, schema version, status, timestamps, error, and raw structured response where safe.
- `ExtractedDraft`: reviewable result associated with an extraction run.
- Canonical domain entities created after confirmation.

Each extracted value or line item must retain source provenance such as page, sheet, row, cell range, and evidence text where available.

Version parser prompts, extraction schemas, normalization rules, matching configurations, currency rates used in a comparison, and proposal exports.

### Money and units

Do not use binary floating-point values for money or quantities. Use PostgreSQL `numeric` and Decimal-compatible application types. Store currency explicitly using ISO currency codes.

Preserve original quantity, unit, currency, and price alongside normalized values. A normalized comparison must never destroy the raw supplier value.

Create an extensible unit alias registry that can handle Russian and English forms, including examples such as:

```text
м², м2, m2, кв.м. -> m2
м³, м3, m3, куб.м -> m3
т, tonne -> kg with an explicit factor
пог.м, маш.-ч, компл. -> domain units with explicit definitions
DN50, Ду50 -> normalized diameter attribute
```

### Matching

Treat matching as a cascade:

1. Normalize text, numbers, Unicode, units, dimensions, grades, and scope terms.
2. Extract important structured attributes such as material, diameter, grade, rating, dimensions, and supply/install/test/demolition flags.
3. Retrieve candidates using lexical and semantic similarity.
4. Reject candidates with hard conflicts in critical technical attributes.
5. Rerank remaining candidates.
6. Auto-match only above a calibrated high-confidence threshold.
7. Send the middle-confidence band to human review.
8. Keep unmatched rows visible.

Never allow a high text-similarity score to override an incompatible unit, diameter, material grade, or scope. Support relation types beyond simple one-to-one matching:

- `MATCH`
- `NO_MATCH`
- `PARTIAL`
- `SUPERSET`
- `SPLIT`
- `MERGED`

Store the match method, component scores, confidence, mapping version, human override, reviewer, and timestamp.

### Security and tenancy

Every tenant-owned table must include `company_id` directly or have a reliably enforceable ownership path. Enable and test Supabase Row Level Security. Users from one company must never access another company's projects, documents, quotes, prices, or generated exports.

Private files must use private storage buckets and signed access. Validate MIME type, extension, size, and file signatures where practical. Do not expose model API keys to the browser.

### Licensing

Use permissively licensed libraries as dependencies when appropriate. Instructor, Pydantic, RapidFuzz, XlsxWriter, and compatible embedding libraries are candidates.

Use ERPNext, Odoo, OpenConstructionERP, and similar systems primarily as data-model, workflow, and UX references. Do not copy code from GPL, AGPL, non-commercial, source-available, or unclear-license repositories into the product without first documenting the exact license and compatibility. Record reused code and its license in `THIRD_PARTY_NOTICES.md`.

## Domain model

Design and migrate at least these concepts. Adjust names if needed, but preserve their separation:

- `Company`
- `UserProfile` and company membership
- `Project`
- `SourceDocument`
- `ExtractionRun`
- `SpecItem`
- `Supplier`
- `SupplierQuote`
- `QuoteLine`
- `LineMatch`
- `ComparisonSnapshot`
- `ComparisonCell`
- `AwardDecision`
- `Proposal`
- `ProposalVersion`
- `ActualCost`
- `AuditEvent`

`QuoteLine` must preserve raw description, raw quantity, raw unit, raw unit price, raw total, and raw currency. Store normalized equivalents separately.

`ComparisonCell` must distinguish:

- raw amount;
- normalized amount;
- currency conversion;
- quantity conversion;
- commercial adjustments;
- evaluated amount;
- warnings and exclusions.

Do not implement the comparison matrix as a transient SQL join with no audit history. A user must be able to understand later why a bid was considered cheaper or excluded.

## User experience

Build a clean professional interface for estimators. Prioritize the comparison workspace.

Required screens:

1. Authentication and company setup.
2. Project list and dashboard.
3. New project and project overview.
4. Specification editor with manual entry, paste-from-Excel support, and file import.
5. Extraction review showing source evidence beside editable fields.
6. Supplier and supplier-quote management.
7. Bid-leveling matrix with rows as specification items and suppliers as columns.
8. Match-review queue for uncertain, split, merged, and unmatched rows.
9. Proposal builder with markup and tax controls.
10. Actual-cost and variance view.

The comparison workspace must show:

- requested quantity and unit;
- each supplier's raw and normalized values;
- cheapest comparable offer;
- missing offer;
- price-spread warning;
- non-comparable or conflicting scope;
- match confidence and review status;
- selected winner;
- explanation of adjustments.

Do not hide uncertainty behind a single green check. Let the user open the original source location for every important value.

## Extraction contracts

Create explicit Pydantic schemas. A line-item schema should include fields similar to:

```python
class SourceRef(BaseModel):
    page: int | None = None
    sheet: str | None = None
    row_start: int | None = None
    row_end: int | None = None
    cell_range: str | None = None
    evidence: str | None = None

class ExtractedLine(BaseModel):
    position: str | None = None
    description: str
    quantity: Decimal | None = None
    unit: str | None = None
    unit_price: Decimal | None = None
    line_total: Decimal | None = None
    currency: str | None = None
    technical_attributes: dict[str, str | int | Decimal | bool] = {}
    source: SourceRef
    confidence: Decimal | None = None
```

Refine this model to avoid mutable defaults and to distinguish specifications from supplier quotations.

Validate:

- `quantity * unit_price` against line total when all values exist;
- subtotal, tax, and grand total consistency;
- duplicate or missing position numbers;
- probable headers/subtotals incorrectly extracted as lines;
- currency ambiguity;
- values without provenance;
- unexpected negative amounts;
- unsupported units.

Failed validation should trigger a bounded retry or a review warning, never an infinite model loop.

## Excel proposal

Generate a new polished XLSX workbook with XlsxWriter. At minimum include:

- company and client information;
- proposal number and version;
- project name;
- line number, description, quantity, unit, unit price, and total;
- markup and tax presented clearly;
- subtotal and grand total;
- currency and validity period;
- controlled column widths, number formats, wrapping, repeated headers, print area, page setup, and freeze panes;
- formulas where useful, with backend-calculated values available for verification;
- metadata sheet or hidden audit identifiers only if appropriate and documented.

Write automated checks that reopen the generated workbook and verify expected sheets, cells, formulas, number formats, and totals. Keep a small golden workbook fixture for regression testing if that is practical.

## Implementation milestones

Execute in this order.

### Milestone 0: foundation

- Inspect or initialize the repository.
- Establish monorepo tooling, linting, formatting, tests, environment examples, and local development commands.
- Create the initial domain model and Supabase migrations.
- Implement authentication, company membership, tenant RLS, private storage, and audit events.
- Add seed/demo data.
- Document architecture and local setup.

Exit criterion: a user can authenticate, create or enter a company workspace, and create a project without crossing tenant boundaries.

### Milestone 1: manual vertical slice

- Build project screens.
- Build a manual specification editor.
- Add suppliers and manually entered supplier quotations.
- Build the first comparison matrix.
- Implement deterministic money, markup, tax, award, and proposal calculations.
- Generate an XLSX proposal from manually entered data.

Exit criterion: the complete business workflow works without AI.

### Milestone 2: XLSX intake

- Upload and store XLSX documents.
- Parse sheets, rows, cells, merged ranges, displayed values, and formulas.
- Build a mapping and extraction-review UI.
- Promote confirmed drafts to canonical specification or quote records.

Exit criterion: at least two structurally different workbook fixtures import successfully with provenance and human confirmation.

### Milestone 3: PDF and LLM extraction

- Prepare digital and scanned PDF paths.
- Implement the model-provider abstraction and Claude/Instructor extraction.
- Add prompt/schema versions, validation, bounded retries, confidence, and failure recovery.
- Display page-level evidence in the review screen.
- Provide a deterministic fake provider for tests and local development without API costs.

Exit criterion: representative PDF fixtures produce reviewable drafts, and no model output becomes canonical without confirmation.

### Milestone 4: matching and bid leveling

- Implement normalization registries.
- Implement lexical candidate retrieval and semantic candidate retrieval.
- Add technical-attribute hard constraints.
- Add confidence bands and the match-review queue.
- Support unmatched, partial, split, and merged cases.
- Persist versioned comparison snapshots and adjustments.

Exit criterion: a labeled fixture dataset reports retrieval Recall@5, auto-match precision, and automatic-decision coverage. Prefer very high precision over aggressive automatic coverage.

### Milestone 5: cost history and pilot hardening

- Add project completion and actual-cost entry.
- Calculate variance per line and project.
- Add operational telemetry, job retries, idempotency, useful error messages, and recovery paths.
- Audit tenant isolation, file access, arithmetic, matching thresholds, and export correctness.
- Create a pilot runbook.

Exit criterion: a real pilot user can process a project while every price and decision remains traceable to its source.

## Validation and fixtures

Create realistic sanitized fixtures rather than trivial one-row examples:

- XLSX with multi-row headers, merged cells, formulas, empty separators, comma decimals, and multiple sheets.
- Digital PDF with a long table across pages.
- Scanned PDF or image-based PDF.
- Supplier descriptions with Russian and English wording.
- Unit aliases and conversions.
- Hard-negative pairs differing only in diameter, grade, rating, or supply/install scope.
- One supplier line covering multiple specification items.
- Multiple supplier lines covering one specification item.
- Different currencies and explicit exchange-rate snapshots.

For matching, track at least:

- candidate Recall@1, Recall@5, and Recall@10;
- auto-match precision;
- automatic-decision coverage;
- review rate;
- unmatched rate;
- false matches involving critical technical conflicts.

For the first pilot, target at least 99% precision for automatically accepted matches. It is acceptable for uncertain rows to require review.

## Definition of done

The MVP is complete only when:

- the application runs locally from documented commands;
- database migrations and seed data work from a clean environment;
- tenant isolation is tested;
- the manual end-to-end workflow is complete;
- XLSX and PDF imports produce reviewable drafts with provenance;
- uncertain matches have a usable review workflow;
- financial calculations use deterministic Decimal logic;
- the comparison matrix explains raw, normalized, adjusted, and evaluated prices;
- proposal XLSX generation is verified;
- actual costs and variance are recorded;
- important state changes produce audit events;
- meaningful automated tests pass;
- no production path depends on mock data or placeholder buttons;
- setup, architecture, operational limitations, and next-stage work are documented.

## Start now

Inspect the repository and any available product-context or research files. Summarize the current state in no more than ten lines, write the implementation plan to `docs/implementation-status.md`, and immediately begin Milestone 0. If an existing implementation already covers part of a milestone, verify it and continue from the first incomplete requirement.

Do not merely tell me how you would build Appraise. Build it, validate it, and leave the repository in a runnable state.
