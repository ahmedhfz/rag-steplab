from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
import uuid

import pytest
from pydantic import ValidationError

from app.chunking import chunk_structured
from app.config import Settings, pipeline_lease_duration_seconds
from app.errors import ApiProblem
from app.pipeline import _assemble_retrieval, _evaluation_metrics, _generation_stage, _rerank_stage
from app.repository import InMemoryRepository, now_utc
from app.schemas import ExperimentCreateRequest, EvaluationRunRequest


def test_reranking_configuration_fails_fast_outside_candidate_bounds():
    with pytest.raises(ValidationError):
        ExperimentCreateRequest(
            document_id="doc-1",
            query="query",
            retrieval={"topK": 5},
            reranking={"enabled": True, "candidateCount": 4},
        )

    with pytest.raises(ValidationError):
        EvaluationRunRequest(
            dataset_id="dataset-1",
            retrieval={"topK": 5},
            reranking={"enabled": True, "candidateCount": 21},
        )

    valid = ExperimentCreateRequest(
        document_id="doc-1",
        query="query",
        retrieval={"topK": 5},
        reranking={"enabled": True, "candidateCount": 20},
    )
    assert valid.reranking.candidate_count == 20


class _RerankService:
    def __init__(self):
        self.prompt = ""

    def rerank(self, prompt):
        self.prompt = prompt
        return ["chunk-1", "chunk-0"], SimpleNamespace(
            configured_model="rerank-configured",
            effective_model="rerank-effective",
        )


def test_retrieval_keeps_full_pool_and_rerank_shrinks_to_available_candidates():
    chunks = [
        {"id": f"chunk-{index}", "ordinal": index, "text": f"text {index}", "page_numbers": [1]}
        for index in range(2)
    ]
    retrieval = _assemble_retrieval(
        "keyword",
        1,
        [],
        [{**chunk, "keywordScore": 1.0 - index * 0.1} for index, chunk in enumerate(chunks)],
    )
    assert retrieval["availableCandidateCount"] == 2
    assert len(retrieval["candidates"]) == 2
    assert len(retrieval["results"]) == 1

    service = _RerankService()
    reranking = _rerank_stage("what?", retrieval, service, candidate_count=5, top_k=4)
    assert reranking["candidateCount"] == 2
    assert len(reranking["candidates"]) == 2
    assert len(reranking["results"]) == 2
    assert "what?" in service.prompt


def test_recursive_chunking_uses_one_continuous_overlap_window():
    structured = {
        "elements": [
            {"id": "a", "type": "paragraph", "text": "alpha " * 25, "page_numbers": [1]},
            {"id": "b", "type": "paragraph", "text": "beta " * 25, "page_numbers": [1]},
            {"id": "c", "type": "paragraph", "text": "gamma " * 25, "page_numbers": [1]},
        ]
    }
    drafts = chunk_structured(
        structured,
        "recursive_token",
        {"chunkSizeTokens": 32, "overlapTokens": 8},
    )
    assert len(drafts) >= 3
    assert any(
        set(left.source_element_ids).intersection(right.source_element_ids)
        for left, right in zip(drafts, drafts[1:])
    )
    assert drafts[0].ordinal == 0
    assert [draft.ordinal for draft in drafts] == list(range(len(drafts)))


def test_pipeline_lease_budget_includes_worker_startup_provider_and_grace():
    settings = Settings(
        pipeline_worker_startup_timeout_seconds=30,
        pipeline_worker_timeout_seconds=100,
        pipeline_lease_grace_seconds=10,
        gemini_timeout_seconds=5,
        gemini_max_retries=1,
    )
    # Nested provider envelope: (1 + 1)^3 = 8 attempts, each up to the 5 s
    # timeout plus the client's 20 s maximum backoff = 200 s, which exceeds
    # the 100 s worker timeout: 30 + 200 + 10.
    assert pipeline_lease_duration_seconds(settings) == 240


