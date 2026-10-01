"""Bounded subprocess interface for conservative bid matching."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .matching import match_lines


class Line(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=80)
    position: str | None = Field(default=None, max_length=80)
    description: str | None = Field(default=None, max_length=4000)
    raw_description: str | None = Field(default=None, max_length=4000)
    unit: str | None = Field(default=None, max_length=40)
    raw_unit: str | None = Field(default=None, max_length=40)


class Request(BaseModel):
    model_config = ConfigDict(extra="forbid")

    specification: list[Line] = Field(max_length=5000)
    quotes: list[Line] = Field(max_length=5000)


def _run(raw: str) -> dict[str, Any]:
    request = Request.model_validate_json(raw)
    suggestions = match_lines(
        [line.model_dump() for line in request.specification],
        [line.model_dump() for line in request.quotes],
    )
    return {"matching_version": "rapidfuzz-rules-v1", "suggestions": [asdict(item) for item in suggestions]}


def main() -> int:
    try:
        result = _run(sys.stdin.read())
    except (ValidationError, ValueError, OSError) as exc:
        print(json.dumps({"error": type(exc).__name__, "message": "Invalid matching request"}), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
