"""Generate web/lib/bracket.data.json from the canonical engine.bracket (P13).

SINGLE SOURCE OF TRUTH is engine/bracket.py; the web app reads the generated
JSON (web/lib/bracket.ts wraps it). Re-run after ANY change to engine/bracket.py
— parity is guarded by tests/test_bracket.py::test_web_bracket_data_matches_engine
(mirrors the golden_vectors pattern, CLAUDE.md trap #13c).

Run from the repo root so `engine.bracket` is importable:
    python web/tests/fixtures/gen_bracket.py
"""
import json
import os

from engine.bracket import bracket_data

# web/tests/fixtures/ -> web/lib/bracket.data.json
_here = os.path.dirname(__file__)
path = os.path.normpath(os.path.join(_here, "..", "..", "lib", "bracket.data.json"))
with open(path, "w", encoding="utf-8") as fh:
    json.dump(bracket_data(), fh, indent=2)
    fh.write("\n")
print(f"wrote {path}")
