"""Pinned OCR assets. Downloads belong to image preparation, never parsing."""
from __future__ import annotations

import hashlib
import os
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from urllib.request import urlopen

from .errors import ApiProblem

PROFILE = "rapidocr-v6-small-onnx-v1"
BASE_URL = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx"
ARTIFACTS = {
    "det": ("en_PP-OCRv3_det_mobile.onnx", "PP-OCRv4/det", "ea07c15d38ac40cd69da3c493444ec75b44ff23840553ff8ba102c1219ed39c2"),
    "rec": ("PP-OCRv6_rec_small.onnx", "PP-OCRv6/rec", "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884"),
    "cls": ("ch_ppocr_mobile_v2.0_cls_mobile.onnx", "PP-OCRv4/cls", "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"),
}
RUNTIME_VERSIONS = {"docling": "2.117.0", "rapidocr": "3.9.2", "onnxruntime": "1.30.0",
                    "docling-core": "2.91.0", "docling-parse": "7.13.0", "docling-ibm-models": "3.14.0"}


def model_root() -> Path:
    return Path(os.getenv("RAG_OCR_MODEL_PATH", str(Path.home() / ".cache" / "rag-steplab" / PROFILE))).expanduser()


def asset_manifest(root: Path | None = None) -> dict:
    root = root or model_root()
    for package, expected in RUNTIME_VERSIONS.items():
        try:
            actual = version(package)
        except PackageNotFoundError:
            actual = None
        if actual != expected:
            raise ApiProblem(503, "ocr_runtime_incompatible", f"OCR requires {package}=={expected}.")
    for name, _, digest in ARTIFACTS.values():
        path = root / name
        try:
            matches = path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest
        except OSError:
            matches = False
        if not matches:
            raise ApiProblem(503, "ocr_assets_unavailable", f"Missing or incompatible OCR asset: {name}. Prepare the pinned OCR profile before parsing.")
    return {
        "profile": PROFILE, "engine": "rapidocr", "backend": "onnxruntime", "device": "cpu",
        "versions": RUNTIME_VERSIONS.copy(), "dictionary": "recognizer_embedded_metadata",
        "languages": ["multilingual", "tr"], "mode": "pdf_aware_layout_regions",
        "scale": 3.0, "textScore": 0.5, "forceFullPageOcr": False,
        "models": {role: {"file": name, "sha256": digest} for role, (name, _, digest) in ARTIFACTS.items()},
    }


def prepare_assets(root: Path | None = None) -> dict:
    """Build/prefetch operation; verify bytes before atomically publishing."""
    root = root or model_root()
    root.mkdir(parents=True, exist_ok=True)
    for name, directory, digest in ARTIFACTS.values():
        destination = root / name
        if destination.is_file() and hashlib.sha256(destination.read_bytes()).hexdigest() == digest:
            continue
        with urlopen(f"{BASE_URL}/{directory}/{name}", timeout=120) as response:
            content = response.read()
        if hashlib.sha256(content).hexdigest() != digest:
            raise RuntimeError(f"OCR artifact hash mismatch: {name}")
        temporary = destination.with_suffix(".download")
        temporary.write_bytes(content)
        temporary.replace(destination)
    return asset_manifest(root)


if __name__ == "__main__":
    import json
    print(json.dumps(prepare_assets(), indent=2))
