# Third-party notices

This file records third-party code distributed with Appraise. Architecture and workflow references are listed separately because reviewing a project does not authorize copying its code.

## Planned direct dependencies

No application dependencies have been installed at Stage 00. Before release, lockfiles and built artifacts must be used to generate a complete notice/SBOM with exact package names, versions, copyright notices, and license texts where required.

The following planned components are approved in principle subject to version-level license verification during implementation:

| Component | Intended use | Expected license |
| --- | --- | --- |
| Next.js / React / TypeScript | Web application | MIT / Apache-2.0 for TypeScript |
| Supabase client and CLI components | Database, Auth, Storage integration and local development | Apache-2.0 (verify each component) |
| Pydantic | Python validation and contracts | MIT |
| Instructor | Structured model output adapter | MIT |
| Anthropic SDK | Claude provider client | MIT (verify selected package/version) |
| RapidFuzz | Lexical matching features | MIT |
| XlsxWriter | New proposal workbook generation | BSD-2-Clause |
| openpyxl | Editing an existing template only if later required | MIT |
| PDF/XLSX parsing and embedding libraries | Deterministic intake and candidate retrieval | To be selected after license and security review |

“Expected license” is not a substitute for the dependency's shipped license. Stage implementation must update this file from the resolved dependency graph and preserve all required notices.

## Reference-only projects

ERPNext, Odoo, OpenConstructionERP, and similar estimating/ERP systems may be studied for public data-model, workflow, and UX ideas only. They are not dependencies, and no source code, assets, translations, schemas copied verbatim, or derivative implementation from GPL, AGPL, non-commercial, source-available, or unclear-license repositories may enter Appraise without a separate written compatibility decision and notice update.

## Contribution rule

Any copied or adapted third-party code must be identified in the same change with its source URL, exact revision/version, files affected, copyright holder, license, modifications, and compatibility rationale. Unclear licensing blocks reuse; independently implement the behavior from the product requirements instead.
