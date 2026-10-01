# Appraise technical architecture

## Status and scope

This document is the implementation contract for the MVP described in `docs/product-spec.md`. Appraise is a multi-tenant B2B SaaS for project-based industrial cost estimation. The core vocabulary is industry-neutral even though the first pilot serves ship-repair estimators.

The required workflow is:

`project -> specification -> supplier quotations -> extraction review -> line matching -> bid comparison -> award -> markup/tax -> XLSX proposal -> actual costs -> variance`

The MVP excludes historical semantic search and automatic historical-price filling, predictive risk models, purchase orders, accounting, inventory, supplier portals, team invitations, real-time collaborative editing, and automatic awards. Stable identifiers and version fields may prepare for later features, but no unused UI or production integration should be built for them.

## System boundaries

### Web application

`apps/web` is a Next.js TypeScript application using the App Router. It owns browser-facing workflows, server-rendered pages and route handlers, Supabase Auth integration, human review, and orchestration of domain commands. React components do not contain authorization, financial formulas, or persistence logic. Server-side application services call generated Supabase types and shared domain contracts.

The browser uses only the Supabase anonymous key. Elevated credentials, Anthropic credentials, and worker signing secrets are server-only. UI state is not a system of record.

### System of record

Supabase provides PostgreSQL, Auth, and private Storage. PostgreSQL is canonical for business entities, state transitions, comparison snapshots, awards, export metadata, and audit records. Storage contains immutable uploads and generated artifacts. RLS is the last authorization boundary for every browser- or user-token-accessible operation.

Schema changes are ordered SQL files in `supabase/migrations`. Generated TypeScript database types live in `packages/database`; handwritten domain behavior does not live in generated files.

### Worker

`apps/worker` is Python and owns asynchronous, resource-intensive work:

- deterministic XLSX and PDF preparation;
- schema-constrained extraction through the model-provider interface;
- normalization and match candidate generation;
- comparison materialization when it is too expensive for the request path;
- deterministic XlsxWriter proposal generation and verification.

Pydantic defines worker contracts. Instructor is an adapter for structured Claude calls, not a domain boundary. A deterministic fake provider supports local development and tests. AI may propose extracted values, attributes, matches, and uncertainty explanations; it never authorizes access, mutates canonical records directly, performs money arithmetic, advances workflow state, chooses an award, or accepts a draft.

### Shared contracts

`packages/domain-contracts` contains JSON-schema-compatible wire contracts, enumerations, state-transition definitions, and Decimal serialization conventions shared across services. `packages/ui` holds reusable presentational components. Cross-language contracts are generated or verified from versioned schemas rather than duplicated informally.

## Proposed monorepo

```text
apps/
  web/
    app/
    components/
    lib/
    tests/
  worker/
    app/
      extraction/
      ingestion/
      matching/
      proposal/
      jobs/
    tests/
packages/
  domain-contracts/
  database/
  ui/
supabase/
  migrations/
  seed.sql
  tests/
fixtures/
  documents/
  matching/
docs/
  adr/
  architecture.md
  domain-model.md
  implementation-status.md
  product-spec.md
  security-and-tenancy.md
pnpm-workspace.yaml
package.json
pyproject.toml
.env.example
THIRD_PARTY_NOTICES.md
```

The intended baseline is Node.js 22 LTS, pnpm 10, Python 3.12, `uv`, Docker, and the Supabase CLI. Exact versions are pinned when scaffolding is created.

## Exact local-development commands

These commands are the proposed stable developer interface. Stage 01 must implement the referenced scripts before marking them available.

```powershell
corepack enable
pnpm install --frozen-lockfile
uv sync --all-groups --frozen
Copy-Item .env.example .env.local
pnpm supabase:start
pnpm db:reset
pnpm dev
```

`pnpm dev` runs the Next.js app and Python worker concurrently. Separate processes remain available as `pnpm dev:web` and `pnpm dev:worker`.

Validation commands:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:rls
uv run ruff check apps/worker
uv run mypy apps/worker
uv run pytest
pnpm build
```

Environment configuration must name public browser settings with `NEXT_PUBLIC_` and keep `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, and worker-signing secrets unprefixed and server-only. Local development defaults to the fake extraction provider unless a developer explicitly selects Anthropic and supplies credentials.

