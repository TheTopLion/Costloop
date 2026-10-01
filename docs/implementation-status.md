# Appraise implementation status

Last updated: 2026-09-20

## Current state: Stage 05 in progress

## Chat + live spreadsheet workspace

### Native AI SDK mutation tools (2026-09-20)

The existing assistant now uses AI SDK `generateText`, `tools`, and
`stopWhen: stepCountIs(8)` for automatic multi-step tool roundtrips. No
external agent framework is used. Tool results replace the client-side grid
rows immediately, so successful writes are visible without a page reload.

- `create_project` inserts through the tenant-authenticated `projects` path.
  It requires name and client, inherits the current project currency when one
  is not supplied, and always creates a durable confirmation first.
- `add_spec_line` uses the same `ProjectOperations.addSpecLine` service as the
  grid's single-row POST route. It resolves `spec_sections`, assigns
  `section_id`, places the row after its numbered siblings, and lets the
  database trigger derive `input_status`.
- `edit_spec_line` and the grid PATCH route share
  `ProjectOperations.editSpecLine`; description, quantity, unit, position, and
  estimated unit price therefore use the same validation, normalized fields,
  numeric persistence, revision trigger, and audit trigger.
- `delete_spec_line` resolves the row inside the current project, persists a
  user-scoped pending confirmation, and calls the same scoped delete service
  used by the grid only after an explicit yes.
- `run_comparison` calls the existing Stage 04
  `publish_manual_comparison(uuid)` RPC. It never creates comparison cells or
  values in the model. Migration `202609200002` removes the obsolete complete-
  input gate; incomplete lines remain backend-authored pending-input cells.
- `apply_markup` resolves selected/all/position-scoped IDs inside the current
  project and passes only those IDs and the requested percentage to
  `apply_estimate_percentage`. PostgreSQL performs all Decimal arithmetic and
  returns the durable receipt used by undo.
- `export_proposal` requires confirmation and calls the server-side proposal export service, which reads
  the latest immutable `proposal_versions.calculation_snapshot`, performs no
  monetary arithmetic, uploads the XLSX to the private `generated-exports`
  bucket, records an audited proposal `source_document`, and returns a
  ten-minute signed download action. The signed URL is not exposed to the
  language model.

All tool database access uses the request user's Supabase session. RLS and
company-role policies remain the authorization boundary; item lookup and
mutation additionally include the current `project_id`. Project, specification,
and export-document mutations use the existing database audit triggers, so
their audit-event shape is identical to direct UI actions. Decimal values stay
as strings/PostgreSQL `numeric`; the model never performs business arithmetic.
Destructive and bulk tools use `assistant_confirmations`, scoped to actor,
company, and project, with a 15-minute expiry and one-time consumption.

- Simplified the workspace into a visible four-step route (upload, review,
  compare, proposal) and added an attention-only grid filter. Browser testing
  against Barys confirmed that the filter surfaces its four `needs_input`
  rows without altering source data.
- The assistant handles natural-language navigation, reads, confirmed writes,
  deterministic markup/undo, comparison publication, and proposal export. It
  does not guess missing inputs or calculate financial values in the model.
- Resolved the AG Grid runtime theme conflict by using the v36 Quartz Theming
  API exclusively, rather than loading legacy CSS themes alongside it. Browser
  verification confirmed the grid renders and the chat can identify position
  `8.13` as needing quantity and unit input without inventing either value.
- Added `/projects/[id]/workspace`: an AG Grid Community editable projection of
  real specification data beside a conversational panel. Direct grid edits use
  the tenant-authenticated specification update route, so validation, audit
  triggers, Decimal-safe persistence, and `input_status` remain shared.
- The installed AI SDK exposes its current `generateText` automatic tool-loop
  API; the configured Google provider remains optional. Without a model key,
  the endpoint retains a deterministic local-intent fallback that calls the
  same backend services and confirmation records.
- AI Elements was not installed: its official generator requires shadcn/ui and
  Tailwind CSS, neither of which this existing CSS-based app uses. Replacing the
  styling stack would exceed this presentation-layer change; the chat panel is
  intentionally small and follows the same message/input composition pattern.

Stages 00–03 now provide a runnable, authenticated, multi-tenant foundation,
the manual estimating workflow, and reviewed document ingestion. Stage 04 now
has a conservative matching engine and durable human-review queue. Published
comparisons now use confirmed review decisions when a project has matching
review records; projects that have not begun review retain the legacy exact
position/description resolver for backward compatibility.

