from __future__ import annotations

from types import SimpleNamespace

from app.config import Settings
from app.gemini import GeminiService, document_embedding_text, query_embedding_text


def test_embedding_two_documents_uses_two_one_to_one_requests():
    calls: list[str] = []

    class Models:
        def embed_content(self, *, model, contents, config):
            calls.append(contents)
            return SimpleNamespace(
                embeddings=[SimpleNamespace(values=[1.0, 2.0, 3.0])],
                model_version="gemini-embedding-2",
            )

    service = GeminiService(
        Settings(gemini_embedding_dimensions=3),
        client=SimpleNamespace(models=Models()),
    )
    values, metadata = service.embed_documents(["first", "second"])

    assert calls == ["first", "second"]
    assert values == [[1.0, 2.0, 3.0], [1.0, 2.0, 3.0]]
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
