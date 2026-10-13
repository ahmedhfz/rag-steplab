"""Small, explicit Gemini adapter used by embedding and experiment stages."""

from __future__ import annotations

import json
import logging
import random
import time
from dataclasses import dataclass
from typing import Any, Callable, Sequence

from .config import Settings, get_settings
from .errors import ApiProblem


logger = logging.getLogger(__name__)

EMBEDDING_FORMAT_VERSION = "gemini-embedding-2-qa-prefix-v1"

RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})
# A timeout already consumed the full request budget; retry it at most once
# (a switch to a fallback model after a timeout counts as that retry).
MAX_TIMEOUT_RETRIES = 1
# Invalid structured JSON is retried once. Together with the transport retry
# this bounds one structured call to (gemini_max_retries + 1) * 2 requests,
# whether or not a fallback model was used.
STRUCTURED_OUTPUT_ATTEMPTS = 2
MAX_RETRY_DELAY_SECONDS = 20.0

# The SDK/provider constrain the JSON shape, while pipeline code below still
# performs parsing and semantic validation for IDs, citations, and scores.
GENERATION_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "insufficientContext": {"type": "boolean"},
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "citationIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["text", "citationIds"],
            },
        },
    },
    "required": ["insufficientContext", "segments"],
}

RERANK_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "orderedCandidateIds": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["orderedCandidateIds"],
}

JUDGE_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "faithfulness": {"type": "number"},
        "answerRelevance": {"type": "number"},
        "answerCorrectness": {"type": "number", "nullable": True},
        "claimResults": {"type": "array", "items": {"type": "object"}},
    },
    "required": ["faithfulness", "answerRelevance"],
}


@dataclass(frozen=True)
class GeminiCallMetadata:
    configured_model: str
    # The model that produced the output (provider-reported version when
    # available, otherwise the requested model ID).
    effective_model: str | None = None
    # Set only when a text fallback produced the output: the model ID that
    # was requested instead of ``configured_model``.
    fallback_model: str | None = None


class GeminiCallFailed(ApiProblem):
    """A provider call that exhausted its retry/fallback budget.

    Public code/message are the existing ``gemini_<action>_failed`` contract;
    ``models_tried`` is diagnostic data for logs only.
    """

    def __init__(self, action: str, models_tried: Sequence[str] = ()) -> None:
        super().__init__(503, f"gemini_{action}_failed", f"Gemini {action} failed.")
        self.models_tried = tuple(models_tried)


def document_embedding_text(text: str, heading_path: Sequence[str] | None = None) -> str:
    title = " / ".join(part.strip() for part in (heading_path or []) if part.strip()) or "none"
    return f"title: {title} | text: {text}"


def query_embedding_text(query: str) -> str:
    return f"task: question answering | query: {query}"


