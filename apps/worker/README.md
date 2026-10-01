# Appraise worker

From this directory:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
uvicorn appraise_worker.main:app --reload --port 8001
pytest
```

The worker exposes `/health` and `/ready`. For local document processing, the web app invokes:

```powershell
python -m appraise_worker.extract_cli
```

The CLI accepts one JSON request on stdin with `filename`, `content_base64`, and
`kind` (`specification` or `supplier_quote`). It supports `.xls`, `.xlsx`, and
digital-text `.pdf` inputs up to 10 MiB, returns review drafts and provenance on
stdout, and writes sanitized errors to stderr. The default provider is the
explicitly labeled deterministic fake provider. Set
`APPRAISE_EXTRACTION_PROVIDER=anthropic` plus the required API settings and
install `.[anthropic]` to use the optional Claude adapter.

Matching quality is reproducible from the repository root with
`npm run worker:matching-report`. Proposal workbooks are generated through
`python -m appraise_worker.proposal_export_cli`; it accepts one bounded JSON
payload on stdin, writes the verified XLSX bytes to stdout, and never receives
supplier identifiers or source-cost fields.
