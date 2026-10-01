import json
from pathlib import Path

from appraise_worker.matching import evaluate_matches, match_lines

FIXTURES = Path(__file__).parent / "fixtures" / "matching"


def load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_exact_multilingual_matches_auto_confirm_and_hard_conflicts_never_auto_match() -> None:
    fixture = load("development.json")
    matches = match_lines(fixture["specification"], fixture["quotes"])
    selected = {match.spec_item_id: match for match in matches if match.review_status == "confirmed"}
    assert selected["s1"].quote_line_id == "q1"
    assert selected["s1"].component_scores["hard_conflicts"] == []
    assert all(match.review_status != "confirmed" for match in matches if match.quote_line_id in {"q_bad_diameter", "q_bad_grade"})


def test_scope_bundle_is_reviewed_as_superset_and_evaluation_metrics_prevent_critical_auto_matches() -> None:
    fixture = load("evaluation.json")
    matches = match_lines(fixture["specification"], fixture["quotes"])
    bundle = next(match for match in matches if match.quote_line_id == "q5")
    metrics = evaluate_matches(matches, {spec_id: set(values) for spec_id, values in fixture["expected"].items()})
    assert bundle.relation == "SUPERSET" and bundle.review_status == "pending"
    assert metrics == {
        "recall_at_1": 1.0,
        "recall_at_5": 1.0,
        "recall_at_10": 1.0,
        "auto_match_precision": 1.0,
        "automatic_decision_coverage": 0.5,
        "review_rate": 0.5,
        "unmatched_rate": 0.0,
        "critical_conflict_false_matches": 0.0,
    }
