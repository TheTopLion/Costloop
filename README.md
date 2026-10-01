# Appraise

Appraise is a multi-tenant cost-estimation application for project-based industrial work. This repository contains a Next.js web application, a Python worker, and a Supabase/PostgreSQL system of record.

The permanent product contract is [docs/product-spec.md](docs/product-spec.md). Current progress and validation evidence are in [docs/implementation-status.md](docs/implementation-status.md).

## Prerequisites

- Node.js 20 or newer
- Python 3.11 or newer
- Docker Desktop and the Supabase CLI for the local database

## Web application

```powershell
npm install
Copy-Item apps/web/.env.example apps/web/.env.local
npm run dev
```

Open `http://localhost:3000`. Without Supabase environment values, the UI reports an unconfigured state and does not simulate successful persistence.

## Worker

```powershell
python -m venv apps/worker/.venv
apps/worker/.venv/Scripts/Activate.ps1
python -m pip install -e ".\apps\worker[dev]"
uvicorn appraise_worker.main:app --app-dir apps/worker --reload --port 8001
```

## Local database

```powershell
supabase start
supabase db reset
supabase test db
```

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run build
python -m pytest apps/worker/tests
python -m ruff check apps/worker
```

The numbered Markdown files at the repository root remain the ordered execution prompts for later milestones.
