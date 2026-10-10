from __future__ import annotations

from types import SimpleNamespace

from app.config import Settings
from app.gemini import (
    GENERATION_RESPONSE_SCHEMA,
    JUDGE_RESPONSE_SCHEMA,
    RERANK_RESPONSE_SCHEMA,
    GeminiService,
    document_embedding_text,
    query_embedding_text,
)


def test_embedding_two_documents_uses_one_batched_request():
    calls: list[object] = []

    class Models:
        def embed_content(self, *, model, contents, config):
            calls.append(contents)
            return SimpleNamespace(
                embeddings=[
                    SimpleNamespace(values=[1.0, 2.0, 3.0]),
                    SimpleNamespace(values=[4.0, 5.0, 6.0]),
                ],
                model_version="gemini-embedding-2",
            )

    service = GeminiService(
        Settings(gemini_embedding_dimensions=3),
        client=SimpleNamespace(models=Models()),
    )
    values, metadata = service.embed_documents(["first", "second"])

    assert len(calls) == 1
    assert len(calls[0]) == 2
    assert values == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
    assert metadata.effective_model == "gemini-embedding-2"


def test_embedding_2_question_answering_format_matches_official_contract():
    assert query_embedding_text("What is RRF?") == "task: question answering | query: What is RRF?"
    assert document_embedding_text("Fusion combines rankings.", []) == "title: none | text: Fusion combines rankings."


def test_generation_retries_an_invalid_structured_response():
    responses = iter(["not-json", '{"answer":"grounded","claims":[]}'])

    class Models:
        def generate_content(self, **_kwargs):
            return SimpleNamespace(text=next(responses), model_version="gemini-3.5-flash-lite")

    service = GeminiService(
        Settings(gemini_max_retries=1),
        client=SimpleNamespace(models=Models()),
    )
    value, metadata = service.generate_json("Answer from context")

    assert value["answer"] == "grounded"
    assert metadata.effective_model == "gemini-3.5-flash-lite"


def test_generation_rerank_and_judge_send_official_json_schemas_and_keep_text_parsing():
    calls: list[dict[str, object]] = []
    responses = iter([
        '{"insufficientContext":false,"segments":[]}',
        '{"orderedCandidateIds":["candidate-1"]}',
        '{"faithfulness":0.8,"answerRelevance":0.7,"answerCorrectness":null,"claimResults":[]}',
    ])

    class Models:
        def generate_content(self, **kwargs):
            calls.append(kwargs["config"])
            return SimpleNamespace(text=next(responses), model_version="gemini-2.5-flash-lite")

    service = GeminiService(
        Settings(gemini_max_retries=0),
        client=SimpleNamespace(models=Models()),
    )

    generation, _ = service.generate_json("generation")
    reranked, _ = service.rerank("rerank")
    judge, _ = service.judge("judge")

    assert generation["insufficientContext"] is False
    assert reranked == ["candidate-1"]
    assert judge["faithfulness"] == 0.8
    assert all(call["response_mime_type"] == "application/json" for call in calls)
    assert all(isinstance(call["response_json_schema"], dict) for call in calls)
    assert calls[0]["response_json_schema"]["required"] == ["insufficientContext", "segments"]
    assert calls[1]["response_json_schema"]["required"] == ["orderedCandidateIds"]
    assert calls[2]["response_json_schema"]["required"] == ["faithfulness", "answerRelevance"]


def test_current_google_genai_sdk_accepts_all_adapter_schemas():
    from google.genai import types

    for schema in (GENERATION_RESPONSE_SCHEMA, RERANK_RESPONSE_SCHEMA, JUDGE_RESPONSE_SCHEMA):
        config = types.GenerateContentConfig(
            response_mime_type="application/json",
            response_json_schema=schema,
        )
        assert config.response_json_schema == schema


def _service(responses, *, max_retries=2, sleeps=None, monkeypatch=None):
    if monkeypatch is not None:
        monkeypatch.setattr("app.gemini.time.sleep", lambda seconds: sleeps.append(seconds))
        monkeypatch.setattr("app.gemini.random.uniform", lambda _low, _high: 0.0)
    calls = []

    class Models:
        def generate_content(self, **kwargs):
            calls.append(kwargs)
            value = next(responses)
            if isinstance(value, Exception):
                raise value
            return value

    return GeminiService(Settings(gemini_max_retries=max_retries), client=SimpleNamespace(models=Models())), calls


def test_timeout_is_retried_once_not_until_retry_budget(monkeypatch):
    import httpx
    import pytest

    from app.errors import ApiProblem

    sleeps = []
    ok = SimpleNamespace(text='{"orderedCandidateIds":["a"]}', model_version="m")
    service, calls = _service(iter([httpx.ReadTimeout("slow"), ok]), sleeps=sleeps, monkeypatch=monkeypatch)
    assert service.rerank("prompt")[0] == ["a"]
    assert len(calls) == 2

    service, calls = _service(
        iter([httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow"), ok]), sleeps=sleeps, monkeypatch=monkeypatch
    )
    with pytest.raises(ApiProblem) as error:
        service.rerank("prompt")
    assert error.value.code == "gemini_rerank_failed"
    assert len(calls) == 2


def test_quota_error_honours_retry_after(monkeypatch):
    class QuotaError(Exception):
        code = 429
        response = SimpleNamespace(headers={"retry-after": "7"})

    sleeps = []
    ok = SimpleNamespace(text='{"orderedCandidateIds":[]}', model_version="m")
    service, calls = _service(iter([QuotaError(), ok]), sleeps=sleeps, monkeypatch=monkeypatch)

    service.rerank("prompt")

    assert len(calls) == 2
    assert sleeps == [7.0]


def test_invalid_json_and_transport_retries_do_not_multiply_beyond_budget(monkeypatch):
    import pytest

    from app.errors import ApiProblem

    sleeps = []
    bad = SimpleNamespace(text="not-json", model_version="m")
    service, calls = _service(iter([bad] * 10), sleeps=sleeps, monkeypatch=monkeypatch)

    with pytest.raises(ApiProblem) as error:
        service.generate_json("prompt")

    assert error.value.code == "gemini_invalid_json"
    assert len(calls) == 2


def test_output_token_limit_is_reported_without_retrying(monkeypatch):
    import pytest

    from app.errors import ApiProblem

    truncated = SimpleNamespace(
        text='{"insufficientContext":false,"segm',
        model_version="m",
        candidates=[SimpleNamespace(finish_reason=SimpleNamespace(name="MAX_TOKENS"))],
    )
    service, calls = _service(iter([truncated] * 3), sleeps=[], monkeypatch=monkeypatch)

    with pytest.raises(ApiProblem) as error:
        service.generate_json("prompt")

    assert error.value.code == "gemini_output_truncated"
    assert len(calls) == 1


def test_judge_uses_zero_temperature_and_defaults_are_pinned_models():
    service, calls = _service(iter([SimpleNamespace(text='{"faithfulness":1,"answerRelevance":1}', model_version="m")]))

    service.judge("prompt")

    assert calls[0]["config"]["temperature"] == 0.0
    defaults = Settings()
    for model in (defaults.gemini_generation_model, defaults.gemini_rerank_model, defaults.gemini_judge_model):
        assert not model.endswith("-latest")
