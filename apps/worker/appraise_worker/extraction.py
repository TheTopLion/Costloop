from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import asdict
from typing import Any, Literal, Protocol, TypeAlias

from pydantic import ValidationError

from .extraction_models import QuoteDraft, SpecificationDraft
from .ingestion import ParsedDocument, SheetEvidence, cell_range

ExtractionKind = Literal["specification", "quote"]
ExtractionDraft: TypeAlias = SpecificationDraft | QuoteDraft


class ExtractionProvider(Protocol):
    """Providers return untrusted draft-shaped data, never canonical records."""

    def extract(
        self,
        kind: ExtractionKind,
        document: ParsedDocument,
        validation_feedback: str | None = None,
    ) -> Mapping[str, Any]: ...


class ExtractionValidationError(ValueError):
    pass


def _coordinate_parts(coordinate: str) -> tuple[int, int]:
    match = re.fullmatch(r"([A-Z]+)(\d+)", coordinate)
    if match is None:
        raise ValueError(f"Invalid cell coordinate: {coordinate}")
    label, row = match.groups()
    column = 0
    for character in label:
        column = column * 26 + ord(character) - 64
    return int(row), column


def _sheet_rows(sheet: SheetEvidence) -> dict[int, dict[int, str]]:
    result: dict[int, dict[int, str]] = {}
    for cell in sheet.cells:
        if cell.value is None:
            continue
        row, column = _coordinate_parts(cell.coordinate)
        result.setdefault(row, {})[column] = cell.value.strip()
    return result


def _heading_key(value: str) -> str:
    return re.sub(r"[^a-zа-яё0-9]+", "", value.lower())


def _header_columns(values: dict[int, str]) -> tuple[int, dict[str, int]]:
    columns: dict[str, int] = {}
    for column, text in values.items():
        key = _heading_key(text)
        if "№" in text or key in {"n", "пп", "номер"} or key.startswith("номер"):
            columns.setdefault("position", column)
        elif any(token in key for token in ("описание", "содержание", "description", "наименование", "работ")):
            columns.setdefault("description", column)
        elif any(token in key for token in ("едизм", "единица", "unit")):
            columns.setdefault("unit", column)
        elif any(token in key for token in ("колво", "quantity", "колич")):
            columns.setdefault("quantity", column)
        elif key in {"currency", "валюта"}:
            columns.setdefault("currency", column)
        elif key in {"price", "rate"} or any(token in key for token in ("ценазаединицу", "unitprice", "стоимостьзаединицу")):
            columns.setdefault("unit_price", column)
        elif key in {"total", "amount"} or any(token in key for token in ("сумма", "стоимость")):
            columns.setdefault("line_total", column)
    score = sum(name in columns for name in ("description", "quantity", "unit"))
    return score, columns


def _find_primary_table(sheets: tuple[SheetEvidence, ...]) -> tuple[SheetEvidence, int, dict[str, int], dict[int, dict[int, str]]] | None:
    best: tuple[int, SheetEvidence, int, dict[str, int], dict[int, dict[int, str]]] | None = None
    for sheet in sheets:
        rows = _sheet_rows(sheet)
        for row, values in rows.items():
            score, columns = _header_columns(values)
            candidate = (score, sheet, row, columns, rows)
            if score >= 2 and (best is None or score > best[0]):
                best = candidate
    if best is None:
        return None
    _, sheet, row, columns, rows = best
    return sheet, row, columns, rows


def _value(values: dict[int, str], column: int | None) -> str | None:
    if column is None:
        return None
    value = values.get(column, "").strip()
    return value or None


def _numeric_value(value: str | None) -> str | None:
    """Extract a written numeric prefix without converting absent client values into zero."""
    if not value:
        return None
    match = re.fullmatch(r"\s*([0-9][0-9\u00a0 ,.]*)(?:[a-zа-яё³²]+)?\s*", value, flags=re.IGNORECASE)
    if match is None:
        return None
    return match.group(1).replace("\u00a0", " ").strip()


