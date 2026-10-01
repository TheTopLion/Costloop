# Prompt 02 - Manual vertical slice

Build the complete Appraise business workflow without relying on AI or document parsing. Read the repository architecture and implementation status, then verify the previous foundation before changing it.

Implement:

- manual specification line entry and editing;
- paste-from-Excel/clipboard row entry with a review step;
- supplier CRUD appropriate for the MVP;
- manually entered supplier quotations and quote lines;
- raw quantity, unit, currency, unit price, and line total preservation;
- a first bid-comparison matrix;
- deterministic normalization hooks for units and currencies;
- explicit missing-bid and non-comparable states;
- supplier selection per line and whole-quote selection when valid;
- deterministic markup, tax, subtotal, and grand-total calculations;
- proposal records and version snapshots;
- audit events for confirmation, matching overrides, awards, and proposal versions.

Keep business logic out of UI components. Create domain services for calculations and state transitions. Prevent invalid transitions and cross-tenant references at both application and database levels where practical.

The comparison view must distinguish raw supplier values, normalized values, commercial adjustments, evaluated values, warnings, and the selected winner. A user must be able to understand why one offer is cheaper or excluded.

Write meaningful tests for Decimal arithmetic, tax and markup rules, quote totals, state transitions, comparison calculations, and tenancy. Use realistic multi-line fixtures with missing bids and different currencies.

The stage is complete when a user can manually create a project, enter a specification, enter at least three supplier quotations, compare them, select winners, and create a versioned proposal record without any AI service.

Run the application and verify the workflow, not only unit tests. Update `docs/implementation-status.md` with commands and evidence.

