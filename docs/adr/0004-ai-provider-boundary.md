# ADR 0004: AI provider boundary

- Status: Accepted
- Date: 2026-09-16

## Decision

Define a model-provider interface in the Python worker. The default production adapter uses Claude Sonnet through Instructor with Pydantic structured output; tests and credential-free local development use a deterministic fake. Inputs are deterministically prepared document blocks and outputs are schema-validated drafts.

AI is limited to extraction, suggested normalization/attributes, candidate matches, and uncertainty explanations. It does not perform authorization, canonical persistence, arithmetic, state transitions, awards, draft acceptance, or export calculations.

## Consequences

Provider replacement and deterministic tests are possible. Prompt/schema/model versions and bounded retry behavior become required data. Provider output remains untrusted and requires human review before promotion.
