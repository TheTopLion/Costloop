"""JSON-lines-free subprocess boundary for local worker integration."""

from __future__ import annotations

import base64
import binascii
import json
import os
import sys
from dataclasses import asdict, replace
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .extraction import FakeTableProvider, InstructorAnthropicProvider, extract_draft
from .ingestion import IngestionLimits, parse_pdf, parse_xls, parse_xlsx

MAX_REQUEST_BYTES = 10 * 1024 * 1024
PARSER_VERSION = "appraise-parser-1"
PROMPT_VERSION = "fake-table-1"
SCHEMA_VERSION = "extraction-draft-1"


class Request(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=255)
    content_base64: str = Field(min_length=1)
    kind: str


def _run(raw: str) -> dict[str, Any]:
    request = Request.model_validate_json(raw)
    if request.kind not in {"specification", "supplier_quote"}:
        raise ValueError("kind must be specification or supplier_quote")
    try:
        content = base64.b64decode(request.content_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("content_base64 is invalid") from exc
    if len(content) > MAX_REQUEST_BYTES:
        raise ValueError("decoded document exceeds 10 MiB")
    suffix = Path(request.filename).suffix.lower()
    limits = IngestionLimits(max_file_bytes=MAX_REQUEST_BYTES)
    if suffix == ".xlsx":
        document = parse_xlsx(content, limits)
    elif suffix == ".xls":
        document = parse_xls(content, limits)
    elif suffix == ".pdf":
        document = parse_pdf(content, limits)
    else:
        raise ValueError("Only .xls, .xlsx, and .pdf files are supported")
    document = replace(document, filename=request.filename)
    internal_kind = "quote" if request.kind == "supplier_quote" else "specification"
    provider_name = os.getenv("APPRAISE_EXTRACTION_PROVIDER", "fake").lower()
    if provider_name == "fake":
        provider = FakeTableProvider()
        model_name = "deterministic-table-v1"
    elif provider_name == "anthropic":
        provider = InstructorAnthropicProvider()
        model_name = provider.model
    else:
        raise ValueError("APPRAISE_EXTRACTION_PROVIDER must be fake or anthropic")
    draft = extract_draft(provider, internal_kind, document, max_attempts=2)
    payload = draft.model_dump(mode="json")
    return {
        "payload": payload,
        "warnings": payload.get("warnings", []),
        "parser_version": PARSER_VERSION,
        "model": model_name,
        "provider": provider_name,
        "prompt_version": PROMPT_VERSION,
        "schema_version": SCHEMA_VERSION,
        "evidence": asdict(document),
    }


def main() -> int:
    try:
        result = _run(sys.stdin.read())
    except ValidationError:
        print(json.dumps({"error": "ValidationError", "message": "Invalid extraction request"}), file=sys.stderr)
        return 2
    except (ValueError, OSError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": str(exc)}), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
