from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.chunking import TOKENIZER, chunk_structured
from app.pipeline import (
    _assemble_retrieval,
    _context_stage,
    _evaluation_metrics,
    _generation_stage,
    _rerank_stage,
    _retrieval_stage,
)
from app.quality import compute_retrieval_metrics
from app.repository import simple_fts_terms
from app.schemas import EvaluationDatasetRequest


def _fixture_chunks() -> list[dict[str, object]]:
    return [
        {
            "id": "chunk-hybrid",
            "ordinal": 0,
            "text": "AX42 retrieval combines dense and keyword search.",
            "page_numbers": [1],
            "source_element_ids": ["element-hybrid"],
            "embedding": [1.0, 0.0],
        },
        {
            "id": "chunk-keyword",
            "ordinal": 1,
            "text": "Device code AX42 is documented in Turkish.",
            "page_numbers": [1],
            "source_element_ids": ["element-keyword"],
            "embedding": [0.2, 0.98],
        },
        {
            "id": "chunk-dense",
            "ordinal": 2,
            "text": "Dense retrieval ranks this technical explanation highly.",
            "page_numbers": [2],
            "source_element_ids": ["element-dense"],
            "embedding": [0.95, 0.31],
        },
        {
            "id": "chunk-noise",
            "ordinal": 3,
            "text": "An unrelated English paragraph.",
            "page_numbers": [2],
            "source_element_ids": ["element-noise"],
            "embedding": [0.0, 1.0],
        },
    ]


def test_quality_fixture_covers_dense_keyword_hybrid_rrf_and_reusable_metrics():
    chunks = _fixture_chunks()
    dense = _retrieval_stage("AX42", "dense", 3, chunks, [1.0, 0.0])
    keyword = _retrieval_stage("AX42", "keyword", 3, chunks, None)
    hybrid = _retrieval_stage("AX42", "hybrid", 3, chunks, [1.0, 0.0])

    assert [item["chunkId"] for item in dense["results"]] == [
        "chunk-hybrid",
        "chunk-dense",
        "chunk-keyword",
    ]
    assert [item["chunkId"] for item in keyword["results"]] == [
        "chunk-hybrid",
        "chunk-keyword",
    ]
    assert hybrid["results"][0]["chunkId"] == "chunk-hybrid"
    assert hybrid["candidateK"] == 20
    assert hybrid["rrfK"] == 60

    metrics = compute_retrieval_metrics(hybrid["results"], ["element-hybrid"])
    assert metrics == {
        "hitAtK": 1.0,
        "precisionAtK": 1 / 3,
        "recallAtK": 1.0,
        "mrr": 1.0,
        "retrievalEligible": True,
        "expectedElementCount": 1,
        "retrievedRelevantElementCount": 1,
        "firstRelevantRank": 1,
    }


def test_quality_fixture_preserves_listwise_rerank_order_and_exposes_ordinal_rank():
    class Service:
        def __init__(self):
            self.settings = SimpleNamespace(gemini_rerank_model="rerank-model")

        def rerank(self, _prompt):
            return ["chunk-keyword", "chunk-dense", "chunk-hybrid"], SimpleNamespace(
                configured_model="rerank-configured",
                effective_model="rerank-effective",
            )

    retrieval = _retrieval_stage("AX42", "hybrid", 3, _fixture_chunks(), [1.0, 0.0])
    reranked = _rerank_stage("AX42", retrieval, Service(), candidate_count=3, top_k=3)

    assert [item["chunkId"] for item in reranked["results"]] == ["chunk-keyword", "chunk-dense", "chunk-hybrid"]
    assert [item["rerankRank"] for item in reranked["results"]] == [1, 2, 3]
    assert [item["rerankScore"] for item in reranked["results"]] == [3, 2, 1]
    assert [item["chunkId"] for item in reranked["inputCandidates"]] == [
        item["chunkId"] for item in retrieval["candidates"][:3]
    ]
    assert reranked["rerankScoreSemantics"] == "deprecated_ordinal_not_confidence"


def test_hybrid_fusion_keeps_branch_scores_and_prefers_strong_dense_match():
    dense = [
        {**_fixture_chunks()[0], "denseScore": 0.92},
        {**_fixture_chunks()[1], "denseScore": 0.40},
    ]
    keyword = [
        {**_fixture_chunks()[1], "keywordScore": 1.00},
        {**_fixture_chunks()[0], "keywordScore": 0.20},
    ]

    result = _assemble_retrieval("hybrid", 2, dense, keyword)

    assert result["results"][0]["chunkId"] == "chunk-hybrid"
    first = result["results"][0]
    assert first["denseScore"] == 0.92
    assert first["keywordScore"] == 0.20
    assert first["denseRank"] == 1
    assert first["keywordRank"] == 2
    assert first["fusionScore"] is not None
    assert result["fusion"] == {"method": "min_max_weighted", "denseWeight": 0.7, "keywordWeight": 0.3}


