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


def _service(responses, *, max_retries=2, sleeps=None, monkeypatch=None, **settings):
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

    service = GeminiService(Settings(gemini_max_retries=max_retries, **settings), client=SimpleNamespace(models=Models()))
    return service, calls


class ProviderError(Exception):
    """Mimics google.genai errors.APIError: an HTTP status in ``code``."""

    def __init__(self, code: int, message: str = "provider error") -> None:
        super().__init__(f"{code} {message}")
        self.code = code


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
    # Without a fallback the same model is retried after the provider's hint.
    service, calls = _service(
        iter([QuotaError(), ok]), sleeps=sleeps, monkeypatch=monkeypatch, gemini_text_fallback_models=()
    )

    service.rerank("prompt")

    assert len(calls) == 2
    assert sleeps == [7.0]


_PROVIDER_MESSAGE = "You exceeded your current quota. Echo of document text: secret chunk"
_QUOTA_ID = "EmbedContentRequestsPerMinutePerUserPerProjectPerModel-FreeTier"


def _gemini_quota_error(retry_delay: str):
    """The 429 Gemini returned in production-shaped repro: no Retry-After header, RetryInfo in the body."""

    from google.genai import errors

    return errors.ClientError(
        429,
        {
            "error": {
                "code": 429,
                "message": _PROVIDER_MESSAGE,
                "status": "RESOURCE_EXHAUSTED",
                "details": [
                    {
                        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
                        "violations": [
                            {
                                "quotaMetric": "generativelanguage.googleapis.com/embed_content_free_tier_requests",
                                "quotaId": _QUOTA_ID,
                                "quotaValue": "100",
                            }
                        ],
                    },
                    {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": retry_delay},
                ],
            }
        },
    )


def _embedding_service(outcomes, *, sleeps, monkeypatch):
    monkeypatch.setattr("app.gemini.time.sleep", lambda seconds: sleeps.append(seconds))
    monkeypatch.setattr("app.gemini.random.uniform", lambda _low, _high: 0.0)
    calls = []

    class Models:
        def embed_content(self, *, model, contents, config):
            calls.append(len(contents))
            outcome = next(outcomes)
            if isinstance(outcome, Exception):
                raise outcome
            return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.0, 0.0, 0.0]) for _ in contents])

    service = GeminiService(
        Settings(gemini_embedding_dimensions=3, gemini_max_retries=2),
        client=SimpleNamespace(models=Models()),
    )
    return service, calls


def test_embedding_quota_error_waits_the_window_named_in_the_error_body(monkeypatch):
    sleeps = []
    service, calls = _embedding_service(iter([_gemini_quota_error("58s"), "ok"]), sleeps=sleeps, monkeypatch=monkeypatch)

    values, _metadata = service.embed_documents(["first", "second"])

    assert len(values) == 2
    assert calls == [2, 2]
    # The provider's RetryInfo wins over the 1 s exponential guess, beyond the text cap.
    assert sleeps == [58.0]


def test_quota_wait_longer_than_the_budget_fails_at_once_with_the_provider_status(monkeypatch):
    import pytest

    from app.gemini import GeminiCallFailed

    sleeps = []
    service, calls = _embedding_service(iter([_gemini_quota_error("3600s")]), sleeps=sleeps, monkeypatch=monkeypatch)

    with pytest.raises(GeminiCallFailed) as error:
        service.embed_documents(["text"])

    # A daily quota does not reset inside one batch budget: no pointless waits.
    assert calls == [1]
    assert sleeps == []
    assert error.value.code == "gemini_embedding_failed"
    assert error.value.message == "Gemini embedding failed (provider 429 RESOURCE_EXHAUSTED)."
    assert _PROVIDER_MESSAGE not in error.value.message


def test_text_call_without_fallback_does_not_wait_for_a_quota_beyond_its_cap(monkeypatch):
    import pytest

    from app.errors import ApiProblem

    sleeps = []
    service, calls = _service(
        iter([_gemini_quota_error("45s")]), sleeps=sleeps, monkeypatch=monkeypatch, gemini_text_fallback_models=()
    )

    with pytest.raises(ApiProblem) as error:
        service.rerank("prompt")

    assert error.value.code == "gemini_rerank_failed"
    assert len(calls) == 1
    assert sleeps == []


def test_failed_provider_requests_log_status_class_and_quota_without_message_text(monkeypatch, caplog):
    import logging

    caplog.set_level(logging.WARNING, logger="app.gemini")
    service, _calls = _embedding_service(iter([_gemini_quota_error("27s"), "ok"]), sleeps=[], monkeypatch=monkeypatch)

    service.embed_documents(["text"])

    [message] = [record.getMessage() for record in caplog.records if record.getMessage().startswith("gemini_call_failed")]
    assert message == (
        "gemini_call_failed action=embedding model=None attempt=1/3 status=429 provider_status=RESOURCE_EXHAUSTED "
        f"cause_type=ClientError quota_id={_QUOTA_ID} provider_retry_after=27.0 retry_in=27.0"
    )
    assert "secret chunk" not in caplog.text


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


