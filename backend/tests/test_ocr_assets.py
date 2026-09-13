import pytest

from app import ocr
from app.errors import ApiProblem


def test_missing_or_corrupt_assets_fail_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(ocr, "version", lambda package: ocr.RUNTIME_VERSIONS[package])
    monkeypatch.setattr(ocr, "urlopen", lambda *_args, **_kwargs: pytest.fail("parse validation must not download"))
    with pytest.raises(ApiProblem) as error:
        ocr.asset_manifest(tmp_path)
    assert error.value.code == "ocr_assets_unavailable"
    (tmp_path / ocr.ARTIFACTS["det"][0]).write_bytes(b"wrong model")
    with pytest.raises(ApiProblem):
        ocr.asset_manifest(tmp_path)


def test_runtime_mismatch_fails_explicitly(tmp_path, monkeypatch):
    monkeypatch.setattr(ocr, "version", lambda _package: "unexpected")
    with pytest.raises(ApiProblem) as error:
        ocr.asset_manifest(tmp_path)
    assert error.value.code == "ocr_runtime_incompatible"


def test_valid_prefilled_cache_does_not_download(tmp_path, monkeypatch):
    import hashlib
    content = b"test artifact"
    digest = hashlib.sha256(content).hexdigest()
    monkeypatch.setattr(ocr, "ARTIFACTS", {"rec": ("test.onnx", "rec", digest)})
    monkeypatch.setattr(ocr, "version", lambda package: ocr.RUNTIME_VERSIONS[package])
    monkeypatch.setattr(ocr, "urlopen", lambda *_args, **_kwargs: pytest.fail("warm preparation must reuse verified assets"))
    (tmp_path / "test.onnx").write_bytes(content)
    assert ocr.prepare_assets(tmp_path)["models"]["rec"]["sha256"] == digest
