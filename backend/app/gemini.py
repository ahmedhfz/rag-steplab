"""Small, explicit Gemini adapter used by embedding and experiment stages."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Sequence

from .config import Settings, get_settings
from .errors import ApiProblem


EMBEDDING_FORMAT_VERSION = "gemini-embedding-2-qa-prefix-v1"


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

    def _with_retry(self, function, *, action: str):
        attempts = max(0, self.settings.gemini_max_retries) + 1
        for attempt in range(attempts):
            try:
                return function()
            except ApiProblem:
                raise
            except Exception as exc:
                status = getattr(exc, "status_code", getattr(exc, "code", None))
                retryable = status in {408, 429, 500, 502, 503, 504, "429", "500", "502", "503", "504"}
                if not retryable or attempt + 1 >= attempts:
                    raise ApiProblem(503, f"gemini_{action}_failed", f"Gemini {action} failed.") from exc
                time.sleep(min(2.0, 0.2 * (2**attempt)))
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

    def _structured_json(
        self,
        function,
        *,
        action: str,
        error_code: str,
        error_message: str,
    ) -> tuple[Any, Any]:
        attempts = max(0, self.settings.gemini_max_retries) + 1
        for attempt in range(attempts):
            response = self._with_retry(function, action=action)
            try:
                return json.loads(self._response_text(response)), response
            except (TypeError, ValueError) as exc:
                if attempt + 1 >= attempts:
                    raise ApiProblem(503, error_code, error_message) from exc
                time.sleep(min(2.0, 0.2 * (2**attempt)))
        raise ApiProblem(503, error_code, error_message)

    def generate_json(self, prompt: str, config: dict[str, Any] | None = None) -> tuple[dict[str, Any], GeminiCallMetadata]:
        model = self.settings.gemini_generation_model
        request_config = {"response_mime_type": "application/json", **(config or {})}

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
        request_config = {"response_mime_type": "application/json"}

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
        request_config = {"response_mime_type": "application/json"}

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
