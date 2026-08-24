"""Modal entry points for the API and the full Docling parse worker.

The HTTP function only accepts/uploads work and dispatches a durable parse run.
CPU-heavy conversion is kept in ``parse_worker`` so the API containers can
scale independently and the Docling model volume can scale to zero with them.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

import modal


_BACKEND_ROOT = Path(__file__).resolve().parent
APP_NAME = os.getenv("MODAL_APP_NAME", "rag-steplab-api")
MODEL_VOLUME_NAME = os.getenv("MODAL_DOCLING_VOLUME_NAME", "rag-steplab-docling-models-v2")
MODEL_MOUNT_PATH = "/models/docling"
PARSER_VERSION = os.getenv("DOCLING_PARSER_VERSION", "docling-2.117.0")
MODEL_ARTIFACTS_PATH = f"{MODEL_MOUNT_PATH}/{PARSER_VERSION}"


def _named_secrets(variable: str, default: str) -> list[modal.Secret]:
    """Resolve secret names at deploy time without putting values in source."""

    names = os.getenv(variable, default)
    return [
        modal.Secret.from_name(name.strip())
        for name in names.split(",")
        if name.strip()
    ]


app = modal.App(APP_NAME)
model_volume = modal.Volume.from_name(MODEL_VOLUME_NAME, create_if_missing=True)
api_secrets = _named_secrets("MODAL_API_SECRET_NAMES", "rag-steplab-api-runtime")
worker_secrets = _named_secrets("MODAL_WORKER_SECRET_NAMES", "rag-steplab-parser-runtime")

# Keep API and worker dependency sets separate. The API image can import the
# parser module, while only the worker image carries the pinned full Docling
# distribution and its model tooling.
api_image = (
    modal.Image.debian_slim(python_version="3.13")
    .pip_install_from_requirements(str(_BACKEND_ROOT / "requirements.txt"))
    .pip_install("modal==1.5.4")
    .add_local_python_source("app")
)
worker_image = (
    modal.Image.debian_slim(python_version="3.13")
    # CPU-only wheels avoid pulling multi-gigabyte CUDA runtime layers into a
    # CPU worker. Versions match the tested Docling 2.117.0 environment.
    .pip_install(
        "torch==2.13.0+cpu",
        "torchvision==0.28.0+cpu",
        index_url="https://download.pytorch.org/whl/cpu",
    )
    .pip_install_from_requirements(str(_BACKEND_ROOT / "requirements.txt"))
    .pip_install_from_requirements(str(_BACKEND_ROOT / "requirements-worker.txt"))
    # Keep this runtime-only layer after the Python dependency layers so a
    # package-list change does not force the large Docling/Torch stack to rebuild.
    .apt_install("libgl1", "libglib2.0-0")
    .add_local_python_source("app")
)
worker_env = {
    "DOCLING_ARTIFACTS_PATH": MODEL_ARTIFACTS_PATH,
    "DOCLING_PARSER_VERSION": PARSER_VERSION,
}

worker_options: dict[str, Any] = {
    "image": worker_image,
    "secrets": worker_secrets,
    "volumes": {MODEL_MOUNT_PATH: model_volume},
    "env": worker_env,
    "cpu": 2.0,
    "memory": 4096,
    "min_containers": 0,
    "max_containers": 1,
    "timeout": 900,
    "startup_timeout": 300,
}

legacy_api_options: dict[str, Any] = {
    "image": api_image,
    "secrets": api_secrets,
    "cpu": 0.5,
    "memory": 1024,
    "min_containers": 0,
    "max_containers": 2,
    "timeout": 300,
    "startup_timeout": 300,
}
api_compute_region = os.getenv("MODAL_API_COMPUTE_REGION", "eu")
api_routing_region = os.getenv("MODAL_API_ROUTING_REGION", "eu-west")
api_options: dict[str, Any] = {
    **legacy_api_options,
    "min_containers": 1,
    "region": api_compute_region,
    "routing_region": api_routing_region,
}
pipeline_options: dict[str, Any] = {
    "image": api_image,
    "secrets": api_secrets,
    "cpu": 1.0,
    "memory": 2048,
    "min_containers": 0,
    "max_containers": 1,
    "timeout": max(60, int(os.getenv("PIPELINE_WORKER_TIMEOUT_SECONDS", "1800"))),
    "startup_timeout": max(30, int(os.getenv("PIPELINE_WORKER_STARTUP_TIMEOUT_SECONDS", "300"))),
}


@app.function(**worker_options)
def parse_worker(parse_run_id: str) -> dict[str, Any]:
    """Convert one durable run with the full Docling DocumentConverter."""

    from app.pipeline import run_parse_worker

    result = run_parse_worker(parse_run_id)
    if result is None:
        raise RuntimeError(f"Parse run {parse_run_id} was not found.")
    return result


@app.function(**pipeline_options)
def pipeline_worker(kind: str, run_id: str, lease_token: str) -> dict[str, Any] | None:
    """Execute one persisted experiment/evaluation under a fencing lease."""

    from app.pipeline import run_pipeline_worker

    return run_pipeline_worker(kind, run_id, lease_token)


@app.function(**worker_options)
def benchmark_parse(parse_run_id: str) -> dict[str, Any]:
    """Run the worker path and expose persisted resource measurements."""

    from app.pipeline import run_parse_worker

    result = run_parse_worker(parse_run_id)
    if result is None:
        raise RuntimeError(f"Parse run {parse_run_id} was not found.")
    return {
        "parseRunId": parse_run_id,
        "status": result.get("status"),
        "measurement": result.get("execution_metadata", {}).get("measurement", {}),
        "executionMetadata": result.get("execution_metadata", {}),
    }


@app.function(
    image=worker_image,
    volumes={MODEL_MOUNT_PATH: model_volume},
    env=worker_env,
    timeout=1800,
    startup_timeout=300,
)
def prefetch_docling_models() -> dict[str, str]:
    """Download pinned Docling artifacts once into the versioned Volume."""

    Path(MODEL_ARTIFACTS_PATH).mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "docling-tools",
            "models",
            "download",
            "layout",
            "tableformer",
            "rapidocr",
            "--output-dir",
            MODEL_ARTIFACTS_PATH,
        ],
        check=True,
    )
    model_volume.commit()
    return {"volume": MODEL_VOLUME_NAME, "path": MODEL_ARTIFACTS_PATH, "parserVersion": PARSER_VERSION}


@app.function(
    image=worker_image,
    volumes={MODEL_MOUNT_PATH: model_volume},
    env=worker_env,
    timeout=300,
    startup_timeout=300,
)
def remote_import_smoke() -> dict[str, Any]:
    """Validate the packaged application and full Docling imports remotely."""

    import docling
    import app.main
    import app.parser

    return {
        "appImported": app.main.app.title == "RAG StepLab API",
        "parserImported": callable(app.parser.parse_pdf_file),
        "doclingVersion": getattr(docling, "__version__", "unknown"),
        "artifactPath": os.getenv("DOCLING_ARTIFACTS_PATH"),
        "artifactPathExists": Path(MODEL_ARTIFACTS_PATH).is_dir(),
    }


@app.function(**legacy_api_options)
@modal.asgi_app()
def api():
    """Keep the previous endpoint as a scale-to-zero rollback during cutover."""

    from app.main import app as fastapi_app

    return fastapi_app


@app.function(**api_options)
@modal.asgi_app()
def api_eu():
    """Serve the interactive API from warm European compute and routing."""

    from app.main import app as fastapi_app

    return fastapi_app


def local_manifest() -> dict[str, Any]:
    """Return deployment facts useful for static smoke tests."""

    return {
        "app": APP_NAME,
        "parserVersion": PARSER_VERSION,
        "volume": MODEL_VOLUME_NAME,
        "modelMountPath": MODEL_MOUNT_PATH,
        "modelArtifactsPath": MODEL_ARTIFACTS_PATH,
        "functions": ["api_eu", "api", "parse_worker", "pipeline_worker", "benchmark_parse", "prefetch_docling_models"],
        "workerProfile": {"cpu": 2.0, "memoryMiB": 4096, "minContainers": 0, "maxContainers": 1, "timeoutSeconds": 900},
        "pipelineWorkerProfile": {
            "cpu": 1.0,
            "memoryMiB": 2048,
            "minContainers": 0,
            "maxContainers": 1,
            "timeoutSeconds": pipeline_options["timeout"],
            "startupTimeoutSeconds": pipeline_options["startup_timeout"],
        },
        "apiProfile": {
            "cpu": 0.5,
            "memoryMiB": 1024,
            "minContainers": 1,
            "maxContainers": 2,
            "computeRegion": api_compute_region,
        },
        "routingRegion": api_routing_region,
    }


if __name__ == "__main__":
    print(json.dumps(local_manifest(), sort_keys=True))
