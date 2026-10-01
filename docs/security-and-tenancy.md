# Security and tenancy

## Security model

Supabase Auth establishes identity; company membership establishes tenant access; PostgreSQL RLS enforces it. UI visibility and server route checks improve usability but are not authorization boundaries. The default posture is deny: a table or storage operation is unavailable until a specific policy permits it.

Roles are `owner`, `admin`, `estimator`, and `viewer`. Viewers read tenant data; estimators perform estimating workflows; admins manage workspace configuration; owners additionally control destructive or ownership-sensitive settings. Stage 01 must record an explicit permission matrix and test it. Membership invitations are outside the MVP.

## Ownership paths

Every tenant-owned row carries `company_id`. Access is allowed only when an active membership exists for `auth.uid()` and that exact company. Parent relationships add integrity, not implicit authorization:

```text
Company
├── Membership ── UserProfile/Auth user
├── Supplier
├── Project
│   ├── SpecItem
│   ├── SupplierQuote ── QuoteLine
│   ├── ComparisonSnapshot ── ComparisonCell
│   ├── AwardDecision
│   ├── Proposal ── ProposalVersion
│   └── ActualCost
├── SourceDocument ── ExtractionRun ── ExtractedDraft
├── BackgroundJob
└── AuditEvent
```

Composite foreign keys or constraint triggers ensure a child `company_id` matches its parent. No policy relies only on user-supplied JWT metadata naming a company. Membership is checked against database rows. Security-definer functions are exceptional, schema-qualified, use a fixed safe `search_path`, revoke default public execution, validate role and company internally, and are covered by adversarial tests.

## RLS policy pattern

RLS is enabled and forced on every tenant-owned table. Policies use a small, reviewed membership predicate and separate `USING` and `WITH CHECK` rules. Inserts cannot choose another tenant's `company_id`; updates cannot move rows between tenants. Canonical promotion and sensitive transitions use narrowly scoped RPCs when one transaction spans several tables.

Service-role access bypasses RLS and is therefore limited to trusted server/worker processes. Each service query still includes `company_id`, validates referenced rows, and logs the actor/job. The service-role key never reaches the browser, client logs, generated documents, or model prompts.

Required automated tests use at least two companies and multiple roles to prove:

- cross-tenant select, insert, update, delete, RPC, and guessed-UUID access fail;
- cross-tenant foreign-key attachment fails;
- inactive/non-member users have no tenant access;
- role restrictions apply within a tenant;
- storage listing, download, upload, replacement, and signed-URL creation cannot cross tenants;
- background operations reject mixed-company payloads;
- audit rows cannot be altered by ordinary users.

Tests must run against a real local Postgres/Supabase stack, not only mocked query clients.

## Authentication and browser/server split

The Next.js server validates Supabase sessions using current server-side auth helpers and never trusts an unverified cookie payload. Authorization is re-evaluated for mutations. CSRF protections follow the framework's same-site cookie and origin validation model; state-changing custom endpoints validate origin and use non-GET methods. Session and signed URLs are not written to analytics.

Secrets live in environment configuration or the deployment secret manager. Public variables are limited to the Supabase URL and anonymous/publishable key. Anthropic and worker secrets remain server-side. Secret rotation and incident procedures are documented before pilot deployment.

## Private document storage

Uploads and generated exports use private buckets. Object keys are server-generated and tenant-prefixed, for example `companies/{company_id}/documents/{document_id}/{immutable_filename}`. The path is not proof of authorization; database membership and storage policies must agree.

Before acceptance, the server enforces an allowlist (`.xlsx`, `.pdf` for intake; `.xlsx` for generated proposals), size limits, normalized safe filenames, MIME checks, and file-signature checks where practical. It rejects macro-enabled or unsupported workbook types in the MVP. Parsers operate with time, memory, page/row, archive expansion, and decompression limits. Uploaded content is untrusted and never executed. Malware scanning is a pilot-deployment requirement if an approved scanning facility is available; otherwise the limitation is explicit in the runbook.

Objects are immutable: replacement creates a new UUID/path and database record. SHA-256 is computed during trusted ingestion and verified before processing. Downloads use short-lived signed URLs created after authorization; URLs are not persisted in audit metadata or sent to an LLM. Worker access is limited to the specific job document.

## Model-provider privacy and prompt safety

Only document blocks needed for extraction are sent to the configured provider. The provider adapter records model and contract versions and supports redaction/data-retention configuration. Credentials are held by the worker. Document text is data, never instructions: prompts delimit it, tool/schema output is validated, and extracted URLs/formulas/macros are not followed or executed.

LLM output is untrusted. Pydantic/schema validation, size and enum limits, Decimal parsing, provenance requirements, and deterministic consistency checks run before a draft is exposed. Retries are bounded. No provider response can call database tools, select a tenant, accept a match, award work, or publish an export.

## Audit, privacy, and retention

Audit events capture identity, tenant, action, entity, time, correlation ID, and a sanitized change summary. Sensitive source text, secrets, tokens, signed URLs, and full model payloads are excluded from routine logs. Raw structured extraction responses are retained only where safe, tenant-scoped, and necessary for audit/debugging.

Retention, backup, deletion, and legal-hold policy must be agreed before production. Until then, destructive tenant deletion is not exposed in the MVP UI. Operational database backups and private-object backups must be restored in a rehearsal before pilot sign-off.

## Threat-focused checklist

- Broken object-level authorization: RLS, composite tenant constraints, guessed-ID tests.
- Confused-deputy worker: tenant-scoped job payload validation and least privilege.
- Malicious documents: signature/type checks, parser limits, no macro execution, optional malware scan.
- Prompt injection/data exfiltration: bounded document-only context, schema output, no tools, no secrets or signed URLs.
- Spreadsheet injection: escape dangerous leading formula characters in user text; formulas are emitted only from trusted templates.
- Numeric manipulation: Decimal-only services, explicit currencies/rates, server recomputation, immutable snapshots.
- Replay/duplicate processing: unique idempotency keys, leases, immutable input hashes.
- Audit tampering: append-only permissions and restricted service functions.
- Sensitive logs: structured allowlisted fields and redaction tests.
