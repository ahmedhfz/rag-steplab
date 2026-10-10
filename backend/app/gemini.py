"""Small, explicit Gemini adapter used by embedding and experiment stages."""

from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass
from typing import Any, Sequence

from .config import Settings, get_settings
from .errors import ApiProblem


EMBEDDING_FORMAT_VERSION = "gemini-embedding-2-qa-prefix-v1"

RETRYABLE_STATUS_CODES = frozenset({408, 429, 500, 502, 503, 504})
# A timeout already consumed the full request budget; retry it at most once.
MAX_TIMEOUT_RETRIES = 1
# Invalid structured JSON is retried once. Together with the transport retry
# this bounds one structured call to (gemini_max_retries + 1) * 2 requests.
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
    effective_model: str | None = None


def document_embedding_text(text: str, heading_path: Sequence[str] | None = None) -> str:
    title = " / ".join(part.strip() for part in (heading_path or []) if part.strip()) or "none"
    return f"title: {title} | text: {text}"


def query_embedding_text(query: str) -> str:
    return f"task: question answering | query: {query}"


class GeminiService:
    def __init__(self, settings: Settings | None = None, client: Any | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = client

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

    def _with_retry(self, function, *, action: str):
        """The only transport retry layer for provider calls.

        Retries retryable HTTP statuses, connection errors and (once) timeouts,
        with exponential backoff, jitter and ``Retry-After`` for quota errors.
        """

        attempts = max(0, self.settings.gemini_max_retries) + 1
        timeouts = 0
        for attempt in range(attempts):
            try:
                return function()
            except ApiProblem:
                raise
            except Exception as exc:
                timed_out = self._is_timeout(exc)
                timeouts += int(timed_out)
                retryable = (
                    self._status(exc) in RETRYABLE_STATUS_CODES
                    or self._is_connection_error(exc)
                    or (timed_out and timeouts <= MAX_TIMEOUT_RETRIES)
                )
                if not retryable or attempt + 1 >= attempts:
                    raise ApiProblem(503, f"gemini_{action}_failed", f"Gemini {action} failed.") from exc
                time.sleep(self._retry_delay(exc, attempt))
        raise ApiProblem(503, f"gemini_{action}_failed", f"Gemini {action} failed.")

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

        def call():
            config: dict[str, Any] = {"output_dimensionality": dimensions}
            return self.client.models.embed_content(model=model, contents=contents, config=config)

        response = self._with_retry(call, action="embedding")
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
        def call():
            return self.client.models.count_tokens(model=model, contents=contents)

        try:
            response = self._with_retry(call, action="token_count")
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
        function,
        *,
        action: str,
        error_code: str,
        error_message: str,
    ) -> tuple[Any, Any]:
        for attempt in range(STRUCTURED_OUTPUT_ATTEMPTS):
            response = self._with_retry(function, action=action)
            try:
                return json.loads(self._response_text(response)), response
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
        raise ApiProblem(503, error_code, error_message)

    def generate_json(self, prompt: str, config: dict[str, Any] | None = None) -> tuple[dict[str, Any], GeminiCallMetadata]:
        model = self.settings.gemini_generation_model
        request_config = {
            "response_mime_type": "application/json",
            "response_json_schema": GENERATION_RESPONSE_SCHEMA,
            **(config or {}),
        }

        def call():
            return self.client.models.generate_content(
                model=model,
                contents=prompt,
                config=request_config,
            )

        value, response = self._structured_json(
            call,
            action="generation",
            error_code="gemini_invalid_json",
            error_message="Gemini returned invalid structured output.",
        )
        if not isinstance(value, dict):
            raise ApiProblem(503, "gemini_invalid_json", "Gemini returned invalid structured output.")
        return value, GeminiCallMetadata(configured_model=model, effective_model=self._effective_model(response, model))

    def rerank(self, prompt: str) -> tuple[list[str], GeminiCallMetadata]:
        model = self.settings.gemini_rerank_model
        request_config = {
            "response_mime_type": "application/json",
            "response_json_schema": RERANK_RESPONSE_SCHEMA,
        }

        def call():
            return self.client.models.generate_content(model=model, contents=prompt, config=request_config)

        value, response = self._structured_json(
            call,
            action="rerank",
            error_code="gemini_invalid_rerank",
            error_message="Gemini returned invalid reranking output.",
        )
        ids = value.get("orderedCandidateIds") if isinstance(value, dict) else value
        if not isinstance(ids, list) or not all(isinstance(item, str) for item in ids):
            raise ApiProblem(503, "gemini_invalid_rerank", "Gemini returned invalid reranking output.")
        return ids, GeminiCallMetadata(configured_model=model, effective_model=self._effective_model(response, model))

    def judge(self, prompt: str) -> tuple[dict[str, Any], GeminiCallMetadata]:
        model = self.settings.gemini_judge_model
        request_config = {
            "response_mime_type": "application/json",
            "response_json_schema": JUDGE_RESPONSE_SCHEMA,
            # Scores should vary with the answer, not with sampling.
            "temperature": 0.0,
        }

        def call():
            return self.client.models.generate_content(model=model, contents=prompt, config=request_config)

        value, response = self._structured_json(
            call,
            action="judge",
            error_code="gemini_invalid_judge",
            error_message="Gemini returned invalid judge output.",
        )
        if not isinstance(value, dict):
            raise ApiProblem(503, "gemini_invalid_judge", "Gemini returned invalid judge output.")
        return value, GeminiCallMetadata(configured_model=model, effective_model=self._effective_model(response, model))
