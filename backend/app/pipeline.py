"""RAG StepLab domain orchestration.

This module intentionally keeps each RAG operation explicit.  The database
stores parse/chunk/embedding artifacts separately; retrieval through
generation is persisted as visible stage objects in one experiment row.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
import tempfile
import time
from pathlib import Path
from typing import Any

from .chunking import TOKENIZER, TOKENIZER_VERSION, chunk_structured
from .config import Settings, get_settings
from .errors import ApiProblem
from .gemini import EMBEDDING_FORMAT_VERSION, GeminiService, document_embedding_text
from .repository import (
    Repository,
    get_repository,
    new_id,
    now_utc,
)
from .schemas import (
    ChunkRunRequest,
    EvaluationDatasetRequest,
    EvaluationRunRequest,
    ExperimentCreateRequest,
    ParseResponse,
)
from .storage import get_storage
from .telemetry import measure_resource_usage


logger = logging.getLogger(__name__)


def _safe_model_dump(value: Any) -> dict[str, Any]:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=False)
    return dict(value)


def _require_write(repository: Repository, settings: Settings) -> None:
    if not settings.write_enabled:
        raise ApiProblem(503, "writes_disabled", "Pipeline writes are temporarily disabled.")
    if settings.app_env in {"production", "staging"} and not repository.persistent:
        raise ApiProblem(503, "database_not_configured", "Persistent database storage is not configured.")
    if settings.app_env in {"production", "staging"} and (
        not settings.supabase_url or not settings.supabase_secret_key
    ):
        raise ApiProblem(503, "storage_not_configured", "Private document storage is not configured.")
    if settings.app_env in {"production", "staging"} and TOKENIZER_VERSION != "local_cl100k_v1":
        raise ApiProblem(503, "tokenizer_not_configured", "The deterministic cl100k tokenizer is not available.")


def _document_or_404(repository: Repository, document_id: str) -> dict[str, Any]:
    document = repository.get_document_row(document_id)
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    return document


def _parse_or_404(repository: Repository, parse_run_id: str) -> dict[str, Any]:
    row = repository.get_parse_row(parse_run_id)
    if row is None:
        raise ApiProblem(404, "parse_run_not_found", "The parse run was not found.")
    if row.get("status") != "completed":
        raise ApiProblem(409, "parse_run_incomplete", "The parse run is not complete.")
    return row


def _chunk_or_404(repository: Repository, chunk_run_id: str) -> dict[str, Any]:
    row = repository.get_chunk_row(chunk_run_id)
    if row is None:
        raise ApiProblem(404, "chunk_run_not_found", "The chunk run was not found.")
    if row.get("status") != "completed":
        raise ApiProblem(409, "chunk_run_incomplete", "The chunk run is not complete.")
    return row


def _embedding_or_404(repository: Repository, embedding_run_id: str) -> dict[str, Any]:
    row = repository.get_embedding_row(embedding_run_id)
    if row is None:
        raise ApiProblem(404, "embedding_run_not_found", "The embedding run was not found.")
    if row.get("status") != "completed":
        raise ApiProblem(409, "embedding_run_incomplete", "The embedding run is not complete.")
    return row


def parse_upload(
    content: bytes,
    file_name: str,
    parsed: ParseResponse,
    *,
    repository: Repository | None = None,
    settings: Settings | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    repository = repository or get_repository()
    settings = settings or get_settings()
    _require_write(repository, settings)
    digest = hashlib.sha256(content).hexdigest()
    storage_path = f"{new_id()}/{digest}.pdf"
    storage = get_storage()
    storage.upload_pdf(storage_path, content)
    metadata = {
        "file_name": file_name,
        "media_type": "application/pdf",
        "size_bytes": len(content),
        "page_count": parsed.document.page_count,
    }
    document: dict[str, Any] | None = None
    try:
        document = repository.create_document(
            metadata,
            settings.supabase_storage_bucket,
            storage_path,
            digest,
        )
        parse = repository.save_parse(document["id"], parsed)
    except Exception:
        if document is not None:
            repository.delete_document(document["id"])
        storage.remove(storage_path)
        raise
    if parse is None:
        storage.remove(storage_path)
        raise ApiProblem(500, "persistence_failed", "The parsed document could not be persisted.")
    return document, parse


def queue_parse_upload(
    content: bytes,
    file_name: str,
    *,
    repository: Repository | None = None,
    settings: Settings | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Persist the PDF and a queued parse run without doing CPU-heavy work."""

    repository = repository or get_repository()
    settings = settings or get_settings()
    _require_write(repository, settings)
    digest = hashlib.sha256(content).hexdigest()
    storage_path = f"{new_id()}/{digest}.pdf"
    storage = get_storage()
    storage.upload_pdf(storage_path, content)
    metadata = {
        "file_name": file_name,
        "media_type": "application/pdf",
        "size_bytes": len(content),
        "page_count": 0,
    }
    document: dict[str, Any] | None = None
    try:
        document = repository.create_document(
            metadata,
            settings.supabase_storage_bucket,
            storage_path,
            digest,
        )
        parse = repository.create_parse_run(
            document["id"],
            parser_version=settings.docling_parser_version,
        )
    except Exception:
        if document is not None:
            repository.delete_document(document["id"])
        storage.remove(storage_path)
        raise
    if parse is None:
        storage.remove(storage_path)
        raise ApiProblem(500, "persistence_failed", "The parse run could not be queued.")
    return document, parse


