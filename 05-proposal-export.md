# Prompt 05 - Proposal builder and Excel export

Complete the Appraise proposal workflow and produce a professional client-facing XLSX file from versioned, deterministic data.

Build a proposal editor that lets an authorized user review selected lines, descriptions, quantities, units, client-facing unit prices, line totals, markup, tax, currency, validity period, notes, and commercial terms. Support global markup and per-line overrides without losing the underlying selected supplier cost.

All totals must be calculated with Decimal-compatible deterministic logic shared with or checked against the backend. Persist an immutable snapshot for each proposal version, including source comparison version, exchange rates, adjustments, and calculation inputs.

Use XlsxWriter to generate a new workbook. Include:

- seller and client information;
- proposal number, version, date, and validity;
- project name;
- line number, description, quantity, unit, unit price, and total;
- subtotal, markup presentation, tax, and grand total;
- explicit currency;
- professional typography and restrained styling;
- sensible widths, wrapping, number formats, repeated headers, freeze panes, print area, margins, page setup, and page breaks;
- formulas where useful, while retaining backend-calculated values for verification;
- optional logo support without making it mandatory;
- no internal supplier cost, confidence score, or hidden commercial data in the client-facing workbook.

Generate files through a background job, store them in private storage, and provide signed downloads. Ensure retries are idempotent and do not create inconsistent versions.

Add automated verification that reopens the workbook and checks sheet names, key cells, formats, formulas, totals, dimensions, and absence of internal-only fields. Create a representative golden fixture and, if the environment permits, render or inspect the workbook visually.

The stage is complete when a user can turn a comparison award into a versioned proposal and download a verified XLSX that is suitable to send to a client.

Run relevant checks and update `docs/implementation-status.md` with a sample-generation command and known compatibility limitations.

