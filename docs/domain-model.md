# Domain model

## Conventions

All primary keys are UUIDs. Tenant-owned tables have `company_id uuid not null`, even when ownership can also be reached through a project, so RLS is simple and indexable. Foreign keys use the composite `(company_id, id)` form where practical to prevent cross-tenant references. Mutable tables carry `created_at`, `created_by`, `updated_at`, and an optimistic concurrency `revision`; immutable/versioned tables omit in-place business edits.

Money and quantity columns are PostgreSQL `numeric`, never floating-point. Currencies are explicit ISO 4217 codes. TypeScript represents decimals as validated strings at boundaries and a Decimal library in calculations; Python uses `decimal.Decimal`. Units use canonical registry keys while preserving raw text.

## Identity and tenancy

### Company

A tenant workspace: `id`, `name`, optional registration/contact details, default currency, locale, timezone, status, timestamps. Company settings are not copied into historical proposal versions; exports snapshot relevant values.

### UserProfile and Membership

`UserProfile.id` equals the Supabase Auth user ID and stores non-sensitive display preferences. `Membership` joins user and company with role (`owner`, `admin`, `estimator`, `viewer`), status, and timestamps. The unique key is `(company_id, user_id)`. MVP workspace creation is supported; invitations are excluded.

## Project and canonical estimating data

### Project

Tenant-owned estimate container: project number, name, client details, description, base currency, status (`draft`, `estimating`, `awarded`, `completed`, `archived`), dates, and revision. Transitions are explicit application commands and audited.

### SpecItem

A canonical requested line: project, stable line key, display position, description, parsed/normalized quantity and unit, technical attributes JSON, ordering key, lifecycle status, and optional promotion provenance. Original document values remain in draft/provenance records rather than being overloaded into the canonical line.

### Supplier

A company-scoped supplier master with name, legal/contact information, active status, and optional external reference. It is not shared across tenants.

### SupplierQuote

A supplier's versioned commercial offer for a project: supplier, quote reference, issue/validity dates, stated currency, status (`draft`, `in_review`, `confirmed`, `superseded`), source document, commercial terms, and revision. A replacement quote is a new quote/version, not destructive mutation of the evidence.

### QuoteLine

A canonical confirmed supplier row. It preserves:

- raw description, quantity, unit, unit price, line total, and currency;
- parsed decimal values;
- normalized description, quantity, unit, unit price, total, and currency;
- normalization/unit-rule/rate-snapshot versions;
- technical attributes, position, warnings, and provenance.

Raw strings remain unchanged. Parsed and normalized values may be corrected only through an audited revision or successor quote version.

## Evidence and extraction

### SourceDocument

Immutable uploaded or generated object metadata: company, optional project, purpose, original filename, private bucket/path, MIME type, byte size, SHA-256, uploader, and creation timestamp. The storage object key is unique and never overwritten. A generated proposal is linked as an artifact but is still immutable by hash.

### ExtractionRun

One attempt over one source document: company, document, purpose (`specification` or `supplier_quote`), status, parser/version, provider/model, prompt version, schema version, start/end times, bounded attempt count, error, sanitized raw structured response, and content hash. Runs are append-only.

### ExtractedDraft

A review container tied to an extraction run and target type. It has status (`pending_review`, `confirmed`, `rejected`, `superseded`), validation summary, reviewer, review time, and promotion transaction ID. Draft lines hold extracted fields, confidence, review edits, warnings, and one or more `SourceRef` records containing page, sheet, row range, cell range/bounding box, and short evidence text. Confirmation atomically creates or updates canonical entities and writes an audit event; model completion alone cannot confirm a draft.

## Matching and comparison

### LineMatch

A versioned relation between one or more spec items and one or more quote lines. Relation type is `MATCH`, `NO_MATCH`, `PARTIAL`, `SUPERSET`, `SPLIT`, or `MERGED`. Join tables represent each side with allocation quantity/factor where needed. The record stores method, lexical and semantic scores, hard-constraint results, total confidence, configuration/mapping version, review status, human override, reviewer, timestamp, and explanation. A critical unit, diameter, material grade, rating, or scope conflict cannot be auto-accepted.

### ExchangeRateSnapshot

An immutable rate used by a comparison: provider/source, base currency, quote currency, decimal rate, effective time, retrieval time, and source reference. Manual rates are explicitly marked with author and reason.

### ComparisonSnapshot

An immutable, numbered materialization for a project: input quote/spec revisions, exchange-rate snapshots, normalization and calculation rule versions, creation status, creator, and hash. Awards reference a completed snapshot. Refreshing creates another snapshot.

### ComparisonCell

One supplier offer evaluation for a specification row within a snapshot. It distinguishes raw amount/currency/quantity/unit; normalized amount and unit conversion; currency conversion and rate snapshot; commercial adjustments; evaluated amount; comparability; warnings; exclusions; match IDs/confidence; and cheapest/spread indicators. This is persisted evidence, not a transient join.

### AwardDecision

An explicit human decision against a comparison snapshot. Scope is per line or whole quotation. It references selected supplier/quote/cell, actor, timestamp, reason, and revision. Deterministic validation rejects an excluded/non-comparable selection unless an authorized user records an override reason. The application never infers an award from the lowest price.

## Proposal and actual cost

### Proposal and ProposalVersion

`Proposal` is the project-level identity and numbering series. Each immutable `ProposalVersion` snapshots client/company display information, selected lines, Decimal unit prices/totals, markup/tax configuration, subtotal, tax, grand total, currency, validity, source award/comparison versions, template/exporter versions, status, creator, and publication time. Generated workbook document ID, SHA-256, and verification result are recorded. Draft edits create a new version when published; published workbooks are never overwritten.

### ActualCost

A project/spec-item actual-cost entry with supplier/reference, quantity, unit, unit cost, total, currency, conversion snapshot, incurred date, note, and revision. Multiple entries per line are allowed. Variance is deterministically derived against the awarded estimate and can be materialized with the calculation-rule version. Completing a project does not make audit corrections impossible; corrections are revisioned and audited.

### AuditEvent

Append-only event: company, actor user or service principal, action, entity type/ID, request/correlation ID, timestamp, sanitized before/after or change summary, reason, and metadata. Events cannot be updated or deleted through normal application roles.

## State and integrity rules

- Source documents, confirmed extraction runs, comparison snapshots, published proposal versions, exchange-rate snapshots, and audit events are append-only.
- Canonical promotion, awards, project transitions, and proposal publication run inside database transactions.
- Every cross-entity command proves all records share one `company_id`.
- Quantity multiplied by unit price is checked against line total using versioned tolerance/rounding rules; mismatches are warnings until a human resolves them.
- Subtotal, tax, and total are recomputed deterministically and never trusted from LLM output.
- Unsupported units, currency ambiguity, negative amounts, duplicate/missing positions, probable headers/subtotals, and missing provenance produce review warnings.
- Deleting referenced business records is normally forbidden; lifecycle statuses and superseding versions preserve history.

## Indexing baseline

Every tenant table begins composite indexes with `company_id`. Expected hot paths include membership by user/company, projects by company/status, items by project/order, quotes by project/supplier, extraction runs by document/status, jobs by status/lease, matches by project/review status, snapshot cells by snapshot/spec item, and audit events by company/time/entity. Search indexes and future embeddings are versioned additions, not part of the Stage 00 schema contract.