def test_structure_aware_chunking_keeps_recipe_parent_and_table_rows_intact():
    structured = {
        "elements": [
            {"id": "h1", "type": "heading", "text": "9. Tarif Kartları", "level": 1, "page_numbers": [1]},
            {"id": "h2", "type": "heading", "text": "Tarif A", "level": 2, "page_numbers": [1]},
            {"id": "h3", "type": "heading", "text": "Malzemeler", "level": 3, "page_numbers": [1]},
            {"id": "list", "type": "list", "text": "1 su bardağı mercimek", "page_numbers": [1]},
            {"id": "h4", "type": "heading", "text": "Adımlar", "level": 3, "page_numbers": [1]},
            {"id": "steps", "type": "list", "text": "Mercimeği pişir.", "page_numbers": [1]},
            {"id": "table", "type": "table", "text": "| Gün | Görev |\n| --- | --- |\n| Pzt | Salon |\n| Sal | Banyo |\n| Çar | Mutfak |", "page_numbers": [1]},
        ]
    }

    chunks = chunk_structured(
        structured,
        "structure_aware",
        {"chunkSizeTokens": 64, "overlapTokens": 0},
    )

    assert chunks[0].heading_path == ["9. Tarif Kartları", "Tarif A", "Adımlar"]
    assert "Tarif A" in chunks[0].text and "Malzemeler" in chunks[0].text
    assert all(not (chunk.text.strip() in {"9. Tarif Kartları", "Tarif A", "Malzemeler", "Adımlar"}) for chunk in chunks)
    table_chunks = [chunk for chunk in chunks if "| Gün | Görev |" in chunk.text]
    assert table_chunks
    assert all("| --- | --- |" in chunk.text for chunk in table_chunks)


def test_quality_fixture_keeps_greedy_budget_and_exact_duplicate_decisions_visible():
    candidates = [
        {"chunkId": "first", "text": "same source text"},
        {"chunkId": "duplicate", "text": "same source text"},
        {"chunkId": "over-budget", "text": "different source text"},
    ]
    result = _context_stage(candidates, TOKENIZER.count("same source text"))

    assert [item["chunkId"] for item in result["selected"]] == ["first"]
    assert [item["chunkId"] for item in result["excluded"]] == ["duplicate", "over-budget"]
    assert [item["reason"] for item in result["excluded"]] == ["duplicate_text", "budget_exceeded"]


def test_no_answer_returns_machine_safe_domain_result_without_calling_generation():
    class NeverCalledService:
        settings = SimpleNamespace(gemini_generation_model="generation-model")

        def generate_json(self, *_args, **_kwargs):  # pragma: no cover - assertion protects this path
            raise AssertionError("empty context must not call Gemini")

    result = _generation_stage(
        "What is not in the document?",
        {"selected": [], "formattedContext": ""},
        SimpleNamespace(max_output_tokens=128, temperature=0.1),
        NeverCalledService(),
    )

    assert result["insufficientContext"] is True
    assert result["answer"] == ""
    assert result["segments"] == []
    assert result["citations"] == []
    assert result["citationValidity"] == {
        "valid": True,
        "count": 0,
        "method": "context_id_membership_v1",
    }


def test_no_relevant_retrieval_reaches_the_same_empty_context_abstention_path():
    class NeverCalledService:
        settings = SimpleNamespace(gemini_generation_model="generation-model")

        def generate_json(self, *_args, **_kwargs):  # pragma: no cover - assertion protects this path
            raise AssertionError("no relevant retrieval must not call Gemini")

    retrieval = _retrieval_stage("zzzz", "keyword", 5, _fixture_chunks(), None)
    context = _context_stage(retrieval["results"], TOKENIZER.count("any context"))
    generation = _generation_stage(
        "What is not in the document?",
        {"selected": context["selected"], "formattedContext": context["formattedContext"]},
        SimpleNamespace(max_output_tokens=128, temperature=0.1),
        NeverCalledService(),
    )

    assert retrieval["results"] == []
    assert context["selected"] == []
    assert generation["insufficientContext"] is True
    assert generation["answer"] == ""


