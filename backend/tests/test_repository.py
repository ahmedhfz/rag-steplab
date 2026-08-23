from datetime import timedelta
from types import SimpleNamespace

from app.chunking import CHUNKER_VERSION, TOKENIZER_VERSION, config_hash, effective_config
from app.repository import InMemoryRepository, now_utc


def _chunk_draft():
    return SimpleNamespace(
        ordinal=0,
        text="Grounded source text",
        page_numbers=[1],
        source_element_ids=["element-1"],
        heading_path=[],
        token_count=3,
        character_count=20,
    )


def _claim_chunk(repository: InMemoryRepository, document_id: str, parse_run_id: str, config: dict):
    return repository.claim_chunk_run(
        document_id,
        parse_run_id,
        "fixed_token",
        config,
        config_hash(config),
        TOKENIZER_VERSION,
        CHUNKER_VERSION,
    )


def test_inmemory_artifact_terminal_timing_is_server_observed():
    repository = InMemoryRepository()
    document = repository.create_document(
        {"file_name": "lesson.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "rag-documents",
        "lesson.pdf",
        "timing-sha",
    )
    parse = repository.create_parse_run(document["id"], parser_version="test")
    config = effective_config({"chunk_size_tokens": 64, "overlap_tokens": 8})

    chunk_claim, claimed = _claim_chunk(repository, document["id"], parse["id"], config)
    assert claimed is True
    repository.chunk_runs[chunk_claim["id"]]["started_at"] = now_utc() - timedelta(seconds=1)
    chunk = repository.complete_chunk_run(chunk_claim["id"], [_chunk_draft()])
    assert chunk["duration_ms"] >= 1000

    embedding_claim, claimed = repository.claim_embedding_run(document["id"], chunk["id"], "gemini-embedding-2", 768, "format-v1")
    assert claimed is True
    repository.embedding_runs[embedding_claim["id"]]["started_at"] = now_utc() - timedelta(seconds=1)
    embedding = repository.complete_embedding_run(embedding_claim["id"], [], effective_model="gemini-embedding-2")
    assert embedding["duration_ms"] >= 1000

    failed_chunk_claim, claimed = _claim_chunk(repository, document["id"], parse["id"], {**config, "chunk_size_tokens": 65})
    assert claimed is True
    repository.chunk_runs[failed_chunk_claim["id"]]["started_at"] = now_utc() - timedelta(seconds=1)
    failed_chunk = repository.fail_chunk_run(failed_chunk_claim["id"], "chunk_failed", "test")
    assert failed_chunk["duration_ms"] >= 1000

    failed_embedding_claim, claimed = repository.claim_embedding_run(document["id"], failed_chunk_claim["id"], "gemini-embedding-2", 768, "format-v1")
    assert claimed is True
    repository.embedding_runs[failed_embedding_claim["id"]]["started_at"] = now_utc() - timedelta(seconds=1)
    failed_embedding = repository.fail_embedding_run(failed_embedding_claim["id"], "embedding_failed", "test")
    assert failed_embedding["duration_ms"] >= 1000


def test_pipeline_run_numbers_are_monotonic_after_history_deletion():
    repository = InMemoryRepository()
    document = repository.create_document(
        {"file_name": "numbers.pdf", "media_type": "application/pdf", "size_bytes": 1},
        "rag-documents", "numbers.pdf", "numbers-sha",
    )
    first = repository.create_parse_run(document["id"], parser_version="test")
    repository.fail_parse(first["id"], "test", "test")
    second = repository.create_parse_run(document["id"], parser_version="test")
    repository.fail_parse(second["id"], "test", "test")
    del repository.parses[second["id"]]
    third = repository.create_parse_run(document["id"], parser_version="test")

    assert [first["run_number"], second["run_number"], third["run_number"]] == [1, 2, 3]
