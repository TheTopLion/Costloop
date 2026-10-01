# Prompt 04 - Matching and bid leveling

Implement Appraise's matching engine and production-quality bid-leveling workspace. Preserve raw extracted data and the manual override path.

Build matching as a cascade:

1. Normalize Unicode, punctuation, decimal formats, units, dimensions, material grades, technical codes, and scope terminology.
2. Maintain an extensible Russian/English alias registry for units and domain terms.
3. Extract or derive structured technical attributes such as material, diameter, grade, rating, dimensions, and supply/install/test/demolition flags.
4. Retrieve candidates with RapidFuzz lexical features and multilingual embeddings.
5. Reject candidates with hard technical conflicts.
6. Rerank remaining candidates.
7. Auto-match only in a high-confidence band.
8. Send medium-confidence, split, merged, and scope-conflict cases to human review.
9. Keep low-confidence rows unmatched.

Support `MATCH`, `NO_MATCH`, `PARTIAL`, `SUPERSET`, `SPLIT`, and `MERGED`. Store component scores, method, confidence, model/rule version, reviewer, human override, and timestamps.

Do not let semantic similarity override incompatible units, diameter, grade, rating, material, or scope. Keep quantity conversion factors explicit. Preserve original and normalized values.

Build the main comparison workspace with specification items as rows and suppliers as columns. Show raw and normalized quantity, unit and price, evaluated amount, cheapest comparable bid, missing bid, spread warning, scope conflict, match confidence, selected winner, and a trace back to the source document.

Build a focused review queue for uncertain cases. The user must be able to accept a suggestion, choose another candidate, mark unmatched, split or merge mappings, and record a reason.

Create a labeled fixture dataset with Russian/English descriptions, unit aliases, exact matches, paraphrases, hard negatives, different diameters and grades, bundled scope, one-to-many, and many-to-one cases. Split evaluation fixtures by project so near-duplicate rows do not leak between development and evaluation.

Report candidate Recall@1/5/10, auto-match precision, automatic-decision coverage, review rate, unmatched rate, and critical-conflict false matches. Tune thresholds from fixtures rather than arbitrary constants. For the pilot, prefer at least 99% auto-match precision even if coverage is modest.

The stage is complete when matches are explainable, versioned, reversible, measurable, and usable in the comparison UI. Run the complete validation suite and update `docs/implementation-status.md`.