def test_fencing_token_blocks_reclaimed_worker_and_dispatch_reservation_is_atomic():
    repository = InMemoryRepository()
    token_one = str(uuid.uuid4())
    token_two = str(uuid.uuid4())
    first, owner = repository.claim_experiment(
        {
            "id": "experiment-1",
            "document_id": "document-1",
            "chunk_run_id": "chunk-1",
            "embedding_run_id": None,
            "query": "query",
            "target_stage": "retrieval",
            "experiment_fingerprint": "fingerprint-1",
            "config": {},
            "stage_results": {},
            "status": "queued",
            "started_at": now_utc(),
            "lease_token": token_one,
            "lease_expires_at": now_utc() + timedelta(seconds=30),
        }
    )
    assert owner is True
    reserved = repository.claim_pipeline_dispatch("experiment", first["id"], "dispatch-1")
    duplicate_reservation = repository.claim_pipeline_dispatch("experiment", first["id"], "dispatch-2")
    assert reserved["dispatch_id"] == "dispatch-1"
    assert duplicate_reservation["dispatch_id"] == "dispatch-1"

    # The worker started and then stopped renewing its lease.
    repository.experiments[first["id"]]["status"] = "running"
    repository.experiments[first["id"]]["worker_started_at"] = now_utc() - timedelta(seconds=60)
    repository.experiments[first["id"]]["lease_expires_at"] = now_utc() - timedelta(seconds=1)
    reclaimed, reclaimed_owner = repository.claim_experiment(
        {
            "id": "experiment-2",
            "document_id": "document-1",
            "chunk_run_id": "chunk-1",
            "embedding_run_id": None,
            "query": "query",
            "target_stage": "retrieval",
            "experiment_fingerprint": "fingerprint-1",
            "config": {},
            "stage_results": {},
            "status": "queued",
            "started_at": now_utc(),
            "lease_token": token_two,
            "lease_expires_at": now_utc() + timedelta(seconds=30),
        }
    )
    assert reclaimed_owner is True
    assert reclaimed["lease_token"] == token_two
    assert repository.update_experiment_stage(first["id"], "retrieval", {"status": "completed"}, token_one) is None
    assert repository.update_experiment_stage(first["id"], "retrieval", {"status": "completed"}, token_two) is not None
    assert repository.complete_experiment(first["id"], token_one) is None
    assert repository.complete_experiment(first["id"], token_two)["status"] == "completed"


def test_evaluation_claim_reuses_equivalent_active_run():
    repository = InMemoryRepository()
    first, owner = repository.claim_evaluation(
        {
            "id": "evaluation-1",
            "dataset_id": "dataset-1",
            "evaluation_fingerprint": "evaluation-fingerprint-1",
            "config": {},
            "child_experiment_ids": [],
            "results": {"aggregate": {"caseCount": 0}, "caseResults": []},
            "status": "queued",
            "identity_claimed": True,
            "lease_token": str(uuid.uuid4()),
            "lease_expires_at": now_utc() + timedelta(seconds=30),
            "started_at": now_utc(),
        }
    )
    second, second_owner = repository.claim_evaluation(
        {
            "id": "evaluation-2",
            "dataset_id": "dataset-1",
            "evaluation_fingerprint": "evaluation-fingerprint-1",
            "config": {},
            "child_experiment_ids": [],
            "results": {"aggregate": {"caseCount": 0}, "caseResults": []},
            "status": "queued",
            "identity_claimed": True,
            "lease_token": str(uuid.uuid4()),
            "lease_expires_at": now_utc() + timedelta(seconds=30),
            "started_at": now_utc(),
        }
    )
    assert owner is True
    assert second_owner is False
    assert second["id"] == first["id"]


