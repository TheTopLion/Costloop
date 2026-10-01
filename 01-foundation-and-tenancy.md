# Prompt 01 - Foundation and tenancy

Continue building Appraise in the current repository. Read the architecture and implementation-status documents first. Inspect existing code and preserve working behavior.

Implement the production-shaped foundation:

- Next.js TypeScript web app with a coherent component and domain structure;
- Python worker/service with typed configuration and health checks;
- Supabase local configuration, migrations, and seed data;
- authentication and company membership;
- company-scoped projects;
- private object storage for uploaded and generated documents;
- audit events for important mutations;
- background-job records with idempotency keys, status, attempts, errors, and retry metadata;
- environment examples and documented local commands.

Every tenant-owned table must have `company_id` directly or a reliably enforceable ownership path. Enable Row Level Security and write meaningful tests proving that a member of Company A cannot read or mutate Company B's projects, documents, quotes, prices, jobs, or exports.

Use PostgreSQL `numeric` and Decimal-compatible application types for money and quantities. Define currencies explicitly. Avoid binary floating point in business logic.

Implement the initial screens for authentication, company setup, project list, project creation, and project overview. Do not leave placeholder actions that appear functional.

Add a realistic seed company with two users, several projects, suppliers, and specification rows. Include a second company specifically for tenancy tests.

The stage is complete when a clean checkout can start locally from documented commands, migrations and seeds succeed, a user can enter a company workspace and create a project, and isolation tests pass.

Run lint, type checks, relevant tests, and a production build. Fix failures within scope. Update `docs/implementation-status.md` with evidence and begin no later stage unless this foundation is stable.

