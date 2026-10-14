"""Text-model fallback provenance and failure diagnostics in experiments and evaluations."""

from __future__ import annotations

import logging

from app.errors import ApiProblem
from app.gemini import GeminiCallFailed, GeminiCallMetadata
from app.pipeline import (
    _evaluation_model_summary,
    _evaluation_reusable,
    _log_run_failure,
    _model_provenance,
    _provenance_reusable,
    queue_experiment,
    run_queued_experiment,
)
from app.repository import get_repository, reset_repository
from app.schemas import ExperimentCreateRequest
from app.storage import reset_storage
from tests.test_pipeline import Phase5FakeGemini, _phase5_document, _phase5_generation_request, client


def setup_function():
    reset_repository()
    reset_storage()


def _fallback_metadata(configured: str) -> GeminiCallMetadata:
    return GeminiCallMetadata(configured_model=configured, effective_model="fallback-v1-001", fallback_model="fallback-v1")


class FallbackGemini(Phase5FakeGemini):
    """The configured text models are overloaded and a fallback answers every call."""

    def rerank(self, prompt):
        ids, _metadata = super().rerank(prompt)
        return ids, _fallback_metadata(self.settings.gemini_rerank_model)

    def generate_json(self, prompt, config):
        value, _metadata = super().generate_json(prompt, config)
        return value, _fallback_metadata(self.settings.gemini_generation_model)

    def judge(self, _prompt):
        type(self).calls["judge"] += 1
        return {"faithfulness": 0.9, "answerRelevance": 0.8, "claimResults": []}, _fallback_metadata(
            self.settings.gemini_judge_model
        )


class ProviderOverloaded(RuntimeError):
    """Shaped like google.genai's APIError: numeric code, status token, free-text message."""

    code = 503
    status = "UNAVAILABLE"


class OverloadedGemini(Phase5FakeGemini):
    def rerank(self, _prompt):
        type(self).calls["rerank"] += 1
        try:
            # Provider messages can quote request content; it must never reach the logs.
            raise ProviderOverloaded("503 UNAVAILABLE. Retrieval finds relevant chunks")
        except RuntimeError as cause:
            raise GeminiCallFailed("rerank", ("gemini-rerank-v1", "fallback-v1")) from cause


def _use(monkeypatch, fake):
    monkeypatch.setattr("app.pipeline.GeminiService", fake)
    fake.reset()


def test_fallback_provenance_is_never_cacheable_under_the_configured_model():
    primary = _model_provenance("gemini-generation-v1", "gemini-generation-v1", role="generation")
    fallback = _model_provenance("gemini-generation-v1", "fallback-v1-001", role="generation", fallback_model="fallback-v1")

    assert primary["cacheable"] is True and "fallbackModel" not in primary
    assert fallback["configuredModel"] == "gemini-generation-v1"
    assert fallback["effectiveModel"] == "fallback-v1-001"
    assert fallback["fallbackModel"] == "fallback-v1"
    assert fallback["cacheable"] is False
    assert _provenance_reusable({"model": fallback}) is False