## Data and calculation rules

Uploaded `SourceDocument` objects are immutable evidence. A replacement is a new document record and object, never an overwrite. Parser output and LLM output belong to versioned extraction runs and reviewable drafts. Only an explicit, audited confirmation command promotes a draft into canonical `SpecItem` or `QuoteLine` records.

All monetary and quantity values use PostgreSQL `numeric` and language Decimal types. JSON transports decimals as base-10 strings. JavaScript `number`, Python `float`, and database floating types are prohibited for business arithmetic. Currency is an explicit ISO 4217 code. Rounding mode, currency scale, tax basis, and markup basis are versioned inputs to deterministic calculation services.

Raw supplier values are retained verbatim alongside parsed values. Normalized quantity, unit, currency, unit price, and total occupy separate columns. Conversions cite a versioned unit rule or exchange-rate snapshot. A comparison never rewrites its source quote line.

## Versioning and reproducibility

Every derived result records its inputs and rule versions:

- extraction: source-document SHA-256, parser name/version, extraction schema version, prompt version, model provider/model, and raw structured response where safe;
- normalization: normalization-rules version and unit-registry version;
- matching: mapping/configuration version, embedding model/version, component scores, thresholds, and human override;
- currency: immutable rate snapshot with base/quote currencies, decimal rate, source, and effective timestamp;
- comparison: immutable snapshot version containing cells, warnings, exclusions, conversion inputs, and calculation-rules version;
- export: proposal version, template version, exporter version, source comparison/award versions, generated document hash, and verification result.

Published proposal versions, confirmed extraction runs, and comparison snapshots used for an award are append-only. Corrections create a successor version with a reference to the prior version.

## Background jobs and idempotency

Request handlers validate tenant access, create a durable job record in the same transaction as the triggering state change, and return without doing document or model work. A worker claims jobs using an atomic lease. Job types include document preparation, extraction, normalization, matching, comparison materialization, and proposal export.

Each job has `company_id`, type, canonical payload, idempotency key, status, attempt count, maximum attempts, lease owner/expiry, timestamps, and structured error. The unique idempotency key is derived from operation type plus immutable input IDs and version identifiers. Re-delivery must return the existing result or safely resume; it must not create duplicate runs, snapshots, or exports.

Retries are bounded and use backoff. Validation failures become review warnings; provider/network failures may retry; permanent input errors fail without retry. Workers use least-privilege database functions or explicit tenant-scoped service queries and verify the job's company against every referenced record. State transitions and job results are committed transactionally. Expired leases are reclaimable, and operators can retry failed jobs without changing the idempotency key unless inputs change.

## Observability and audit

Structured logs include request/job correlation IDs, company ID, user ID when present, entity IDs, versions, duration, and outcome, but not document contents, model prompts containing customer data, access tokens, or secrets. Metrics cover job latency/failure/retry, extraction validation warnings, matching review rate, false critical-conflict matches, export verification, and RLS test results.

`AuditEvent` is append-only and records meaningful user and service actions, including draft confirmation, manual match decisions, awards, proposal publication, project completion, and actual-cost changes. Application logs do not replace the audit trail.

## Delivery sequence

1. Foundation and tenancy: workspace/tooling, migrations, Auth, membership, RLS, private storage, audit, seed data.
2. Manual vertical slice: canonical entry, comparisons, deterministic award/financial logic, manual-data export.
3. Ingestion and extraction: immutable XLSX/PDF uploads, parser artifacts, provider abstraction, provenance, review and promotion.
4. Matching and bid leveling: registries, retrieval, constraints, confidence bands, review queue, snapshots.
5. Proposal export: versioned builder and verified XlsxWriter artifact.
6. Cost history and pilot: completion, actual costs, variance, operations, security and recovery hardening.
7. Independent final audit and material fixes.

Each stage verifies prior acceptance criteria and updates `docs/implementation-status.md`; documentation alone is not evidence that a capability is complete.