# --- Text-model fallback -------------------------------------------------

_FALLBACK_SETTINGS = {
    "gemini_generation_model": "primary-v1",
    "gemini_rerank_model": "primary-v1",
    "gemini_judge_model": "primary-v1",
    "gemini_text_fallback_models": ("fallback-v1",),
}
_ANSWER = '{"insufficientContext":true,"segments":[]}'


def test_overloaded_primary_moves_to_the_fallback_at_once_and_records_who_answered(monkeypatch):
    sleeps = []
    ok = SimpleNamespace(text=_ANSWER, model_version="fallback-v1-001")
    service, calls = _service(iter([ProviderError(503, "UNAVAILABLE"), ok]), sleeps=sleeps, monkeypatch=monkeypatch, **_FALLBACK_SETTINGS)

    _value, metadata = service.generate_json("prompt", {"temperature": 0.1})

    assert [call["model"] for call in calls] == ["primary-v1", "fallback-v1"]
    assert sleeps == []  # no backoff on the overloaded model before switching
    assert metadata.configured_model == "primary-v1"
    assert metadata.fallback_model == "fallback-v1"
    assert metadata.effective_model == "fallback-v1-001"


def test_fallback_output_without_a_provider_version_is_attributed_to_the_requested_fallback(monkeypatch):
    ok = SimpleNamespace(text=_ANSWER)
    service, _calls = _service(iter([ProviderError(429), ok]), sleeps=[], monkeypatch=monkeypatch, **_FALLBACK_SETTINGS)

    _value, metadata = service.judge("prompt")

    assert metadata.effective_model == "fallback-v1"
    assert metadata.fallback_model == "fallback-v1"


def test_primary_answer_is_not_marked_as_fallback(monkeypatch):
    ok = SimpleNamespace(text='{"orderedCandidateIds":["a"]}', model_version="primary-v1")
    service, calls = _service(iter([ok]), sleeps=[], monkeypatch=monkeypatch, **_FALLBACK_SETTINGS)

    _ids, metadata = service.rerank("prompt")

    assert [call["model"] for call in calls] == ["primary-v1"]
    assert metadata.fallback_model is None
    assert metadata.effective_model == "primary-v1"


def test_timeout_moves_to_the_fallback_and_a_second_timeout_stops(monkeypatch):
    import httpx
    import pytest

    from app.errors import ApiProblem

    ok = SimpleNamespace(text='{"orderedCandidateIds":["a"]}', model_version="fallback-v1")
    service, calls = _service(iter([httpx.ReadTimeout("slow"), ok]), sleeps=[], monkeypatch=monkeypatch, **_FALLBACK_SETTINGS)
    assert service.rerank("prompt")[1].fallback_model == "fallback-v1"
    assert [call["model"] for call in calls] == ["primary-v1", "fallback-v1"]

    service, calls = _service(
        iter([httpx.ReadTimeout("slow"), httpx.ReadTimeout("slow"), ok]), sleeps=[], monkeypatch=monkeypatch, **_FALLBACK_SETTINGS
    )
    with pytest.raises(ApiProblem) as error:
        service.rerank("prompt")
    assert error.value.code == "gemini_rerank_failed"
    assert [call["model"] for call in calls] == ["primary-v1", "fallback-v1"]


def test_non_retryable_primary_errors_fail_without_fallback(monkeypatch):
    import pytest

    from app.gemini import GeminiCallFailed

    for status in (400, 401, 403, 404):
        service, calls = _service(iter([ProviderError(status)]), sleeps=[], monkeypatch=monkeypatch, **_FALLBACK_SETTINGS)
        with pytest.raises(GeminiCallFailed) as error:
            service.generate_json("prompt")
        assert error.value.code == "gemini_generation_failed"
        assert error.value.status_code == 503
        assert error.value.models_tried == ("primary-v1",)
        assert [call["model"] for call in calls] == ["primary-v1"]


def test_unusable_fallback_is_dropped_and_the_primary_retried_with_backoff(monkeypatch):
    sleeps = []
    ok = SimpleNamespace(text=_ANSWER, model_version="primary-v1")
    service, calls = _service(
        iter([ProviderError(503), ProviderError(404, "model retired"), ok, ok]), sleeps=sleeps, monkeypatch=monkeypatch, **_FALLBACK_SETTINGS
    )

    _value, metadata = service.generate_json("prompt")

    assert [call["model"] for call in calls] == ["primary-v1", "fallback-v1", "primary-v1"]
    assert len(sleeps) == 1
    assert metadata.fallback_model is None
    # A later call on the same service does not request the retired fallback again.
    service.generate_json("prompt")
    assert calls[-1]["model"] == "primary-v1"


def test_later_calls_of_one_service_start_with_the_model_that_answered(monkeypatch):
    ok = SimpleNamespace(text='{"orderedCandidateIds":["a"]}', model_version="fallback-v1")
    service, calls = _service(iter([ProviderError(503), ok, ok]), sleeps=[], monkeypatch=monkeypatch, **_FALLBACK_SETTINGS)

    service.rerank("prompt")
    service.rerank("prompt")

    assert [call["model"] for call in calls] == ["primary-v1", "fallback-v1", "fallback-v1"]