def test_experiment_records_the_fallback_model_and_never_reuses_its_output(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    _use(monkeypatch, FallbackGemini)
    request = _phase5_generation_request(document_id, chunk_run_id)

    first = client.post("/experiments", json=request)

    assert first.status_code == 200
    stages = first.json()["stageResults"]
    for stage, configured in (("reranking", "gemini-rerank-v1"), ("generation", "gemini-generation-v1")):
        assert stages[stage]["configuredModel"] == configured
        assert stages[stage]["effectiveModel"] == "fallback-v1-001"
        assert stages[stage]["fallbackModel"] == "fallback-v1"
        assert stages[stage]["provenance"]["model"]["fallbackModel"] == "fallback-v1"
        assert stages[stage]["provenance"]["cacheable"] is False

    # The identical request must run again instead of presenting fallback
    # output as the configured models' result.
    second = client.post("/experiments", json=request)

    assert second.status_code == 200
    assert second.json()["id"] != first.json()["id"]
    assert second.json()["stageResults"]["generation"]["reuse"]["executed"] is True
    assert FallbackGemini.calls["rerank"] == 2
    assert FallbackGemini.calls["generate"] == 2


def test_evaluation_names_the_fallback_judge_and_is_not_reused(monkeypatch):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    _use(monkeypatch, FallbackGemini)
    dataset = client.post(
        "/evaluation/datasets",
        json={"documentId": document_id, "name": "fallback", "cases": [{"question": "retrieval"}]},
    ).json()
    request = {
        "datasetId": dataset["id"],
        "chunkRunId": chunk_run_id,
        "retrieval": {"mode": "keyword", "topK": 1},
        "reranking": {"enabled": False, "candidateCount": 1},
        "judge": True,
    }

    first = client.post("/evaluation/runs", json=request)

    assert first.status_code == 200
    results = first.json()["results"]
    case = results["caseResults"][0]
    assert case["generationMetrics"]["configuredModel"] == "gemini-judge-v1"
    assert case["generationMetrics"]["fallbackModel"] == "fallback-v1"
    assert case["fallbackModelUsed"] is True
    assert results["aggregate"]["judgeModel"] == "fallback-v1"
    assert results["aggregate"]["fallbackModelUsed"] is True

    second = client.post("/evaluation/runs", json=request)

    assert second.status_code == 200
    assert second.json()["id"] != first.json()["id"]
    assert FallbackGemini.calls["judge"] == 2


def test_judge_model_summary_names_every_model_that_scored(monkeypatch):
    from tests.test_pipeline import _phase5_settings

    monkeypatch.setattr("app.pipeline.get_settings", _phase5_settings)
    primary_case = {"generationMetrics": {"configuredModel": "gemini-judge-v1"}}
    fallback_case = {
        "generationMetrics": {"configuredModel": "gemini-judge-v1", "fallbackModel": "fallback-v1"},
        "fallbackModelUsed": True,
    }
    unjudged_case = {"generationMetrics": {"skippedReason": "no_answer_segments"}}

    assert _evaluation_model_summary([unjudged_case], judge=False) == {"judgeModel": None, "fallbackModelUsed": False}
    assert _evaluation_model_summary([unjudged_case], judge=True)["judgeModel"] == "gemini-judge-v1"
    assert _evaluation_model_summary([primary_case], judge=True) == {"judgeModel": "gemini-judge-v1", "fallbackModelUsed": False}
    assert _evaluation_model_summary([primary_case, fallback_case], judge=True) == {
        "judgeModel": "gemini-judge-v1, fallback-v1",
        "fallbackModelUsed": True,
    }
    row = {"status": "completed", "results": {"aggregate": {"fallbackModelUsed": True}}}
    assert _evaluation_reusable(row, {"models": {"judge": "gemini-judge-v1"}}) is False
    row["results"]["aggregate"]["fallbackModelUsed"] = False
    assert _evaluation_reusable(row, {"models": {"judge": "gemini-judge-v1"}}) is True


def test_failed_experiment_logs_code_cause_and_models_without_document_text(monkeypatch, caplog):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    _use(monkeypatch, OverloadedGemini)
    caplog.set_level(logging.WARNING, logger="app.pipeline")

    response = client.post("/experiments", json=_phase5_generation_request(document_id, chunk_run_id))

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "gemini_rerank_failed"
    [record] = [record for record in caplog.records if record.getMessage().startswith("pipeline_run_failed")]
    message = record.getMessage()
    assert "kind=experiment" in message
    assert "error_code=gemini_rerank_failed" in message
    assert "cause_type=ProviderOverloaded" in message
    assert "cause_code=503" in message
    assert "cause_status=UNAVAILABLE" in message
    assert "models_tried=gemini-rerank-v1,fallback-v1" in message
    assert "Retrieval finds relevant chunks" not in message


def test_run_failure_log_never_carries_free_text_from_the_cause(caplog):
    caplog.set_level(logging.WARNING, logger="app.pipeline")
    try:
        try:
            float("The confidential clause from page 3")
        except ValueError as cause:
            raise ApiProblem(503, "invalid_generation_metrics", "The generation judge returned a non-numeric metric.") from cause
    except ApiProblem as exc:
        _log_run_failure("evaluation_case", "evaluation-1", exc)

    [record] = [record for record in caplog.records if record.getMessage().startswith("pipeline_run_failed")]
    message = record.getMessage()
    assert "error_code=invalid_generation_metrics" in message
    assert "cause_type=ValueError" in message
    assert "cause_code=None cause_status=None" in message
    assert "confidential clause" not in message


def test_failed_queued_experiment_worker_logs_the_provider_cause(monkeypatch, caplog):
    document_id, chunk_run_id = _phase5_document(monkeypatch)
    _use(monkeypatch, OverloadedGemini)
    repository = get_repository()
    queued = queue_experiment(
        ExperimentCreateRequest.model_validate(_phase5_generation_request(document_id, chunk_run_id)),
        repository=repository,
    )
    caplog.set_level(logging.WARNING, logger="app.pipeline")

    assert run_queued_experiment(None, queued["id"], repository=repository) is None

    persisted = repository.get_experiment_row(queued["id"])
    assert persisted["status"] == "failed"
    assert persisted["error_code"] == "gemini_rerank_failed"
    messages = [record.getMessage() for record in caplog.records]
    assert any(
        f"run_id={queued['id']}" in message
        and "error_code=gemini_rerank_failed" in message
        and "models_tried=gemini-rerank-v1,fallback-v1" in message
        for message in messages
    )