def queue_reparse_document(
    document_id: str,
    *,
    repository: Repository | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Create a new parse run while preserving the current active lineage."""

    repository = repository or get_repository()
    settings = get_settings()
    _require_write(repository, settings)
    document = _document_or_404(repository, document_id)
    parse = repository.create_parse_run(
        document_id,
        parser_version=settings.docling_parser_version,
    )
    if parse is None:
        raise ApiProblem(500, "persistence_failed", "The parse run could not be queued.")
    return document, parse


def run_parse_worker(
    parse_run_id: str,
    *,
    repository: Repository | None = None,
) -> dict[str, Any] | None:
    """Run one queued parse and persist one terminal lifecycle transition.

    This function is the only place where the full Docling converter is called
    by the Modal worker. It never falls back to the old text-cell heuristic.
    """

    repository = repository or get_repository()
    settings = get_settings()
    row = repository.get_parse_row(parse_run_id)
    if row is None:
        return None
    if row.get("status") in {"completed", "failed", "interrupted"}:
        return row
    running = repository.mark_parse_running(parse_run_id)
    if running is None or running.get("status") in {"completed", "failed", "interrupted"}:
        return running
    started = time.perf_counter()
    queue_duration_ms = None
    if running.get("created_at") is not None and running.get("started_at") is not None:
        queue_duration_ms = max(0, int((running["started_at"] - running["created_at"]).total_seconds() * 1000))
    logger.info(
        "parse_worker_started parse_run_id=%s parser_version=%s queue_duration_ms=%s",
        parse_run_id,
        settings.docling_parser_version,
        queue_duration_ms,
    )
    try:
        document = _document_or_404(repository, running["document_id"])
        storage_started = time.perf_counter()
        content = get_storage().download(document["storage_path"])
        storage_download_ms = max(0, int((time.perf_counter() - storage_started) * 1000))
        temporary_path: Path | None = None
        try:
            from .parser import parse_pdf_file

            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temporary_file:
                temporary_file.write(content)
                temporary_path = Path(temporary_file.name)
            with measure_resource_usage() as measurement:
                parsed = parse_pdf_file(temporary_path, document["file_name"], len(content))
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
        duration_ms = int(measurement.get("elapsedMs") or (time.perf_counter() - started) * 1000)
        execution_metadata = {
            **(parsed.run_metadata or {}),
            "worker": "modal",
            "queueDurationMs": queue_duration_ms,
            "storageDownloadMs": storage_download_ms,
            "measurement": measurement,
        }
        completed = repository.complete_parse(
            parse_run_id,
            parsed,
            parser_version=settings.docling_parser_version,
            execution_metadata=execution_metadata,
            duration_ms=duration_ms,
        )
        logger.info(
            "parse_worker_completed parse_run_id=%s parser_version=%s duration_ms=%s peak_rss_mb=%s start_mode=%s",
            parse_run_id,
            settings.docling_parser_version,
            duration_ms,
            measurement.get("peakRssMb"),
            execution_metadata.get("workerStartMode"),
        )
        return completed
    except ApiProblem as exc:
        duration_ms = max(0, int((time.perf_counter() - started) * 1000))
        failed = repository.fail_parse(
            parse_run_id,
            exc.code,
            exc.message,
            status="failed",
            duration_ms=duration_ms,
        )
        logger.warning(
            "parse_worker_failed parse_run_id=%s parser_version=%s duration_ms=%s error_code=%s cause_type=%s cause=%s",
            parse_run_id,
            settings.docling_parser_version,
            duration_ms,
            exc.code,
            type(exc.__cause__).__name__ if exc.__cause__ is not None else None,
            str(exc.__cause__)[:500] if exc.__cause__ is not None else None,
        )
        return failed
    except Exception as exc:
        duration_ms = max(0, int((time.perf_counter() - started) * 1000))
        failed = repository.fail_parse(
            parse_run_id,
            "parse_worker_error",
            "The parse worker could not complete this document.",
            status="failed",
            duration_ms=duration_ms,
        )
        logger.error(
            "parse_worker_failed parse_run_id=%s parser_version=%s duration_ms=%s error_code=parse_worker_error exception_type=%s",
            parse_run_id,
            settings.docling_parser_version,
            duration_ms,
            type(exc).__name__,
        )
        return failed


def reparse_document(document_id: str, *, repository: Repository | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    repository = repository or get_repository()
    settings = get_settings()
    _require_write(repository, settings)
    document = _document_or_404(repository, document_id)
    content = get_storage().download(document["storage_path"])
    temporary_path: Path | None = None
    try:
        from .parser import parse_pdf_file

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as temporary_file:
            temporary_file.write(content)
            temporary_path = Path(temporary_file.name)
        parsed = parse_pdf_file(temporary_path, document["file_name"], len(content))
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
    parse = repository.save_parse(document_id, parsed)
    if parse is None:
        raise ApiProblem(500, "persistence_failed", "The parse run could not be persisted.")
    return repository.get_document_row(document_id) or document, parse


def create_chunk_run(document_id: str, request: ChunkRunRequest, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    _require_write(repository, get_settings())
    document = _document_or_404(repository, document_id)
    parse_id = request.parse_run_id or document.get("active_parse_run_id")
    if not parse_id:
        raise ApiProblem(409, "parse_required", "Parse the document before chunking it.")
    parse = _parse_or_404(repository, parse_id)
    if parse["document_id"] != document_id:
        raise ApiProblem(409, "lineage_mismatch", "The parse run belongs to another document.")
    if parse_id != document.get("active_parse_run_id"):
        raise ApiProblem(409, "stale_lineage", "The selected parse run is no longer active.")
    try:
        drafts = chunk_structured(parse["structured"], request.strategy, request.config)
    except ValueError as exc:
        raise ApiProblem(422, "chunk_config_invalid", str(exc)) from exc
    return repository.save_chunk_run(document_id, parse_id, request, drafts)


def create_embedding_run(document_id: str, chunk_run_id: str | None, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    settings = get_settings()
    _require_write(repository, settings)
    document = _document_or_404(repository, document_id)
    chunk_id = chunk_run_id or document.get("active_chunk_run_id")
    if not chunk_id:
        raise ApiProblem(409, "chunks_required", "Create chunks before embedding them.")
    chunk_run = _chunk_or_404(repository, chunk_id)
    if chunk_run["document_id"] != document_id:
        raise ApiProblem(409, "lineage_mismatch", "The chunk run belongs to another document.")
    if chunk_id != document.get("active_chunk_run_id") or chunk_run["parse_run_id"] != document.get("active_parse_run_id"):
        raise ApiProblem(409, "stale_lineage", "The selected chunk run is no longer active.")
    chunks = repository.get_chunks_for_embedding(chunk_id)
    service = GeminiService(settings)
    inputs = [document_embedding_text(chunk["text"], chunk.get("heading_path")) for chunk in chunks]
    vectors: list[list[float]] = []
    if inputs:
        for offset in range(0, len(inputs), 16):
            batch, _ = service.embed_documents(inputs[offset : offset + 16])
            vectors.extend(batch)
    input_hashes = {
        chunk["id"]: hashlib.sha256(input_text.encode("utf-8")).hexdigest()
        for chunk, input_text in zip(chunks, inputs)
    }
    return repository.save_embedding_run(
        document_id,
        chunk_id,
        settings.gemini_embedding_model,
        settings.gemini_embedding_dimensions,
        EMBEDDING_FORMAT_VERSION,
        [(chunk["id"], vector) for chunk, vector in zip(chunks, vectors)],
        input_hashes,
    )


def _dot_cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    denominator = math.sqrt(sum(value * value for value in left)) * math.sqrt(sum(value * value for value in right))
    return sum(a * b for a, b in zip(left, right)) / denominator if denominator else 0.0


def _keyword_score(query: str, text: str) -> float:
    terms = [term.lower() for term in re.findall(r"[\wÀ-ÿ]+", query) if len(term) > 1]
    if not terms:
        return 0.0
    haystack = text.lower()
    return sum(haystack.count(term) for term in terms) / len(terms)


def _candidate_view(chunk: dict[str, Any], *, dense: float | None = None, keyword: float | None = None) -> dict[str, Any]:
    return {
        "chunkId": chunk["id"],
        "documentId": chunk.get("document_id"),
        "ordinal": chunk["ordinal"],
        "text": chunk["text"],
        "pageNumbers": chunk.get("page_numbers", []),
        "sourceElementIds": chunk.get("source_element_ids", []),
        "headingPath": chunk.get("heading_path", []),
        "denseScore": dense,
        "keywordScore": keyword,
    }


def _assemble_retrieval(
    mode: str,
    top_k: int,
    dense_ranked: list[dict[str, Any]],
    keyword_ranked: list[dict[str, Any]],
) -> dict[str, Any]:
    dense_ranked = [_candidate_view(item, dense=item.get("denseScore")) for item in dense_ranked]
    keyword_ranked = [_candidate_view(item, keyword=item.get("keywordScore")) for item in keyword_ranked]
    dense_by_id = {item["chunkId"]: item for item in dense_ranked}
    keyword_by_id = {item["chunkId"]: item for item in keyword_ranked}
    dense_positions = {item["chunkId"]: index + 1 for index, item in enumerate(dense_ranked)}
    keyword_positions = {item["chunkId"]: index + 1 for index, item in enumerate(keyword_ranked)}
    ids = set(dense_by_id) | set(keyword_by_id)
    candidate_k = min(200, max(top_k * 4, 20))
    if mode == "dense":
        ordered_ids = [item["chunkId"] for item in dense_ranked[:candidate_k]]
    elif mode == "keyword":
        ordered_ids = [item["chunkId"] for item in keyword_ranked[:candidate_k]]
    else:
        def rrf(chunk_id: str) -> float:
            return (1 / (60 + dense_positions[chunk_id]) if chunk_id in dense_positions else 0) + (1 / (60 + keyword_positions[chunk_id]) if chunk_id in keyword_positions else 0)

        ordered_ids = sorted(ids, key=lambda chunk_id: (-rrf(chunk_id), min(dense_positions.get(chunk_id, 100000), keyword_positions.get(chunk_id, 100000)), chunk_id))[:candidate_k]
    values: list[dict[str, Any]] = []
    for rank, chunk_id in enumerate(ordered_ids[:top_k], start=1):
        base = dense_by_id.get(chunk_id) or keyword_by_id.get(chunk_id)
        assert base is not None
        dense_rank = dense_positions.get(chunk_id)
        keyword_rank = keyword_positions.get(chunk_id)
        fused = (1 / (60 + dense_rank) if dense_rank else 0) + (1 / (60 + keyword_rank) if keyword_rank else 0)
        values.append({
            **base,
            "denseRank": dense_rank,
            "keywordRank": keyword_rank,
            "rrfScore": fused if mode == "hybrid" else None,
            "rank": rank,
        })
    return {
        "status": "completed",
        "mode": mode,
        "topK": top_k,
        "candidateK": candidate_k,
        "rrfK": 60 if mode == "hybrid" else None,
        "results": values,
    }


def _retrieval_stage(
    query: str,
    mode: str,
    top_k: int,
    chunks: list[dict[str, Any]],
    query_vector: list[float] | None,
) -> dict[str, Any]:
    dense_ranked: list[dict[str, Any]] = []
    keyword_ranked: list[dict[str, Any]] = []
    if mode in {"dense", "hybrid"}:
        if query_vector is None:
            raise ApiProblem(409, "embedding_required", "Dense retrieval requires an embedding run.")
        dense_ranked = sorted(
            [{**chunk, "denseScore": _dot_cosine(query_vector, chunk.get("embedding") or [])} for chunk in chunks],
            key=lambda item: (-float(item["denseScore"] or 0), item["ordinal"], item["id"]),
        )
    if mode in {"keyword", "hybrid"}:
        keyword_ranked = sorted(
            [{**chunk, "keywordScore": _keyword_score(query, chunk["text"])} for chunk in chunks if _keyword_score(query, chunk["text"]) > 0],
            key=lambda item: (-float(item["keywordScore"] or 0), item["ordinal"], item["id"]),
        )
    return _assemble_retrieval(mode, top_k, dense_ranked[: min(200, max(top_k * 4, 20))], keyword_ranked[: min(200, max(top_k * 4, 20))])


def _rerank_stage(retrieval: dict[str, Any], service: GeminiService, candidate_count: int) -> dict[str, Any]:
    candidates = retrieval.get("results", [])[:candidate_count]
    prompt = (
        "Return JSON with orderedCandidateIds. Order only the supplied candidate IDs by relevance. "
        "Do not invent IDs.\n" + "\n".join(f"{item['chunkId']}: {item['text'][:1200]}" for item in candidates)
    )
    ordered, metadata = service.rerank(prompt)
    allowed = [item["chunkId"] for item in candidates]
    if len(set(ordered)) != len(ordered) or any(identifier not in set(allowed) for identifier in ordered):
        raise ApiProblem(503, "invalid_rerank", "The reranker returned an invalid candidate list.")
    ordered = ordered + [identifier for identifier in allowed if identifier not in ordered]
    by_id = {item["chunkId"]: item for item in candidates}
    results = [{**by_id[identifier], "retrievalRank": by_id[identifier].get("rank"), "rank": index + 1, "rerankScore": len(ordered) - index} for index, identifier in enumerate(ordered)]
    return {
        "status": "completed",
        "method": "gemini_listwise_v1",
        "configuredModel": metadata.configured_model,
        "effectiveModel": metadata.effective_model,
        "results": results,
    }


def _context_stage(candidates: list[dict[str, Any]], budget: int) -> dict[str, Any]:
    selected: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    used = 0
    seen: set[str] = set()
    for item in candidates:
        text = item["text"]
        token_count = TOKENIZER.count(text)
        if text in seen:
            excluded.append({**item, "reason": "duplicate_text", "localTokenCount": token_count})
            continue
        seen.add(text)
        if used + token_count > budget:
            excluded.append({**item, "reason": "budget_exceeded", "localTokenCount": token_count})
            continue
        citation_id = f"C{len(selected) + 1}"
        selected.append({"citationId": citation_id, **item, "localTokenCount": token_count})
        used += token_count
    formatted = "\n\n".join(f"[{item['citationId']}] {item['text']}" for item in selected)
    return {
        "status": "completed",
        "tokenBudget": budget,
        "localTokenCount": used,
        "selected": selected,
        "excluded": excluded,
        "formattedContext": formatted,
    }


def _generation_stage(query: str, context: dict[str, Any], config: Any, service: GeminiService) -> dict[str, Any]:
    selected = context.get("selected", [])
    if not selected:
        return {
            "status": "completed",
            "insufficientContext": True,
            "answer": "Yeterli bağlam bulunamadı.",
            "claims": [],
            "citations": [],
            "configuredModel": service.settings.gemini_generation_model,
            "effectiveModel": None,
        }
    prompt = (
        "Answer only from the supplied context. If it is insufficient, set insufficientContext=true. "
        "Return JSON: {insufficientContext:boolean,answer:string,claims:[{text:string,citationIds:string[]}]}.\n"
        f"Question: {query}\nContext:\n{context['formattedContext']}"
    )
    allowed = {item["citationId"]: item for item in selected}
    attempts = max(0, service.settings.gemini_max_retries) + 1
    for attempt in range(attempts):
        payload, metadata = service.generate_json(
            prompt,
            {
                "temperature": config.temperature,
                "max_output_tokens": config.max_output_tokens,
            },
        )
        try:
            insufficient = bool(payload.get("insufficientContext", False))
            answer = payload.get("answer")
            claims = payload.get("claims", [])
            if not isinstance(answer, str) or (not insufficient and not answer.strip()):
                raise ApiProblem(503, "generation_invalid", "The generated answer format is invalid.")
            if not isinstance(claims, list) or (not insufficient and not claims):
                raise ApiProblem(503, "citation_invalid", "The generated claims format is invalid.")
            citations: list[dict[str, Any]] = []
            for claim in claims:
                if not isinstance(claim, dict):
                    raise ApiProblem(503, "citation_invalid", "The generated citation format is invalid.")
                ids = claim.get("citationIds", [])
                if not isinstance(ids, list) or (not insufficient and not ids) or any(identifier not in allowed for identifier in ids):
                    raise ApiProblem(503, "citation_invalid", "The generated answer referenced an unknown citation.")
                for identifier in ids:
                    source = allowed[identifier]
                    citations.append({
                        "citationId": identifier,
                        "chunkId": source["chunkId"],
                        "documentId": source.get("documentId"),
                        "pageNumbers": source.get("pageNumbers", []),
                        "sourceElementIds": source.get("sourceElementIds", []),
                        "valid": True,
                    })
            break
        except ApiProblem:
            if attempt + 1 >= attempts:
                raise
    return {
        "status": "completed",
        "insufficientContext": insufficient,
        "answer": answer,
        "claims": claims,
        "citations": citations,
        "citationValidity": {"valid": True, "count": len(citations)},
        "configuredModel": metadata.configured_model,
        "effectiveModel": metadata.effective_model,
    }


def _stage_target(target: str) -> list[str]:
    stages = ["retrieval", "reranking", "context", "generation"]
    return stages[: stages.index(target) + 1]


def create_experiment(request: ExperimentCreateRequest, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    settings = get_settings()
    _require_write(repository, settings)
    started_perf = time.perf_counter()
    document = _document_or_404(repository, request.document_id)
    chunk_run_id = request.chunk_run_id or document.get("active_chunk_run_id")
    if not chunk_run_id:
        raise ApiProblem(409, "chunks_required", "Create chunks before running an experiment.")
    chunk_run = _chunk_or_404(repository, chunk_run_id)
    if chunk_run["document_id"] != request.document_id:
        raise ApiProblem(409, "lineage_mismatch", "The chunk run belongs to another document.")
    if chunk_run_id != document.get("active_chunk_run_id") or chunk_run["parse_run_id"] != document.get("active_parse_run_id"):
        raise ApiProblem(409, "stale_lineage", "The selected chunk run is no longer active.")
    embedding_run_id = request.embedding_run_id or document.get("active_embedding_run_id")
    if request.retrieval.mode in {"dense", "hybrid"} and not embedding_run_id:
        raise ApiProblem(409, "embedding_required", "Dense or hybrid retrieval requires embeddings.")
    if embedding_run_id:
        embedding = _embedding_or_404(repository, embedding_run_id)
        if embedding["chunk_run_id"] != chunk_run_id:
            raise ApiProblem(409, "lineage_mismatch", "The embedding run does not belong to the selected chunks.")
        if embedding_run_id != document.get("active_embedding_run_id"):
            raise ApiProblem(409, "stale_lineage", "The selected embedding run is no longer active.")
    # Persistent retrieval is executed in PostgreSQL; loading every chunk here
    # would defeat the SQL candidate limit and make production retrieval scale
    # with the whole corpus. In-memory storage needs the local rows for tests.
    chunks = [] if repository.persistent else repository.get_chunks_for_embedding(chunk_run_id, embedding_run_id)
    service = GeminiService(settings)
    query_vector = None
    query_embedding_metadata = None
    if request.retrieval.mode in {"dense", "hybrid"}:
        query_vector, query_embedding_metadata = service.embed_query(request.query)
    stage_results: dict[str, Any] = {}
    candidate_k = min(200, max(request.retrieval.top_k * 4, 20))
    if repository.persistent:
        try:
            dense_ranked, keyword_ranked = repository.retrieve_candidates(
                chunk_run_id,
                embedding_run_id,
                request.query,
                query_vector,
                request.retrieval.mode,
                candidate_k,
            )
            retrieval = _assemble_retrieval(request.retrieval.mode, request.retrieval.top_k, dense_ranked, keyword_ranked)
        except ValueError as exc:
            raise ApiProblem(409, "retrieval_config_invalid", str(exc)) from exc
    else:
        retrieval = _retrieval_stage(request.query, request.retrieval.mode, request.retrieval.top_k, chunks, query_vector)
    retrieval["input"] = {"query": request.query, "chunkRunId": chunk_run_id, "embeddingRunId": embedding_run_id}
    retrieval["config"] = {
        "mode": request.retrieval.mode,
        "topK": request.retrieval.top_k,
        "candidateK": candidate_k,
        "ftsConfig": "simple",
        "rrfK": 60,
        "embeddingFormatVersion": "gemini-embedding-2-qa-prefix-v1" if query_embedding_metadata else None,
        "embeddingConfiguredModel": query_embedding_metadata.configured_model if query_embedding_metadata else None,
        "embeddingEffectiveModel": query_embedding_metadata.effective_model if query_embedding_metadata else None,
    }
    retrieval["durationMs"] = max(0, round((time.perf_counter() - started_perf) * 1000))
    stage_results["retrieval"] = retrieval
    if request.target_stage in {"reranking", "context", "generation"}:
        stage_started = time.perf_counter()
        if request.reranking.enabled:
            reranking = _rerank_stage(retrieval, service, request.reranking.candidate_count)
        else:
            reranking = {"status": "skipped", "reason": "disabled", "results": retrieval["results"]}
        reranking["durationMs"] = max(0, round((time.perf_counter() - stage_started) * 1000))
        reranking["config"] = {"enabled": request.reranking.enabled, "candidateCount": request.reranking.candidate_count}
        stage_results["reranking"] = reranking
    if request.target_stage in {"context", "generation"}:
        stage_started = time.perf_counter()
        candidates = stage_results.get("reranking", {}).get("results", retrieval["results"])
        stage_results["context"] = _context_stage(candidates, request.context.token_budget)
        stage_results["context"]["durationMs"] = max(0, round((time.perf_counter() - stage_started) * 1000))
        stage_results["context"]["config"] = {"tokenBudget": request.context.token_budget}
    if request.target_stage == "generation":
        stage_started = time.perf_counter()
        stage_results["generation"] = _generation_stage(request.query, stage_results["context"], request.generation, service)
        stage_results["generation"]["durationMs"] = max(0, round((time.perf_counter() - stage_started) * 1000))
        stage_results["generation"]["config"] = _safe_model_dump(request.generation)
    row = {
        "id": new_id(),
        "document_id": request.document_id,
        "chunk_run_id": chunk_run_id,
        "embedding_run_id": embedding_run_id,
        "query": request.query,
        "target_stage": request.target_stage,
        "config": _safe_model_dump(request),
        "stage_results": stage_results,
        "status": "completed",
        "started_at": now_utc(),
        "completed_at": now_utc(),
        "duration_ms": max(0, round((time.perf_counter() - started_perf) * 1000)),
    }
    return repository.save_experiment(row)


def continue_experiment(experiment_id: str, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    row = repository.get_experiment_row(experiment_id)
    if row is None:
        raise ApiProblem(404, "experiment_not_found", "The experiment was not found.")
    order = ["retrieval", "reranking", "context", "generation"]
    current = order.index(row["target_stage"])
    if current >= len(order) - 1:
        return row
    request_data = row["config"]
    request_data["target_stage"] = order[current + 1]
    request_data["document_id"] = row["document_id"]
    request_data["chunk_run_id"] = row["chunk_run_id"]
    request_data["embedding_run_id"] = row.get("embedding_run_id")
    return create_experiment(ExperimentCreateRequest.model_validate(request_data), repository=repository)


def create_dataset(request: EvaluationDatasetRequest, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    _require_write(repository, get_settings())
    document = _document_or_404(repository, request.document_id)
    parse_id = request.parse_run_id or document.get("active_parse_run_id")
    if not parse_id:
        raise ApiProblem(409, "parse_required", "Parse the document before creating an evaluation dataset.")
    parse = _parse_or_404(repository, parse_id)
    if parse["document_id"] != request.document_id:
        raise ApiProblem(409, "lineage_mismatch", "The parse run belongs to another document.")
    if parse_id != document.get("active_parse_run_id"):
        raise ApiProblem(409, "stale_lineage", "The selected parse run is no longer active.")
    return repository.save_dataset(request, parse_id)


def _evaluation_metrics(results: list[dict[str, Any]]) -> dict[str, Any]:
    if not results:
        return {"caseCount": 0, "hitAtK": 0, "precisionAtK": 0, "recallAtK": 0, "mrr": 0}
    return {
        "caseCount": len(results),
        "hitAtK": sum(item["hitAtK"] for item in results) / len(results),
        "precisionAtK": sum(item["precisionAtK"] for item in results) / len(results),
        "recallAtK": sum(item["recallAtK"] for item in results) / len(results),
        "mrr": sum(item["mrr"] for item in results) / len(results),
        "citationValidity": sum(item.get("citationValidity", 0) for item in results) / len(results),
        "groundedness": sum(item.get("groundedness", 0) for item in results) / len(results),
    }


def _deterministic_groundedness(experiment: dict[str, Any]) -> dict[str, Any]:
    generation = experiment.get("stage_results", {}).get("generation", {})
    context = experiment.get("stage_results", {}).get("context", {})
    selected = {item.get("citationId"): item.get("text", "") for item in context.get("selected", [])}
    claims = generation.get("claims", [])
    if not claims:
        return {"method": "citation_token_overlap_v1", "score": 0.0, "claimResults": []}
    claim_results: list[dict[str, Any]] = []
    for claim in claims:
        claim_text = str(claim.get("text", ""))
        tokens = {token.lower() for token in re.findall(r"[\wÀ-ÿ]+", claim_text) if len(token) > 2}
        cited_text = " ".join(selected.get(identifier, "") for identifier in claim.get("citationIds", []))
        source_tokens = {token.lower() for token in re.findall(r"[\wÀ-ÿ]+", cited_text) if len(token) > 2}
        overlap = len(tokens & source_tokens) / max(1, len(tokens))
        claim_results.append({"text": claim_text, "supported": overlap >= 0.35, "tokenOverlap": overlap})
    return {
        "method": "citation_token_overlap_v1",
        "score": sum(item["tokenOverlap"] for item in claim_results) / len(claim_results),
        "claimResults": claim_results,
    }


def create_evaluation(request: EvaluationRunRequest, *, repository: Repository | None = None) -> dict[str, Any]:
    repository = repository or get_repository()
    _require_write(repository, get_settings())
    dataset = repository.get_dataset_row(request.dataset_id)
    if dataset is None:
        raise ApiProblem(404, "dataset_not_found", "The evaluation dataset was not found.")
    document = _document_or_404(repository, dataset["document_id"])
    if dataset["parse_run_id"] != document.get("active_parse_run_id"):
        raise ApiProblem(409, "stale_lineage", "The evaluation dataset belongs to an inactive parse run.")
    judge_service = GeminiService(get_settings()) if request.judge else None
    case_results: list[dict[str, Any]] = []
    child_ids: list[str] = []
    for case in dataset["cases"][:10]:
        exp_request = ExperimentCreateRequest(
            document_id=dataset["document_id"],
            chunk_run_id=request.chunk_run_id,
            embedding_run_id=request.embedding_run_id,
            query=case["question"],
            target_stage="generation",
            retrieval=request.retrieval,
            reranking=request.reranking,
            context=request.context,
            generation=request.generation,
        )
        experiment = create_experiment(exp_request, repository=repository)
        child_ids.append(experiment["id"])
        retrieval_results = experiment["stage_results"].get("retrieval", {}).get("results", [])
        expected = set(case.get("relevant_element_ids", []))
        relevant_ranks = [
            index + 1
            for index, result in enumerate(retrieval_results)
            if expected.intersection(result.get("sourceElementIds", []))
        ]
        denominator = len(expected) or 1
        citation_validity = 1.0 if experiment["stage_results"].get("generation", {}).get("citationValidity", {}).get("valid") else 0.0
        groundedness = _deterministic_groundedness(experiment)
        if request.judge and judge_service is not None:
            generation = experiment["stage_results"].get("generation", {})
            judge_prompt = (
                "Evaluate whether each claim is supported by its cited context. Return JSON with "
                "groundedness (0..1) and claimResults.\n"
                f"Claims: {generation.get('claims', [])}\nContext: {experiment['stage_results'].get('context', {}).get('selected', [])}"
            )
            judge_value, judge_metadata = judge_service.judge(judge_prompt)
            score = float(judge_value.get("groundedness", judge_value.get("score", -1)))
            if score < 0 or score > 1:
                raise ApiProblem(503, "invalid_groundedness", "The groundedness judge returned an invalid score.")
            groundedness = {
                "method": "gemini_claim_support_v1",
                "score": score,
                "claimResults": judge_value.get("claimResults", []),
                "configuredModel": judge_metadata.configured_model,
                "effectiveModel": judge_metadata.effective_model,
                "promptVersion": "groundedness-judge-v1",
            }
        case_results.append({
            "question": case["question"],
            "hitAtK": 1.0 if relevant_ranks else 0.0,
            "precisionAtK": len(relevant_ranks) / max(1, len(retrieval_results)),
            "recallAtK": len({source for result in retrieval_results for source in set(result.get("sourceElementIds", [])) & expected}) / denominator,
            "mrr": 1 / relevant_ranks[0] if relevant_ranks else 0.0,
            "citationValidity": citation_validity,
            "groundedness": groundedness["score"],
            "groundednessDetail": groundedness,
            "experimentId": experiment["id"],
        })
    aggregate = _evaluation_metrics(case_results)
    aggregate["judgeModel"] = get_settings().gemini_judge_model if request.judge else None
    row = {
        "id": new_id(),
        "dataset_id": request.dataset_id,
        "config": _safe_model_dump(request),
        "child_experiment_ids": child_ids,
        "results": {"aggregate": aggregate, "caseResults": case_results},
        "status": "completed",
        "started_at": now_utc(),
        "completed_at": now_utc(),
        "duration_ms": 0,
    }
    return repository.save_evaluation(row)