Stage 04 is complete. The immutable comparison matrix now shows the reviewed
match confidence, relation, method, source location, normalized quantities,
FX, evaluated values, and percentage difference from the cheapest comparable
offer. The separated evaluation fixture reports Recall@1/5/10 of 1.0,
auto-match precision of 1.0, automatic coverage of 0.5, review rate of 0.5,
unmatched rate of 0, and zero critical-conflict false matches. Run the report
with `npm run worker:matching-report`.

Stage 05 is in progress. Proposal creation now freezes validity, client notes,
commercial terms, client-facing unit prices, line totals, client subtotal, tax,
and grand total in PostgreSQL. The XLSX path uses XlsxWriter, verifies workbook
structure, totals, print settings, and absence of internal identifiers before
upload, and reuses an already-linked immutable export on retry. The workbook
includes seller/client/project metadata, restrained styling, widths, wrapping,
freeze panes, repeated headers, print area, margins, and page numbering.

## 2026-09-18 correction: incomplete specification inputs

Missing units and quantities are never defaulted. The end-to-end browser run
briefly used `each` and `1` to get past the former confirmation gate; those
test values were reverted from the imported `mcv-barys-2025.xlsx` records.
`spec_items.input_status` now records `needs_input` whenever either field is
blank. Extraction promotion retains the blank values, matching can retain the
line as an unresolved candidate, and the comparison UI visibly marks it rather
than fabricating a value. This supersedes the prior requirement that every
specification row be completed before confirmation.

## Completed work

- The permanent product specification remains at `docs/product-spec.md`.
- Supabase provides projects, tenant-safe RLS, immutable source documents,
  extraction runs/drafts, private storage, audit events, and the manual cost
  estimation entities.
- The manual workflow supports specification rows, suppliers, quote rows,
  explicit quote confirmation, saved FX rates, immutable comparison snapshots,
  missing bids, pending-price rows, awards, and immutable proposal snapshots.
- A matched quotation row without a unit price is represented as `missing_bid`
  with the precise reason `pending price`; it is not a zero-valued offer and
  cannot be awarded.
- The document import UI accepts private immutable `.xls`, `.xlsx`, and PDF
  uploads, verifies file signatures and SHA-256, creates durable extraction
  runs/jobs, and offers retryable failures.
- The review UI places editable sections and line-item fields beside sheet,
  cell-range, page, and evidence text. Confirmation is a database transaction;
  it creates canonical records only after review.
- Specification headers are canonical `spec_sections`, never priceable
  `spec_items`. Child line items retain their `section_id`, including nested
  positions such as `1` → `1.1`.
- Blank or `NaN` quantities/prices remain unknown. Quote rows are explicitly
  marked `pending_price` or `pending_quantity`; no missing value is defaulted to
  zero. A human must complete required fields before confirmation.
- The worker parses bounded XLSX structure (formula/cached values, sheets,
  merged ranges, coordinates) and legacy binary XLS through `xlrd`. It supports
  digital-text PDFs with page/word/table evidence and gives a clear OCR/manual
  fallback for scanned PDFs.
- The optional Instructor/Claude provider remains behind an environment-based
  interface. Local tests use an explicitly labeled deterministic fake provider;
  no external model calls were made.
- Stage 04 adds Unicode-safe Russian/English normalization, unit aliases,
  technical attributes (DN, PN, grade, dimensions, material and scope),
  RapidFuzz retrieval, and hard-conflict rejection. An optional multilingual
  embedding adapter is available behind the worker's `embeddings` extra.
- Matching suggestions persist confidence/component evidence and use `MATCH`,
  `NO_MATCH`, `PARTIAL`, `SUPERSET`, `SPLIT`, and `MERGED`. Only compatible
  high-confidence matches are auto-confirmed; the UI supports choosing another
  quote line, marking unmatched, scope relations, and a review reason.
- Stage 04 fixture evaluation is executable rather than prose-only; development
  and evaluation rows are split by project and the exact metric vector is
  regression-tested.
- Stage 05 adds a proposal metadata editor, backend-authored client prices, and
  a verified XlsxWriter workbook. The export worker receives no supplier IDs,
  quote-line IDs, match confidence, or source-cost fields.

## Real client fixtures and Stage 04 reference

The following immutable client fixtures are stored under
`apps/worker/tests/fixtures/client-repair-statements/` and covered by tests:

- `mcv-barys-2025.xlsx`: numbered section headers and children, including the
  `1` / `1.1` repair-work hierarchy.
