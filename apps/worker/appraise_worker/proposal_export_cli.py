"""Binary stdout interface for proposal XLSX generation."""

from __future__ import annotations

import json
import sys

from pydantic import ValidationError

from .proposal_export import build_workbook


def main() -> int:
    try:
        content = build_workbook(json.loads(sys.stdin.read()))
    except (ValidationError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(f"Proposal export failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    sys.stdout.buffer.write(content)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
