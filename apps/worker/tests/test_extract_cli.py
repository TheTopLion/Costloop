import base64
import json
import subprocess
import sys
from io import BytesIO

from openpyxl import Workbook


def request() -> dict[str, str]:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Quote"
    sheet.append(["Position", "Description", "Quantity", "Unit", "Price", "Total", "Currency"])
    sheet.append(["1", "Valve", "2", "item", "7.50", "15", "USD"])
    output = BytesIO()
    workbook.save(output)
    return {
        "filename": "quote.xlsx",
        "content_base64": base64.b64encode(output.getvalue()).decode(),
        "kind": "supplier_quote",
    }


def test_cli_emits_json_only_with_versioned_evidence() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "appraise_worker.extract_cli"],
        input=json.dumps(request()), text=True, capture_output=True, check=True,
    )
    response = json.loads(completed.stdout)
    assert completed.stderr == ""
    assert response["payload"]["document_kind"] == "quote"
    assert response["provider"] == "fake"
    assert response["parser_version"] and response["prompt_version"] and response["schema_version"]
    assert response["evidence"]["sheets"][0]["cells"][0]["coordinate"] == "A1"


def test_cli_sanitizes_failure_to_stderr() -> None:
    completed = subprocess.run(
        [sys.executable, "-m", "appraise_worker.extract_cli"],
        input=json.dumps({"filename": "secret.pdf", "content_base64": "not valid", "kind": "specification"}),
        text=True, capture_output=True, check=False,
    )
    assert completed.returncode != 0 and completed.stdout == ""
    error = json.loads(completed.stderr)
    assert error["message"] == "content_base64 is invalid"
    assert "secret" not in completed.stderr
