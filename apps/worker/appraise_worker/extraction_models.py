from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _decimal_or_none(value: object) -> Decimal | None:
    """Preserve blanks as unknown, while accepting comma decimals in client workbooks."""
    if value is None:
        return None
    if isinstance(value, str):
        compact = value.replace("\u00a0", "").replace(" ", "").strip()
        if not compact or compact.lower() in {"nan", "n/a", "-", "—"}:
            return None
        if "," in compact and "." not in compact:
            compact = compact.replace(",", ".")
        value = compact
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("must be a decimal or blank") from exc


class Provenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_type: Literal["xlsx", "xls", "pdf"]
    sheet: str | None = None
    page: int | None = Field(default=None, ge=1)
    row: int | None = Field(default=None, ge=1)
    cell_range: str | None = None
    evidence_text: str = Field(min_length=1, max_length=4_000)

    @model_validator(mode="after")
    def location_matches_type(self) -> Provenance:
        if self.source_type in {"xlsx", "xls"} and (not self.sheet or not self.cell_range):
            raise ValueError("Spreadsheet provenance requires sheet and cell_range")
        if self.source_type == "pdf" and self.page is None:
            raise ValueError("PDF provenance requires page")
        return self


class SectionDraft(BaseModel):
    """A non-priceable heading preserved separately from specification line items."""

    model_config = ConfigDict(extra="forbid")

    position: str | None = None
    description: str = Field(min_length=1)
    parent_position: str | None = None
    source: Provenance


class SpecificationLineDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: str | None = None
    description: str = Field(min_length=1)
    quantity: Decimal | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, min_length=1)
    section_position: str | None = None
    quantity_status: Literal["provided", "pending_quantity"] = "provided"
    source: Provenance

    @field_validator("quantity", mode="before")
    @classmethod
    def parse_quantity(cls, value: object) -> Decimal | None:
        return _decimal_or_none(value)

    @model_validator(mode="after")
    def derive_quantity_status(self) -> SpecificationLineDraft:
        self.quantity_status = "provided" if self.quantity is not None else "pending_quantity"
        return self


class SpecificationDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_kind: Literal["specification"] = "specification"
    sections: list[SectionDraft] = Field(default_factory=list)
    lines: list[SpecificationLineDraft]
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def warn_about_review_issues(self) -> SpecificationDraft:
        positions = [line.position for line in self.lines if line.position]
        duplicates = sorted({item for item in positions if positions.count(item) > 1})
        if duplicates:
            self.warnings.append(f"Duplicate positions require review: {', '.join(duplicates)}")
        pending = sum(line.quantity_status == "pending_quantity" for line in self.lines)
        if pending:
            self.warnings.append(f"{pending} line(s) need a quantity before confirmation")
        return self


class QuoteLineDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    position: str | None = None
    description: str = Field(min_length=1)
    quantity: Decimal | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, min_length=1)
    unit_price: Decimal | None = Field(default=None, ge=0)
    line_total: Decimal | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Z]{3}$")
    section_position: str | None = None
    price_status: Literal["priced", "pending_price"] = "priced"
    quantity_status: Literal["provided", "pending_quantity"] = "provided"
    source: Provenance

    @field_validator("quantity", "unit_price", "line_total", mode="before")
    @classmethod
    def parse_optional_decimal(cls, value: object) -> Decimal | None:
        return _decimal_or_none(value)

    @field_validator("currency", mode="before")
    @classmethod
    def normalize_currency(cls, value: object) -> str | None:
        if value is None or not str(value).strip():
            return None
        return str(value).strip().upper()

    @model_validator(mode="after")
    def derive_statuses(self) -> QuoteLineDraft:
        self.price_status = "priced" if self.unit_price is not None or self.line_total is not None else "pending_price"
        self.quantity_status = "provided" if self.quantity is not None else "pending_quantity"
        return self


class QuoteDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    document_kind: Literal["quote"] = "quote"
    supplier_name: str | None = None
    sections: list[SectionDraft] = Field(default_factory=list)
    lines: list[QuoteLineDraft]
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def warn_about_arithmetic(self) -> QuoteDraft:
        for index, line in enumerate(self.lines, start=1):
            if line.price_status == "pending_price":
                self.warnings.append(f"Line {index} is pending price; no value was defaulted")
            if line.quantity_status == "pending_quantity":
                self.warnings.append(f"Line {index} needs a quantity before confirmation")
            if line.currency is None:
                self.warnings.append(f"Line {index} has ambiguous or missing currency")
            if line.quantity is not None and line.unit_price is not None and line.line_total is not None:
                calculated = line.quantity * line.unit_price
                if calculated != line.line_total:
                    self.warnings.append(f"Line {index} total differs from quantity x unit price")
        return self
