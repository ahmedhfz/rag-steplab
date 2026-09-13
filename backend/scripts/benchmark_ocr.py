"""Opt-in real OCR regression/benchmark; no provider or persistence writes.

Run from backend: python scripts/benchmark_ocr.py --output result.json
Assets must be prepared first with python -m app.ocr.
"""
import argparse
import json
import platform
import re
try:
    import resource
except ImportError:
    resource = None
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np
from PIL import Image
from rapidocr import RapidOCR
from rapidocr.ch_ppocr_rec.typings import TextRecInput
from rapidocr.utils.typings import EngineType
from app.ocr import ARTIFACTS, asset_manifest, model_root


def distance(a, b):
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(current[-1] + 1, previous[j] + 1, previous[j-1] + (x != y)))
        previous = current
    return previous[-1]


def metrics(rows):
    codes = [(code, row["text"]) for row in rows for code in re.findall(r"\b[A-Z][0-9]\b", row["truth"])]
    return {
        "lines": len(rows), "exact": sum(row["truth"] == row["text"] for row in rows),
        "cer": sum(distance(row["truth"], row["text"]) for row in rows) / sum(len(row["truth"]) for row in rows),
        "wer": sum(distance(row["truth"].split(), row["text"].split()) for row in rows) / sum(len(row["truth"].split()) for row in rows),
        "identifierExact": sum(bool(re.search(r"\b" + re.escape(code) + r"\b", text)) for code, text in codes),
        "identifierTotal": len(codes),
        "turkishFailures": [row for row in rows if "".join(c for c in row["truth"] if c in "çğıİöşüÇĞÖŞÜ") != "".join(c for c in row["text"] if c in "çğıİöşüÇĞÖŞÜ")],
        # All wrong scores are reported; no arbitrary low-confidence cutoff.
        "wrongOutputsWithScores": [row for row in rows if row["truth"] != row["text"]],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pdf", type=Path)
    args = parser.parse_args()
    manifest = asset_manifest()
    root = model_root()
    params = {f"{role.title()}.model_path": str(root / artifact[0]) for role, artifact in ARTIFACTS.items()}
    params.update({f"{role}.engine_type": EngineType.ONNXRUNTIME for role in ("Det", "Rec", "Cls")})
    params.update({"Rec.rec_keys_path": None, "Rec.lang_type": "tr", "Global.font_path": None,
                   "EngineConfig.onnxruntime.intra_op_num_threads": 2,
                   "EngineConfig.onnxruntime.inter_op_num_threads": 1})
    start = time.perf_counter()
    reader = RapidOCR(params=params)
    providers = {role: getattr(reader, f"text_{role}").session.session.get_providers() for role in ("det", "cls", "rec")}
    assert all(value == ["CPUExecutionProvider"] for value in providers.values())
    init = time.perf_counter() - start
    fixtures = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "ocr"
    samples = json.loads((fixtures / "samples.json").read_text("utf-8"))
    images = [np.array(Image.open(fixtures / sample["path"]).convert("RGB")) for sample in samples]
    times, outputs = [], []
    for _ in range(4):
        start = time.perf_counter()
        result = reader.text_rec(TextRecInput(img=images, return_word_box=False))
        times.append(time.perf_counter() - start)
        outputs.append(list(result.txts))
    rows = [dict(sample, text=text, confidence=float(score)) for sample, text, score in zip(samples, result.txts, result.scores)]
    output = {"platform": platform.platform(), "python": platform.python_version(), "manifest": manifest, "providers": providers,
              "coldInitSeconds": init, "firstRecognitionSeconds": times[0],
              "warmRecognitionSeconds": times[1:], "warmMedianSeconds": statistics.median(times[1:]),
              "repeatIdentical": all(texts == outputs[0] for texts in outputs),
              "stats": {subset: metrics([row for row in rows if row["subset"] == subset]) for subset in ("real", "synthetic")},
              "rows": rows}
    assert all(character in reader.text_rec.postprocess_op.character for character in "çğıİöşüÇĞÖŞÜ")
    if args.pdf:
        import torch
        torch.set_num_threads(2)
        from app.parser import _build_document_converter, build_structured_content
        start = time.perf_counter()
        conversion = _build_document_converter().convert(args.pdf, page_range=(7, 7))
        normalized = build_structured_content(conversion.document, parsed_pages=conversion.pages)
        output["pageConversionSeconds"] = time.perf_counter() - start
        output["normalized"] = normalized.model_dump(mode="json", by_alias=True)
    output["peakRssMiB"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024 if resource else None
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in output.items() if key not in ("rows", "normalized", "stats")}, indent=2))


if __name__ == "__main__":
    main()
