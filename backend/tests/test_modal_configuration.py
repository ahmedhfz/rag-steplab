import ast
from pathlib import Path

import modal_app


def test_interactive_api_is_warm_in_europe_without_warming_docling_worker():
    manifest = modal_app.local_manifest()

    assert manifest["apiProfile"] == {
        "cpu": 0.5,
        "memoryMiB": 1024,
        "minContainers": 1,
        "maxContainers": 4,
        "computeRegion": "eu",
    }
    assert manifest["routingRegion"] == "eu-west"
    assert manifest["workerProfile"]["minContainers"] == 0
    assert "api_eu" in manifest["functions"]


def test_burst_capacity_scales_out_within_the_postgres_connection_budget():
    from app.db import MAX_OVERFLOW, POOL_SIZE

    manifest = modal_app.local_manifest()
    # Only the interactive API stays warm; the burst limits cost nothing idle.
    assert manifest["pipelineWorkerProfile"]["minContainers"] == 0
    assert manifest["maintenanceProfile"]["minContainers"] == 0
    assert (
        manifest["apiProfile"]["maxContainers"],
        manifest["pipelineWorkerProfile"]["maxContainers"],
        manifest["workerProfile"]["maxContainers"],
        manifest["maintenanceProfile"]["maxContainers"],
    ) == (4, 3, 2, 1)
    # The legacy rollback endpoint is not scaled with api_eu.
    assert modal_app.legacy_api_options["max_containers"] == 2

    # One input per container: no Function opts into concurrent inputs, so a
    # container never needs more than its own small pool.
    tree = ast.parse(Path(modal_app.__file__).read_text(encoding="utf-8"))
    decorators = [
        ast.unparse(decorator)
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
        for decorator in node.decorator_list
    ]
    assert not any("concurrent" in decorator for decorator in decorators)

    # docs/deployment.md budget: at most 20 pooled connections at full scale
    # for api_eu + pipeline_worker + parse_worker + maintenance_sweeper.
    containers = sum(
        options["max_containers"]
        for options in (
            modal_app.api_options,
            modal_app.pipeline_options,
            modal_app.worker_options,
            modal_app.maintenance_options,
        )
    )
    assert containers * (POOL_SIZE + MAX_OVERFLOW) <= 20


def test_api_requirements_do_not_initialize_docling_runtime():
    backend_root = Path(modal_app.__file__).resolve().parent
    api_requirements = (backend_root / "requirements.txt").read_text(encoding="utf-8").lower()
    ci_requirements = (backend_root / "requirements-ci.txt").read_text(encoding="utf-8").lower()
    worker_requirements = (backend_root / "requirements-worker.txt").read_text(encoding="utf-8").lower()

    assert "docling" not in api_requirements
    assert "torch" not in api_requirements
    assert "requirements-worker.txt" not in ci_requirements
    assert "docling" not in ci_requirements
    assert "torch" not in ci_requirements
    assert "nvidia" not in ci_requirements
    assert "docling==2.117.0" in worker_requirements
    assert "rapidocr==3.9.2" in worker_requirements
    assert "onnxruntime==1.30.0" in worker_requirements
    assert modal_app.worker_env["RAG_OCR_MODEL_PATH"] == modal_app.OCR_MODEL_PATH
    assert not modal_app.OCR_MODEL_PATH.startswith(modal_app.MODEL_MOUNT_PATH + "/")


def test_production_health_check_uses_the_routing_region_endpoint():
    repository_root = Path(__file__).resolve().parents[2]
    ci_workflow = (repository_root / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8")
    workflow = (repository_root / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")

    assert "https://ahmedhfz-dev--rag-steplab-api-api-eu.eu-west.modal.run" in workflow
    assert 'branches: [main]' in ci_workflow
    assert "feature/**" not in ci_workflow
    assert "  push:" not in ci_workflow
    # Release her main push'unda çalışır; deploy kararı diff'ten değil canlı Modal tag'inden verilir.
    assert "paths:" not in workflow.split("jobs:")[0]
    assert "modal app history" in workflow


def test_parse_reconciliation_budget_covers_modal_execution_and_startup():
    from app.config import PARSE_RUN_TIMEOUT_SECONDS

    assert PARSE_RUN_TIMEOUT_SECONDS == (
        modal_app.worker_options["timeout"] + modal_app.worker_options["startup_timeout"] + 120
    )
