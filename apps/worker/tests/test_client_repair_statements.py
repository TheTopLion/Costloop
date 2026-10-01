from pathlib import Path

from appraise_worker.extraction import FakeTableProvider, extract_draft
from appraise_worker.ingestion import parse_xls, parse_xlsx

FIXTURES = Path(__file__).parent / "fixtures" / "client-repair-statements"


def test_mcv_barys_xlsx_preserves_sections_and_excludes_them_from_billable_lines() -> None:
    draft = extract_draft(FakeTableProvider(), "specification", parse_xlsx(FIXTURES / "mcv-barys-2025.xlsx"))
    section = next(section for section in draft.sections if section.position == "1")
    line = next(line for line in draft.lines if line.position == "1.1")
    assert section.description == "Подготовительные работы"
    assert line.section_position == "1"
    assert all(line.position != "1" for line in draft.lines)
    assert line.source.sheet == "БАРЫС" and line.source.cell_range.endswith("A8:G8")


def test_turkestan_base_xls_is_read_with_legacy_parser_and_preserves_blank_prices() -> None:
    document = parse_xls(FIXTURES / "turkestan-2025-base.xls")
    draft = extract_draft(FakeTableProvider(), "quote", document)
    first = next(line for line in draft.lines if line.position == "1.0")
    assert document.media_type == "application/vnd.ms-excel"
    assert first.quantity == 1
    assert first.price_status == "pending_price"
    assert first.unit_price is None and first.line_total is None
    assert any("pending price" in warning for warning in draft.warnings)


def test_turkestan_price_comparison_fixture_keeps_prototype_sheet_out_of_line_item_extraction() -> None:
    document = parse_xls(FIXTURES / "turkestan-2025-price-comparison.xls")
    draft = extract_draft(FakeTableProvider(), "specification", document)
    comparison_sheet = next(sheet for sheet in document.sheets if sheet.name == "сравнение цен")
    assert any(cell.value == "Бекет-Ата" for cell in comparison_sheet.cells)
    assert all(line.source.sheet == "Спецификация" for line in draft.lines)
