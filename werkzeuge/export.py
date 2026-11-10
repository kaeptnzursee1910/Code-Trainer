#!/usr/bin/env python3
"""Überträgt Lehrplan und Runner in den Ordner docs/ (für die Browser-Version).

Nach jeder Änderung an trainer/lektionen.py oder trainer/runner.py ausführen:
    python werkzeuge/export.py
Der Test tests/test_lektionen.py meldet, wenn das vergessen wurde.
"""
import json
import sys
from pathlib import Path

BASIS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASIS))

from trainer.lektionen import LEKTIONEN  # noqa: E402

DOCS = BASIS / "docs"


def lektionen_json() -> str:
    return json.dumps(LEKTIONEN, ensure_ascii=False, indent=1) + "\n"


def runner_quelle() -> str:
    return (BASIS / "trainer" / "runner.py").read_text("utf-8")


def main():
    (DOCS / "py").mkdir(parents=True, exist_ok=True)
    (DOCS / "lektionen.json").write_text(lektionen_json(), "utf-8")
    (DOCS / "py" / "runner.py").write_text(runner_quelle(), "utf-8")
    print(f"✓ {len(LEKTIONEN)} Lektionen → docs/lektionen.json")
    print("✓ trainer/runner.py → docs/py/runner.py")


if __name__ == "__main__":
    main()
