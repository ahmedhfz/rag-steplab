"""Opt-in real model tests: RUN_OCR_REGRESSION=1 pytest tests/test_ocr_recognition.py."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.skipif(os.getenv("RUN_OCR_REGRESSION") != "1", reason="Real OCR assets/runtime are opt-in")
def test_pinned_profile_real_and_synthetic_crops(tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "benchmark_ocr.py"
    output = tmp_path / "result.json"
    subprocess.run([sys.executable, str(script), "--output", str(output)], check=True)
    result = json.loads(output.read_text("utf-8"))
    real = result["stats"]["real"]
    assert result["repeatIdentical"]
    assert real["exact"] >= 29  # Measured approved profile, not a confidence cutoff.
    assert real["identifierExact"] == real["identifierTotal"] == 18
    assert all(row["text"] == "B1: pirinç" for row in result["rows"] if row["truth"] == "B1: pirinç")
    assert {"ç", "ğ", "ı", "İ", "ö", "ş", "ü"} <= set("".join(row["truth"] for row in result["rows"]))
    # Synthetic ambiguous glyphs remain measured failures rather than fixes.
    assert result["stats"]["synthetic"]["wrongOutputsWithScores"]