def test_expired_pipeline_lease_is_terminalized_and_old_worker_is_fenced():
    repository = InMemoryRepository()
    token = str(uuid.uuid4())
    row, owner = repository.claim_experiment(
        {
            "id": "experiment-expired",
            "document_id": "document-1",
            "chunk_run_id": "chunk-1",
            "embedding_run_id": None,
            "query": "query",
            "target_stage": "retrieval",
            "experiment_fingerprint": "fingerprint-expired",
            "config": {},
            "stage_results": {},
            "status": "queued",
            "started_at": now_utc() - timedelta(minutes=1),
            "lease_token": token,
            "lease_expires_at": now_utc() - timedelta(seconds=1),
        }
    )
    assert owner is True
    reconciled = repository.reconcile_pipeline_lease("experiment", row["id"])
    assert reconciled["status"] == "interrupted"
    assert reconciled["error_code"] == "worker_lease_expired"
    assert repository.update_experiment_stage(row["id"], "retrieval", {"status": "completed"}, token) is None


def test_generation_builds_answer_from_citation_covered_segments():
    class Service:
        settings = SimpleNamespace(gemini_generation_model="generation-model", gemini_max_retries=0)

        def generate_json(self, _prompt, _config):
            return {
                "insufficientContext": False,
                "segments": [
                    {"text": "First factual segment.", "citationIds": ["C1"]},
                    {"text": "Second factual segment.", "citationIds": ["C2"]},
                ],
            }, SimpleNamespace(configured_model="generation-model", effective_model="generation-v1")

    result = _generation_stage(
        "question",
        {
            "selected": [
                {"citationId": "C1", "chunkId": "chunk-1", "text": "First factual segment."},
                {"citationId": "C2", "chunkId": "chunk-2", "text": "Second factual segment."},
            ],
            "formattedContext": "[C1] First factual segment.\n[C2] Second factual segment.",
        },
        SimpleNamespace(max_output_tokens=128, temperature=0.1),
        Service(),
    )
    assert result["answer"] == "First factual segment.\n\nSecond factual segment."
    assert result["citationCoverage"] == {"segmentCount": 2, "citedSegmentCount": 2, "ratio": 1.0}


def test_generation_rejects_an_uncited_answer_segment():
    class Service:
        settings = SimpleNamespace(gemini_generation_model="generation-model", gemini_max_retries=0)

        def generate_json(self, _prompt, _config):
            return {"insufficientContext": False, "segments": [{"text": "uncited", "citationIds": []}]}, SimpleNamespace(
                configured_model="generation-model", effective_model="generation-v1"
            )

    with pytest.raises(ApiProblem) as error:
        _generation_stage(
            "question",
            {"selected": [{"citationId": "C1", "chunkId": "chunk-1", "text": "context"}], "formattedContext": "[C1] context"},
            SimpleNamespace(max_output_tokens=128, temperature=0.1),
            Service(),
        )
    assert error.value.code == "citation_invalid"


def test_evaluation_generation_metrics_average_only_numeric_scores():
    aggregate = _evaluation_metrics(
        [
            {
                "hitAtK": 1.0,
                "precisionAtK": 1.0,
                "recallAtK": 1.0,
                "mrr": 1.0,
                "citationValidity": 1.0,
                "groundedness": 0.8,
                "generationMetrics": {
                    "faithfulness": 0.8,
                    "answerRelevance": 0.7,
                    "answerCorrectness": 0.6,
                },
            },
            {
                "hitAtK": 0.0,
                "precisionAtK": 0.0,
                "recallAtK": 0.0,
                "mrr": 0.0,
                "citationValidity": 0.0,
                "groundedness": 0.0,
                "generationMetrics": {
                    "faithfulness": 0.4,
                    "answerRelevance": 0.5,
                    "answerCorrectness": None,
                },
            },
        ]
    )
    assert aggregate["generationMetrics"] == {
        "faithfulness": 0.6000000000000001,
        "answerRelevance": 0.6,
        "answerCorrectness": 0.6,
        "lexicalOverlap": None,
        "method": None,
        "metricVersion": "generation-metrics-v2",
        "eligibleCaseCount": 1,
        "scoredCaseCount": 2,
        "lexicalScoredCaseCount": 0,
        "skippedCaseCount": 0,
    }
