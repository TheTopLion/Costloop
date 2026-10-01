# ADR 0001: Monorepo and service boundaries

- Status: Accepted
- Date: 2026-09-16

## Decision

Use a pnpm monorepo with a Next.js/TypeScript App Router application, a Python 3.12 worker managed by `uv`, shared domain/database/UI packages, and Supabase for PostgreSQL, Auth, and Storage. The web service owns interactive commands and review; the worker owns document preparation, extraction, matching workloads, and XlsxWriter generation. PostgreSQL is the system of record.

## Consequences

One repository makes contracts, fixtures, migrations, and cross-service validation reviewable together. Cross-language schemas require explicit generation/compatibility tests. Deployment units and credentials remain separate. Business logic must not drift into React components or provider adapters.