def test_generation_prompt_declares_user_language_and_citation_semantics():
    class Service:
        settings = SimpleNamespace(gemini_generation_model="generation-model", gemini_max_retries=0)

        def __init__(self):
            self.prompt = ""

        def generate_json(self, prompt, _config):
            self.prompt = prompt
            return {
                "insufficientContext": False,
                "segments": [{"text": "Grounded answer.", "citationIds": ["C1"]}],
            }, SimpleNamespace(configured_model="generation-model", effective_model="generation-v1")

    service = Service()
    result = _generation_stage(
        "Bu belge ne anlatıyor?",
        {
            "selected": [{"citationId": "C1", "chunkId": "chunk-1", "text": "Grounded source."}],
            "formattedContext": "[C1] Grounded source.",
        },
        SimpleNamespace(max_output_tokens=128, temperature=0.1),
        service,
    )

    assert "Answer in the language of the user's question unless the user explicitly requests another language." in service.prompt
    assert "Copy dates, times, identifiers, quantities, and currency values exactly from the cited context." in service.prompt
    assert result["citationValidity"]["method"] == "context_id_membership_v1"


def test_generation_abstains_after_unsupported_factual_token_retries():
    class Service:
        settings = SimpleNamespace(gemini_generation_model="generation-model", gemini_max_retries=1)

        def generate_json(self, _prompt, _config):
            return {
                "insufficientContext": False,
                "segments": [{"text": "Teslimat 10:30-10:00 aralığındadır.", "citationIds": ["C1"]}],
            }, SimpleNamespace(configured_model="generation-model", effective_model="generation-v1")

    result = _generation_stage(
        "Teslimat aralığı nedir?",
        {
            "selected": [{"citationId": "C1", "chunkId": "chunk-1", "text": "Teslimat 10:30-11:00 aralığındadır."}],
            "formattedContext": "[C1] Teslimat 10:30-11:00 aralığındadır.",
        },
        SimpleNamespace(max_output_tokens=128, temperature=0.1),
        Service(),
    )

    assert result["insufficientContext"] is True
    assert result["answer"] == ""
    assert result["groundingFailure"] == "unsupported_factual_token"


def test_no_answer_retrieval_metrics_are_excluded_and_abstention_is_separate():
    aggregate = _evaluation_metrics([
        {
            "hitAtK": 1.0,
            "precisionAtK": 1.0,
            "recallAtK": 1.0,
            "mrr": 1.0,
            "retrievalEligible": True,
            "citationValidity": 1.0,
            "groundedness": 0.8,
            "generationMetrics": {"faithfulness": 0.8, "answerRelevance": 0.7, "answerCorrectness": None},
        },
        {
            "hitAtK": None,
            "precisionAtK": None,
            "recallAtK": None,
            "mrr": None,
            "retrievalEligible": False,
            "abstentionEligible": True,
            "abstentionCorrect": True,
            "citationValidity": 1.0,
            "groundedness": 0.0,
            "generationMetrics": {"faithfulness": 0.0, "answerRelevance": None, "answerCorrectness": None},
        },
    ])

    assert aggregate["hitAtK"] == 1.0
    assert aggregate["precisionAtK"] == 1.0
    assert aggregate["recallAtK"] == 1.0
    assert aggregate["mrr"] == 1.0
    assert aggregate["retrievalEligibleCaseCount"] == 1
    assert aggregate["abstentionEligibleCaseCount"] == 1
    assert aggregate["abstentionAccuracy"] == 1.0


def test_evaluation_dataset_limits_separate_interactive_and_benchmark_admission():
    cases = [{"question": f"Question {index}"} for index in range(11)]
    with pytest.raises(ValidationError):
        EvaluationDatasetRequest(document_id="doc-1", name="interactive", cases=cases)

    benchmark = EvaluationDatasetRequest(
        document_id="doc-1",
        name="benchmark",
        evaluation_mode="benchmark",
        cases=[{"question": f"Question {index}"} for index in range(50)],
    )
    assert len(benchmark.cases) == 50

    no_answer = EvaluationDatasetRequest(
        document_id="doc-1",
        name="no-answer",
        cases=[{"question": "Question outside the document", "expectedOutcome": "insufficient_context"}],
    )
    assert no_answer.cases[0].expected_outcome == "insufficient_context"

    with pytest.raises(ValidationError):
        EvaluationDatasetRequest(
            document_id="doc-1",
            name="too-large",
            evaluation_mode="benchmark",
            cases=[{"question": f"Question {index}"} for index in range(201)],
        )


def test_simple_fts_termization_preserves_turkish_english_codes_and_numbers():
    assert simple_fts_terms("Türkçe AX42 2026 retrieval") == ["türkçe", "ax42", "2026", "retrieval"]
