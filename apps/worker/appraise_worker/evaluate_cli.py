"""Print reproducible matching-quality metrics from labeled fixture projects."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .matching import evaluate_matches, match_lines


def evaluate_fixture(path: Path) -> dict[str, Any]:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    suggestions = match_lines(fixture["specification"], fixture["quotes"])
    expected = {spec_id: set(quote_ids) for spec_id, quote_ids in fixture["expected"].items()}
    return {
        "project": fixture.get("project", path.stem),
        "fixture": path.as_posix(),
        "specification_rows": len(fixture["specification"]),
        "quote_rows": len(fixture["quotes"]),
        "metrics": evaluate_matches(suggestions, expected),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixtures", nargs="+", type=Path)
    args = parser.parse_args()
    print(json.dumps([evaluate_fixture(path) for path in args.fixtures], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