def test_fallback_equal_to_the_configured_model_is_skipped(monkeypatch):
    sleeps = []
    ok = SimpleNamespace(text='{"orderedCandidateIds":["a"]}', model_version="primary-v1")
    service, calls = _service(
        iter([ProviderError(503), ok]),
        sleeps=sleeps,
        monkeypatch=monkeypatch,
        **{**_FALLBACK_SETTINGS, "gemini_text_fallback_models": ("primary-v1",)},
    )

    service.rerank("prompt")

    assert [call["model"] for call in calls] == ["primary-v1", "primary-v1"]
    assert len(sleeps) == 1


def test_exhausted_fallback_chain_reports_the_models_tried_within_the_retry_budget(monkeypatch):
    import pytest

    from app.gemini import GeminiCallFailed

    service, calls = _service(iter([ProviderError(503)] * 10), sleeps=[], monkeypatch=monkeypatch, **_FALLBACK_SETTINGS)

    with pytest.raises(GeminiCallFailed) as error:
        service.judge("prompt")

    assert error.value.code == "gemini_judge_failed"
    assert error.value.models_tried == ("primary-v1", "fallback-v1")
    assert len(calls) == 3  # gemini_max_retries + 1, not multiplied by the fallback


def test_invalid_json_retry_with_fallback_stays_within_the_structured_budget(monkeypatch):
    import pytest

    from app.errors import ApiProblem

    bad = SimpleNamespace(text="not-json", model_version="fallback-v1")
    service, calls = _service(iter([ProviderError(503), bad, bad, bad]), sleeps=[], monkeypatch=monkeypatch, **_FALLBACK_SETTINGS)

    with pytest.raises(ApiProblem) as error:
        service.generate_json("prompt")

    assert error.value.code == "gemini_invalid_json"
    # The invalid-JSON retry starts on the model that answered, not on the overloaded primary.
    assert [call["model"] for call in calls] == ["primary-v1", "fallback-v1", "fallback-v1"]


def test_text_calls_carry_their_own_shorter_request_timeout(monkeypatch):
    from google.genai import types

    ok = SimpleNamespace(text=_ANSWER, model_version="primary-v1")
    service, calls = _service(iter([ok]), sleeps=[], monkeypatch=monkeypatch, gemini_text_timeout_seconds=20, gemini_timeout_seconds=60)

    service.generate_json("prompt", {"temperature": 0.1})

    assert calls[0]["config"]["http_options"] == {"timeout": 20_000}
    assert calls[0]["config"]["temperature"] == 0.1
    # The installed SDK accepts the per-request override in the request config.
    assert types.GenerateContentConfig(**calls[0]["config"]).http_options.timeout == 20_000


def test_text_request_timeout_never_goes_below_the_gemini_minimum_deadline(monkeypatch):
    ok = SimpleNamespace(text=_ANSWER, model_version="primary-v1")
    service, calls = _service(iter([ok]), sleeps=[], monkeypatch=monkeypatch, gemini_text_timeout_seconds=5)

    service.generate_json("prompt")

    # Gemini answers a sub-10 s deadline with 400, which would skip the fallback.
    assert calls[0]["config"]["http_options"] == {"timeout": 10_000}


def test_embeddings_never_fall_back_to_another_model(monkeypatch):
    import pytest

    from app.errors import ApiProblem

    monkeypatch.setattr("app.gemini.time.sleep", lambda _seconds: None)
    calls = []

    class Models:
        def embed_content(self, *, model, contents, config):
            calls.append((model, config))
            raise ProviderError(503)

    service = GeminiService(
        Settings(gemini_embedding_dimensions=3, gemini_max_retries=2, **_FALLBACK_SETTINGS),
        client=SimpleNamespace(models=Models()),
    )

    with pytest.raises(ApiProblem) as error:
        service.embed_documents(["text"])

    assert error.value.code == "gemini_embedding_failed"
    assert [model for model, _config in calls] == ["gemini-embedding-2"] * 3
    assert all("http_options" not in config for _model, config in calls)


def test_fallback_models_are_read_from_the_environment(monkeypatch):
    from app.config import DEFAULT_GEMINI_TEXT_FALLBACK_MODELS, clear_settings_cache, get_settings

    try:
        monkeypatch.delenv("GEMINI_TEXT_FALLBACK_MODELS", raising=False)
        clear_settings_cache()
        assert get_settings().gemini_text_fallback_models == DEFAULT_GEMINI_TEXT_FALLBACK_MODELS == ("gemini-3.1-flash-lite",)

        monkeypatch.setenv("GEMINI_TEXT_FALLBACK_MODELS", " model-a, model-b ,model-a,, ")
        clear_settings_cache()
        assert get_settings().gemini_text_fallback_models == ("model-a", "model-b")

        monkeypatch.setenv("GEMINI_TEXT_FALLBACK_MODELS", "")
        clear_settings_cache()
        assert get_settings().gemini_text_fallback_models == ()
    finally:
        monkeypatch.undo()
        clear_settings_cache()