class GeminiService:
    def __init__(self, settings: Settings | None = None, client: Any | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = client
        # Text models that failed transiently, or fallbacks that are unusable,
        # during this service's lifetime (one experiment run, or one
        # evaluation's judge). Later calls try the remaining models first
        # instead of waiting on an overloaded model again.
        self._degraded_models: set[str] = set()
        self._unusable_models: set[str] = set()

    @property
    def client(self) -> Any:
        if self._client is None:
            if not self.settings.gemini_api_key:
                raise ApiProblem(503, "gemini_not_configured", "Gemini is not configured.")
            try:
                from google import genai
                from google.genai import types

                self._client = genai.Client(
                    api_key=self.settings.gemini_api_key,
                    http_options=types.HttpOptions(
                        timeout=max(1, self.settings.gemini_timeout_seconds) * 1000,
                        # Retry tek yerde yönetilir; SDK varsayılanı ayarlanan
                        # deneme sayısını istemeden katlamamalıdır.
                        retry_options=types.HttpRetryOptions(attempts=1),
                    ),
                )
            except ImportError as exc:  # pragma: no cover
                raise ApiProblem(503, "gemini_dependency_missing", "Gemini SDK is not installed.") from exc
            except Exception as exc:
                raise ApiProblem(503, "gemini_unavailable", "Gemini could not be initialised.") from exc
        return self._client

    @staticmethod
    def _status(exc: Exception) -> int | None:
        value = getattr(exc, "status_code", getattr(exc, "code", None))
        try:
            return int(value) if value is not None else None
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _is_timeout(exc: Exception) -> bool:
        try:
            import httpx

            if isinstance(exc, httpx.TimeoutException):
                return True
        except ImportError:  # pragma: no cover - httpx ships with google-genai
            pass
        return isinstance(exc, TimeoutError)

    @staticmethod
    def _is_connection_error(exc: Exception) -> bool:
        try:
            import httpx

            if isinstance(exc, (httpx.ConnectError, httpx.RemoteProtocolError, httpx.ReadError)):
                return True
        except ImportError:  # pragma: no cover - httpx ships with google-genai
            pass
        return isinstance(exc, ConnectionError)

    @staticmethod
    def _retry_after_seconds(exc: Exception) -> float | None:
        headers = getattr(getattr(exc, "response", None), "headers", None)
        if not headers:
            return None
        try:
            value = float(headers.get("retry-after") or headers.get("Retry-After"))
        except (TypeError, ValueError, AttributeError):
            return None
        return value if value >= 0 else None

    def _retry_delay(self, exc: Exception, attempt: int) -> float:
        status = self._status(exc)
        if status == 429:
            # Quota errors need real backoff; honour the provider hint first.
            hinted = self._retry_after_seconds(exc)
            base = hinted if hinted is not None else 1.0 * (2**attempt)
        else:
            base = 0.5 * (2**attempt)
        return min(MAX_RETRY_DELAY_SECONDS, base + random.uniform(0, base * 0.25))

    def _text_model_chain(self, configured: str) -> list[str]:
        """Configured model, then distinct usable fallbacks; healthy models lead."""

        fallbacks = (model for model in self.settings.gemini_text_fallback_models if model not in self._unusable_models)
        chain = list(dict.fromkeys([configured, *fallbacks]))
        return [model for model in chain if model not in self._degraded_models] + [
            model for model in chain if model in self._degraded_models
        ]

    def _text_request_options(self) -> dict[str, Any]:
        # Per-request override; the client-level timeout stays the embedding one.
        return {"http_options": {"timeout": max(1, self.settings.gemini_text_timeout_seconds) * 1000}}

    def _with_retry(
        self,
        function: Callable[[str | None], Any],
        *,
        action: str,
        text_model: str | None = None,
    ) -> tuple[Any, str | None]:
        """The only transport retry layer for provider calls.

        Retries retryable HTTP statuses, connection errors and (once) timeouts,
        with exponential backoff, jitter and ``Retry-After`` for quota errors.
        ``function`` receives the model ID to request (``None`` when the
        caller fixes its own model) and the result is ``(response, model)``.

        ``text_model`` (generation, rerank and judge only; never embeddings)
        enables the fallback chain. A transient failure moves to the next
        model at once instead of backing off on an overloaded one; only a
        model that already failed in this call is retried, after backoff. The
        request count stays ``gemini_max_retries + 1`` either way. A
        non-retryable error (400/401/403/404 ...) from the configured model
        fails as before; from a fallback it only removes that fallback, so a
        retired fallback cannot turn a transient primary failure into a hard one.
        """

        chain: list[str | None] = list(self._text_model_chain(text_model)) if text_model else [None]
        attempts = max(0, self.settings.gemini_max_retries) + 1
        failed: set[str | None] = set()
        tried: list[str] = []
        timeouts = 0
        index = 0
        for attempt in range(attempts):
            model = chain[index]
            try:
                response = function(model)
            except ApiProblem:
                raise
            except Exception as exc:
                failed.add(model)
                if model is not None and model not in tried:
                    tried.append(model)
                timed_out = self._is_timeout(exc)
                timeouts += int(timed_out)
                transient = (
                    self._status(exc) in RETRYABLE_STATUS_CODES
                    or self._is_connection_error(exc)
                    or timed_out
                )
                unusable_fallback = not transient and model is not None and model != text_model
                if transient and model is not None:
                    self._degraded_models.add(model)
                if unusable_fallback:
                    logger.warning(
                        "gemini_fallback_unusable action=%s model=%s status=%s cause_type=%s",
                        action,
                        model,
                        self._status(exc),
                        type(exc).__name__,
                    )
                    self._unusable_models.add(str(model))
                if attempt + 1 >= attempts or (timed_out and timeouts > MAX_TIMEOUT_RETRIES):
                    raise GeminiCallFailed(action, tried) from exc
                if transient:
                    index = min(index + 1, len(chain) - 1)
                elif unusable_fallback:
                    chain.pop(index)
                    index = min(index, len(chain) - 1)
                else:
                    raise GeminiCallFailed(action, tried) from exc
                if chain[index] in failed:
                    time.sleep(self._retry_delay(exc, attempt))
                continue
            if model is not None and model != text_model:
                logger.warning(
                    "gemini_fallback_used action=%s configured_model=%s model=%s failed_models=%s",
                    action,
                    text_model,
                    model,
                    ",".join(tried) or None,
                )
            return response, model
        raise GeminiCallFailed(action, tried)

    @staticmethod
    def _embedding_values(response: Any) -> list[list[float]]:
        raw = getattr(response, "embeddings", response)
        if raw is None:
            return []
        if not isinstance(raw, (list, tuple)):
            raw = [raw]
        result: list[list[float]] = []
        for item in raw:
            values = getattr(item, "values", item)
            if isinstance(values, dict):
                values = values.get("values", [])
            result.append([float(value) for value in (values or [])])
        return result

    @staticmethod
    def _effective_model(response: Any, configured: str) -> str | None:
        for name in ("model_version", "modelVersion", "model", "model_name", "modelName"):
            value = getattr(response, name, None)
            if value:
                return str(value)
            if isinstance(response, dict) and response.get(name):
                return str(response[name])
        return configured if configured and not configured.endswith("-latest") else None

    def embed_documents(self, texts: Sequence[str]) -> tuple[list[list[float]], GeminiCallMetadata]:
        model = self.settings.gemini_embedding_model
        dimensions = self.settings.gemini_embedding_dimensions
        if not texts:
            return [], GeminiCallMetadata(configured_model=model, effective_model=None)
        try:
            from google.genai import types
        except ImportError as exc:  # pragma: no cover - dependency is part of the API image
            raise ApiProblem(503, "gemini_dependency_missing", "Gemini SDK is not installed.") from exc

        # Gemini Embedding 2 returns one vector per Content object. A list of
        # independent Content values is therefore the real one-request batch;
        # passing a string or a list of text parts would aggregate the inputs.
        contents = [
            types.Content(parts=[types.Part.from_text(text=str(text))])
            for text in texts
        ]

        def call(_model: str | None) -> Any:
            config: dict[str, Any] = {"output_dimensionality": dimensions}
            return self.client.models.embed_content(model=model, contents=contents, config=config)

        # No fallback chain: another embedding model would silently change the
        # vector space and break lineage compatibility.
        response, _ = self._with_retry(call, action="embedding")
        response_values = self._embedding_values(response)
        if len(response_values) != len(contents) or any(len(values) != dimensions for values in response_values):
            raise ApiProblem(
                503,
                "gemini_embedding_invalid",
                "Gemini did not return one embedding per input with the configured dimension.",
            )
        return response_values, GeminiCallMetadata(
            configured_model=model,
            effective_model=self._effective_model(response, model),
        )

    def embed_query(self, query: str) -> tuple[list[float], GeminiCallMetadata]:
        values, metadata = self.embed_documents([query_embedding_text(query)])
        return values[0], metadata

    def count_tokens(self, model: str, contents: str) -> int | None:
        def call(_model: str | None) -> Any:
            return self.client.models.count_tokens(model=model, contents=contents)

        try:
            response, _ = self._with_retry(call, action="token_count")
        except ApiProblem:
            return None
        value = getattr(response, "total_tokens", None)
        return int(value) if value is not None else None

    @staticmethod
    def _response_text(response: Any) -> str:
        value = getattr(response, "text", response)
        return str(value or "").strip()

    @staticmethod
    def _hit_output_limit(response: Any) -> bool:
        for candidate in getattr(response, "candidates", None) or []:
            reason = getattr(candidate, "finish_reason", None)
            if str(getattr(reason, "name", reason) or "").upper().endswith("MAX_TOKENS"):
                return True
        return False

    def _structured_json(
        self,
        configured_model: str,
        prompt: str,
        request_config: dict[str, Any],
        *,
        action: str,
        error_code: str,
        error_message: str,
    ) -> tuple[Any, GeminiCallMetadata]:
        """One structured text call over the configured model's fallback chain.

        The returned metadata names the model that produced the parsed output.
        """

        config = {**request_config, **self._text_request_options()}

        def call(model: str | None) -> Any:
            return self.client.models.generate_content(model=model, contents=prompt, config=config)

        for attempt in range(STRUCTURED_OUTPUT_ATTEMPTS):
            response, requested = self._with_retry(call, action=action, text_model=configured_model)
            model = requested or configured_model
            try:
                value = json.loads(self._response_text(response))
            except (TypeError, ValueError) as exc:
                if self._hit_output_limit(response):
                    # The same token limit would truncate the JSON again.
                    raise ApiProblem(
                        503,
                        "gemini_output_truncated",
                        "Gemini stopped at the output token limit before completing structured output.",
                    ) from exc
                if attempt + 1 >= STRUCTURED_OUTPUT_ATTEMPTS:
                    raise ApiProblem(503, error_code, error_message) from exc
                continue
            return value, GeminiCallMetadata(
                configured_model=configured_model,
                effective_model=self._effective_model(response, model),
                fallback_model=model if model != configured_model else None,
            )
        raise ApiProblem(503, error_code, error_message)

    def generate_json(self, prompt: str, config: dict[str, Any] | None = None) -> tuple[dict[str, Any], GeminiCallMetadata]:
        request_config = {
            "response_mime_type": "application/json",
            "response_json_schema": GENERATION_RESPONSE_SCHEMA,
            **(config or {}),
        }
        value, metadata = self._structured_json(
            self.settings.gemini_generation_model,
            prompt,
            request_config,
            action="generation",
            error_code="gemini_invalid_json",
            error_message="Gemini returned invalid structured output.",
        )
        if not isinstance(value, dict):
            raise ApiProblem(503, "gemini_invalid_json", "Gemini returned invalid structured output.")
        return value, metadata

    def rerank(self, prompt: str) -> tuple[list[str], GeminiCallMetadata]:
        request_config = {
            "response_mime_type": "application/json",
            "response_json_schema": RERANK_RESPONSE_SCHEMA,
        }
        value, metadata = self._structured_json(
            self.settings.gemini_rerank_model,
            prompt,
            request_config,
            action="rerank",
            error_code="gemini_invalid_rerank",
            error_message="Gemini returned invalid reranking output.",
        )
        ids = value.get("orderedCandidateIds") if isinstance(value, dict) else value
        if not isinstance(ids, list) or not all(isinstance(item, str) for item in ids):
            raise ApiProblem(503, "gemini_invalid_rerank", "Gemini returned invalid reranking output.")
        return ids, metadata

    def judge(self, prompt: str) -> tuple[dict[str, Any], GeminiCallMetadata]:
        request_config = {
            "response_mime_type": "application/json",
            "response_json_schema": JUDGE_RESPONSE_SCHEMA,
            # Scores should vary with the answer, not with sampling.
            "temperature": 0.0,
        }
        value, metadata = self._structured_json(
            self.settings.gemini_judge_model,
            prompt,
            request_config,
            action="judge",
            error_code="gemini_invalid_judge",
            error_message="Gemini returned invalid judge output.",
        )
        if not isinstance(value, dict):
            raise ApiProblem(503, "gemini_invalid_judge", "Gemini returned invalid judge output.")
        return value, metadata