- `turkestan-2025-base.xls`: legacy Excel parsing and blank source pricing as
  `pending_price` rather than zero.
- `turkestan-2025-price-comparison.xls`: retains the `сравнение цен` worksheet
  as source evidence. Its columns—comparison basis, supplier A, supplier B, and
  difference—are the real-world reference for the Stage 04 comparison UI. It is
  intentionally not flattened into specification line items.

## Validation evidence

Run from the repository root:

```powershell
npm install
npm run lint
npm run typecheck
npm test
npm run build
.\apps\worker\.venv\Scripts\python.exe -m pip install -e ".\apps\worker[dev]"
.\apps\worker\.venv\Scripts\python.exe -m pytest apps\worker\tests
.\apps\worker\.venv\Scripts\python.exe -m ruff check apps\worker
npx --yes supabase@2.117.0 migration up --local
npx --yes supabase@2.117.0 test db --local
```

Verified on 2026-09-18:

- All local migrations through `202609180001` applied without resetting the
  working database.
- `supabase test db --local` passed: 61 pgTAP assertions, including tenant
  isolation, exact FX/unit comparison arithmetic, pending-price handling,
  review promotion, section hierarchy, and immutable proposal snapshots.
- Worker tests passed: 16 tests, including all three real fixtures, legacy XLS,
  hierarchy, comma decimals, blank prices, PDF provenance, malformed input, and
  bounded retry behavior.
- Ruff, web lint, typecheck, unit tests (15), production build, and pgTAP
  checks (61 assertions) all passed. Matching fixtures cover bilingual exact
  matches, incompatible technical attributes, and review-only bundled scope.

Verified on 2026-09-20 against the real 177-item Barys project:

- Chat created position `25.6`, assigned it to section `25` (`Сварочные
  работы`), set `input_status=needs_input` while quantity/unit were missing,
  emitted the normal `spec_items` insert audit event, and raised the live grid
  count from 177 to 178 without reload.
- Chat edited `25.6` to quantity `2` and unit `услуга`; the grid updated live.
  A delete request named the exact row and stopped for explicit confirmation;
  the row was not deleted during the check.
- A 1% markup on the one priced test row produced backend receipt `661b0fad`,
  changed the displayed total from 300,000 to 303,000 KZT, and was then undone
  through the receipt, restoring 300,000 KZT.
- Stage 04 comparison was confirmed and published by the RPC as immutable
  version 4 from one confirmed quote. The model did not produce comparison
  numbers.
- Proposal `APP-2026-001` version 1 exported to a private XLSX and surfaced a
  download button. The reported 606,144 KZT is the persisted proposal-version
  total, not a model calculation. Project creation also completed after its
  mandatory confirmation (`Barys Chat E2E`, client `Barys Test`).
- `npm run typecheck`, `npm test` (18 tests), `npm run lint`, `npm run build`,
  and `npm run worker:test` (17 tests) passed. Local migrations through
  `202609200003` applied without resetting the database. `supabase test db
  --local` passed all 68 pgTAP assertions.
- A representative Stage 05 workbook was reopened, inspected over `A1:F19`,
  scanned for spreadsheet errors, and rendered for visual review. Values,
  typography, widths, totals, notes, and print-oriented layout were legible and
  the scan returned zero formula-error matches.

## Known limitations

- Scanned/image-only PDFs require OCR or manual entry; no OCR engine is bundled.
- The local worker is invoked synchronously from the import action. The
  database job/run records make failures visible and retryable, but a production
  deployment should run this same bounded command from a dedicated worker
  process.
- Claude extraction needs the user-provided API key, model setting, and optional
  worker extra; only the deterministic provider was exercised locally.
- Existing projects that have never generated a matching review intentionally
  retain the Stage 02 exact resolver. Once review records exist, confirmed
  `line_matches` are authoritative and unresolved rows remain missing bids.
- Stage 05 does not yet support per-line client-price overrides or optional
  logos. Export execution is bounded and idempotent at the proposal-version
  link, but still runs synchronously rather than through a dedicated production
  job runner.
- The live estimate editor still uses the browser-side `xlsx` package for its
  generic import/download convenience path; the verified client proposal export
  does not use it.

## Next milestone

Complete Stage 05 with per-line client-price overrides, optional logo support,
and durable background-job execution for exports. Add an end-to-end browser
check for editing proposal terms, creating a second immutable version, and
downloading the verified workbook before moving to Stage 06 cost history and
pilot hardening.
