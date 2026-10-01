"""Explainable, conservative line matching for bid leveling.

The engine only proposes mappings. PostgreSQL records the proposal and a human
may override it; incompatible technical attributes are never auto-matched.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from rapidfuzz import fuzz, process

Relation = Literal["MATCH", "NO_MATCH", "PARTIAL", "SUPERSET", "SPLIT", "MERGED"]

UNIT_ALIASES = {
    "м": "m", "m": "m", "meter": "m", "metre": "m",
    "шт": "each", "шт.": "each", "pc": "each", "pcs": "each", "piece": "each", "each": "each", "ea": "each",
    "кг": "kg", "kilogram": "kg", "kg": "kg", "т": "tonne", "ton": "tonne", "tonne": "tonne",
    "м2": "m2", "м²": "m2", "m2": "m2", "m²": "m2", "квм": "m2",
    "м3": "m3", "м³": "m3", "m3": "m3", "m³": "m3", "кубм": "m3",
    "час": "hour", "ч": "hour", "hour": "hour", "hr": "hour", "h": "hour",
}

TERM_ALIASES = {
    "труба": "pipe", "трубы": "pipe", "трубопровод": "pipe", "трубопровода": "pipe", "pipe": "pipe",
    "клапан": "valve", "клапана": "valve", "задвижка": "valve", "valve": "valve",
    "сталь": "steel", "steel": "steel", "нержавеющая": "stainless", "stainless": "stainless",
    "поставка": "supply", "supply": "supply", "монтаж": "install", "installation": "install", "install": "install",
    "демонтаж": "demolition", "dismantling": "demolition", "demolition": "demolition",
    "испытание": "test", "testing": "test", "test": "test", "и": "", "and": "",
}

SCOPE_TERMS = frozenset({"supply", "install", "demolition", "test"})
MATERIAL_TERMS = {"steel": "steel", "stainless": "stainless", "бронза": "bronze", "bronze": "bronze", "латунь": "brass", "brass": "brass"}


@dataclass(frozen=True)
class TechnicalAttributes:
    unit: str | None
    diameter: str | None
    grade: str | None
    rating: str | None
    material: str | None
    dimensions: tuple[str, ...]
    scope: frozenset[str]


@dataclass(frozen=True)
class NormalizedLine:
    id: str
    position: str | None
    raw_description: str
    normalized_description: str
    attributes: TechnicalAttributes


@dataclass(frozen=True)
class MatchSuggestion:
    spec_item_id: str
    quote_line_id: str | None
    relation: Relation
    method: str
    confidence: float
    component_scores: dict[str, Any]
    review_status: Literal["confirmed", "pending"]
    explanation: str


class EmbeddingProvider(Protocol):
    """Optional multilingual retrieval interface. It is never required for a decision."""

    def similarity(self, source: str, candidates: Sequence[str]) -> Sequence[float]: ...


class SentenceTransformerEmbeddingProvider:
    """Optional local multilingual embedding adapter; install the `embeddings` extra to use it."""

    def __init__(self, model_name: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2") -> None:
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:  # pragma: no cover - optional runtime only
            raise RuntimeError("Install appraise-worker[embeddings] to enable multilingual embeddings") from exc
        self.model = SentenceTransformer(model_name)

    def similarity(self, source: str, candidates: Sequence[str]) -> Sequence[float]:  # pragma: no cover - optional runtime only
        vectors = self.model.encode([source, *candidates], normalize_embeddings=True)
        return [float(vectors[0] @ vector) for vector in vectors[1:]]


def normalize_unit(unit: str | None) -> str | None:
    if not unit:
        return None
    key = re.sub(r"\s+", "", unicodedata.normalize("NFKC", unit).lower())
    return UNIT_ALIASES.get(key, key or None)


def normalize_description(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).lower().replace("ё", "е")
    normalized = normalized.replace("×", "x").replace("х", "x")
    tokens = re.findall(r"[\w.-]+", normalized, flags=re.UNICODE)
    return " ".join(token for token in (TERM_ALIASES.get(token, token) for token in tokens) if token)


def derive_attributes(description: str, unit: str | None = None) -> TechnicalAttributes:
    text = normalize_description(description)
    diameter = _first(r"(?:dn|ду|ø|ф)\s*(\d+(?:[.,]\d+)?)", text, prefix="DN")
    grade = _first(r"\b(?:aisi\s*(\d{3,4})|(s\d{3})|(09г2с))\b", text, upper=True, group=0)
    rating = _first(r"\b(?:pn|ру)\s*(\d+(?:[.,]\d+)?)", text, prefix="PN")
    dimensions = tuple(re.findall(r"\b\d+(?:[.,]\d+)?(?:x\d+(?:[.,]\d+)?){1,2}\b", text))
    tokens = set(text.split())
    material = next((canonical for term, canonical in MATERIAL_TERMS.items() if term in tokens), None)
    return TechnicalAttributes(
        unit=normalize_unit(unit), diameter=diameter, grade=grade, rating=rating,
        material=material, dimensions=dimensions, scope=frozenset(tokens & SCOPE_TERMS),
    )


def normalize_line(row: Mapping[str, Any], *, description_key: str, unit_key: str, id_key: str = "id") -> NormalizedLine:
    raw = str(row.get(description_key) or "")
    return NormalizedLine(
        id=str(row[id_key]), position=_optional_text(row.get("position")), raw_description=raw,
        normalized_description=normalize_description(raw), attributes=derive_attributes(raw, _optional_text(row.get(unit_key))),
    )


def match_lines(
    specification_rows: Iterable[Mapping[str, Any]],
    quote_rows: Iterable[Mapping[str, Any]],
    *,
    top_k: int = 10,
    embedding_provider: EmbeddingProvider | None = None,
) -> list[MatchSuggestion]:
    specs = [normalize_line(row, description_key="description", unit_key="unit") for row in specification_rows]
    quotes = [normalize_line(row, description_key="raw_description", unit_key="raw_unit") for row in quote_rows]
    quote_descriptions = [quote.normalized_description for quote in quotes]
    suggestions: list[MatchSuggestion] = []
    for spec in specs:
        if not quotes:
            suggestions.append(_unmatched(spec.id, "No supplier quote rows are available"))
            continue
        candidate_indexes = [result[2] for result in process.extract(spec.normalized_description, quote_descriptions, scorer=fuzz.token_set_ratio, limit=top_k)]
        embedding_scores = embedding_provider.similarity(spec.normalized_description, [quote_descriptions[index] for index in candidate_indexes]) if embedding_provider else None
        candidates = [_score_candidate(spec, quotes[index], None if embedding_scores is None else embedding_scores[rank]) for rank, index in enumerate(candidate_indexes)]
        non_conflicting = [candidate for candidate in candidates if not candidate.component_scores["hard_conflicts"]]
        if not non_conflicting:
            suggestions.append(_unmatched(spec.id, "All lexical candidates have critical technical conflicts", candidates))
            continue
        suggestions.extend(non_conflicting)
    return suggestions


def evaluate_matches(suggestions: Iterable[MatchSuggestion], expected: Mapping[str, set[str]]) -> dict[str, float]:
    """Fixture-only quality report. Never uses evaluation rows to tune a live project."""
    grouped: dict[str, list[MatchSuggestion]] = {}
    for suggestion in suggestions:
        grouped.setdefault(suggestion.spec_item_id, []).append(suggestion)
    expected_ids = {spec_id: quote_ids for spec_id, quote_ids in expected.items() if quote_ids}
    total = max(len(expected_ids), 1)
    metrics: dict[str, float] = {}
    for limit in (1, 5, 10):
        recalled = sum(any(candidate.quote_line_id in quote_ids for candidate in sorted(grouped.get(spec_id, []), key=lambda item: item.confidence, reverse=True)[:limit]) for spec_id, quote_ids in expected_ids.items())
        metrics[f"recall_at_{limit}"] = recalled / total
    automatic = [item for items in grouped.values() for item in items if item.review_status == "confirmed"]
    metrics["auto_match_precision"] = (sum(item.quote_line_id in expected.get(item.spec_item_id, set()) for item in automatic) / len(automatic)) if automatic else 1.0
    metrics["automatic_decision_coverage"] = len({item.spec_item_id for item in automatic}) / max(len(grouped), 1)
    metrics["review_rate"] = sum(any(item.review_status == "pending" for item in items) for items in grouped.values()) / max(len(grouped), 1)
    metrics["unmatched_rate"] = sum(1 for items in grouped.values() if all(item.quote_line_id is None for item in items)) / max(len(grouped), 1)
    metrics["critical_conflict_false_matches"] = float(sum(item.review_status == "confirmed" and bool(item.component_scores["hard_conflicts"]) for item in automatic))
    return metrics


def _score_candidate(spec: NormalizedLine, quote: NormalizedLine, embedding_score: float | None) -> MatchSuggestion:
    conflicts = _hard_conflicts(spec.attributes, quote.attributes)
    lexical = fuzz.token_set_ratio(spec.normalized_description, quote.normalized_description) / 100
    position = 1.0 if spec.position and spec.position == quote.position else 0.0
    technical = _technical_score(spec.attributes, quote.attributes)
    embedding = max(0.0, min(1.0, (embedding_score + 1) / 2)) if embedding_score is not None else None
    confidence = round(0.70 * lexical + 0.20 * position + 0.10 * technical, 6)
    relation = _relation(spec.attributes.scope, quote.attributes.scope, spec.normalized_description, quote.normalized_description)
    auto = relation == "MATCH" and not conflicts and ((position == 1.0 and lexical >= 0.90 and technical >= 0.9) or lexical >= 0.995 and technical >= 0.9)
    scores: dict[str, Any] = {"lexical": lexical, "position": position, "technical": technical, "hard_conflicts": conflicts, "embedding": embedding}
    explanation = "Exact position and compatible technical attributes" if auto else "Candidate requires human review"
    return MatchSuggestion(spec.id, quote.id, relation, "rapidfuzz-rules-v1", confidence, scores, "confirmed" if auto else "pending", explanation)


def _unmatched(spec_id: str, explanation: str, candidates: Sequence[MatchSuggestion] = ()) -> MatchSuggestion:
    conflicts = [candidate.component_scores["hard_conflicts"] for candidate in candidates]
    return MatchSuggestion(spec_id, None, "NO_MATCH", "rapidfuzz-rules-v1", 0.0, {"hard_conflicts": conflicts}, "pending", explanation)


def _hard_conflicts(spec: TechnicalAttributes, quote: TechnicalAttributes) -> list[str]:
    conflicts: list[str] = []
    for name in ("unit", "diameter", "grade", "rating", "material"):
        left, right = getattr(spec, name), getattr(quote, name)
        if left and right and left != right:
            conflicts.append(f"{name}:{left}!={right}")
    if spec.dimensions and quote.dimensions and spec.dimensions != quote.dimensions:
        conflicts.append("dimensions differ")
    return conflicts


def _technical_score(spec: TechnicalAttributes, quote: TechnicalAttributes) -> float:
    compared = 0
    matches = 0
    for name in ("unit", "diameter", "grade", "rating", "material"):
        left, right = getattr(spec, name), getattr(quote, name)
        if left and right:
            compared += 1
            matches += left == right
    return 1.0 if compared == 0 else matches / compared


def _relation(spec_scope: frozenset[str], quote_scope: frozenset[str], spec_text: str, quote_text: str) -> Relation:
    if "bundle" in quote_text or "комплекс" in quote_text:
        return "SUPERSET"
    if quote_scope < spec_scope:
        return "PARTIAL"
    if spec_scope < quote_scope:
        return "SUPERSET"
    return "MATCH"


def _first(pattern: str, text: str, *, prefix: str = "", upper: bool = False, group: int = 1) -> str | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if match is None:
        return None
    value = match.group(group).replace(",", ".")
    return f"{prefix}{value}".upper() if upper else f"{prefix}{value}"


def _optional_text(value: object) -> str | None:
    result = str(value).strip() if value is not None else ""
    return result or None