def _unit_embedded_in(value: str | None) -> str | None:
    if not value:
        return None
    match = re.fullmatch(r"\s*[0-9][0-9\u00a0 ,.]*\s*([a-zа-яё³²]+)\s*", value, flags=re.IGNORECASE)
    return match.group(1) if match else None


def _position(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


def _nearest_parent(position: str | None, sections: dict[str, dict[str, Any]]) -> str | None:
    if not position:
        return None
    components = position.rstrip(".").split(".")
    for size in range(len(components) - 1, 0, -1):
        parent = ".".join(components[:size])
        if parent in sections:
            return parent
    return None


def _currency_from_header(columns: dict[str, int], values: dict[int, str]) -> str | None:
    source = values.get(columns.get("unit_price", -1), "") + " " + values.get(columns.get("line_total", -1), "")
    key = source.lower()
    if "usd" in key or "доллар" in key:
        return "USD"
    if "тенге" in key or "kzt" in key:
        return "KZT"
    if "ман" in key or "azn" in key:
        return "AZN"
    if "eur" in key or "евро" in key:
        return "EUR"
    return None


def extract_draft(
    provider: ExtractionProvider,
    kind: ExtractionKind,
    document: ParsedDocument,
    *,
    max_attempts: int = 2,
) -> ExtractionDraft:
    if not 1 <= max_attempts <= 3:
        raise ValueError("max_attempts must be between 1 and 3")
    model = SpecificationDraft if kind == "specification" else QuoteDraft
    feedback: str | None = None
    last_error: ValidationError | None = None
    for _ in range(max_attempts):
        payload = provider.extract(kind, document, feedback)
        try:
            return model.model_validate(payload)
        except ValidationError as exc:
            last_error = exc
            feedback = str(exc)
    raise ExtractionValidationError(f"Provider output remained invalid after {max_attempts} attempts: {last_error}")


class FakeTableProvider:
    """FAKE deterministic provider for fixtures/local development; it is not AI."""

    def extract(
        self,
        kind: ExtractionKind,
        document: ParsedDocument,
        validation_feedback: str | None = None,
    ) -> Mapping[str, Any]:
        del validation_feedback
        if document.pages:
            return _extract_pdf_rows(kind, document)
        if not document.sheets:
            return {"document_kind": kind, "sections": [], "lines": [], "warnings": ["FAKE provider supports spreadsheets only"]}
        table = _find_primary_table(document.sheets)
        if table is None:
            return {"document_kind": kind, "sections": [], "lines": [], "warnings": ["No recognizable line-item header was found; review manually"]}
        sheet, header_row, columns, rows = table
        source_type = "xls" if document.media_type == "application/vnd.ms-excel" else "xlsx"
        sections: list[dict[str, Any]] = []
        lines: list[dict[str, Any]] = []
        known_sections: dict[str, dict[str, Any]] = {}
        for row, values in sorted(rows.items()):
            if row <= header_row:
                continue
            description = _value(values, columns.get("description"))
            if not description:
                continue
            position = _position(_value(values, columns.get("position")))
            raw_quantity = _value(values, columns.get("quantity"))
            quantity = _numeric_value(raw_quantity)
            unit = _value(values, columns.get("unit")) or _unit_embedded_in(raw_quantity)
            price = _numeric_value(_value(values, columns.get("unit_price")))
            total = _numeric_value(_value(values, columns.get("line_total")))
            # Client repair statements often carry a formula placeholder of 0 while the
            # quoted unit-price cell is blank. It is unknown, not a valid zero bid.
            if price is None and total in {"0", "0.0", "0.00"}:
                total = None
            evidence = {
                "source_type": source_type, "sheet": sheet.name, "row": row,
                "cell_range": cell_range(sheet.name, row, 1, max(columns.values(), default=1)),
                "evidence_text": " | ".join(value for _, value in sorted(values.items()) if value).strip(" |"),
            }
            # A numbered description with no operational fields is a heading, never a billable item.
            if not quantity and not unit and not price and not total:
                parent = _nearest_parent(position, known_sections)
                section = {"position": position, "description": description, "parent_position": parent, "source": evidence}
                sections.append(section)
                known_sections[position] = section
                continue
            section_position = _nearest_parent(position, known_sections)
            item: dict[str, Any] = {
                "position": position, "description": description, "quantity": quantity,
                "unit": unit, "section_position": section_position, "source": evidence,
            }
            if kind == "quote":
                item.update(
                    unit_price=price,
                    line_total=total,
                    currency=_value(values, columns.get("currency")) or _currency_from_header(columns, rows.get(header_row, {})),
                )
            lines.append(item)
        warning = "Generated by FAKE deterministic table provider; review all extracted values"
        if not lines:
            warning = "No billable rows found; headings were preserved separately for review"
        return {"document_kind": kind, "sections": sections, "lines": lines, "warnings": [warning]}


def _extract_pdf_rows(kind: ExtractionKind, document: ParsedDocument) -> Mapping[str, Any]:
    """Small deterministic fallback for simple digital-text PDF fixtures and local review."""
    lines: list[dict[str, Any]] = []
    pattern = re.compile(
        r"(?:line\s+)?(?P<position>\d+(?:\.\d+)?)\s*[:.)-]\s*(?P<description>.*?)\s+(?P<quantity>\d+(?:[,.]\d+)?)\s+(?P<unit>[\w²³/.-]+)\s*$",
        re.IGNORECASE,
    )
    for page in document.pages:
        for text_line in page.text.splitlines():
            match = pattern.fullmatch(text_line.strip())
            if match is None:
                continue
            item: dict[str, Any] = {
                "position": match.group("position"),
                "description": match.group("description").strip(),
                "quantity": match.group("quantity"),
                "unit": match.group("unit"),
                "section_position": None,
                "source": {
                    "source_type": "pdf", "page": page.page,
                    "evidence_text": text_line.strip(),
                },
            }
            if kind == "quote":
                item.update(unit_price=None, line_total=None, currency=None)
            lines.append(item)
    warning = "Generated by FAKE deterministic PDF provider; review all extracted values"
    if not lines:
        warning = "No deterministic PDF line pattern was found; use OCR or enter rows manually"
    return {"document_kind": kind, "sections": [], "lines": lines, "warnings": [warning]}


class InstructorAnthropicProvider:
    """Optional production adapter. Construction requires explicit environment configuration."""

    def __init__(self, *, model: str | None = None) -> None:
        api_key = os.getenv("ANTHROPIC_API_KEY")
        self.model = model or os.getenv("ANTHROPIC_EXTRACTION_MODEL")
        if not api_key or not self.model:
            raise RuntimeError("ANTHROPIC_API_KEY and ANTHROPIC_EXTRACTION_MODEL are required")
        try:
            import anthropic
            import instructor
        except ImportError as exc:
            raise RuntimeError("Install appraise-worker[anthropic] to use Anthropic extraction") from exc
        self.client = instructor.from_anthropic(anthropic.Anthropic(api_key=api_key))

    def extract(
        self,
        kind: ExtractionKind,
        document: ParsedDocument,
        validation_feedback: str | None = None,
    ) -> Mapping[str, Any]:
        response_model = SpecificationDraft if kind == "specification" else QuoteDraft
        source = asdict(document)
        result = self.client.messages.create(
            model=self.model,
            max_tokens=8_000,
            max_retries=0,
            response_model=response_model,
            messages=[{
                "role": "user",
                "content": (
                    "Extract a review draft. Preserve source provenance. Do not infer missing money, quantity, unit, "
                    f"or currency. Validation feedback: {validation_feedback or 'none'}. Source: {source}"
                ),
            }],
        )
        return result.model_dump(mode="python")
