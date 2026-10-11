"""Single definition of a document's "in use" lineage.

The saved document pipeline is the canonical lineage identity.  The
``documents.active_*`` pointers are only a convenience default for levels the
pipeline has not selected yet, and they are accepted only when they are a
completed child of the already-resolved parent.  The browser resolver
(``resolveLineageSelection``) follows the same order, so the API's
``historicalLineage`` flag and the UI's "In use" marker cannot disagree.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

DEFAULT_PIPELINE_NAME = "Default Pipeline"

Lookup = Callable[[str], dict[str, Any] | None]


def select_pipeline(
    pipelines: Iterable[dict[str, Any]],
    pipeline_id: str | None,
) -> dict[str, Any] | None:
    """Return the requested pipeline, else the default (or first) pipeline.

    An explicitly requested but unknown pipeline returns ``None`` so callers can
    raise a deterministic 404 instead of silently using another lineage.
    """

    rows = list(pipelines)
    if pipeline_id:
        return next((row for row in rows if row.get("id") == pipeline_id), None)
    if not rows:
        return None
    return next((row for row in rows if row.get("name") == DEFAULT_PIPELINE_NAME), rows[0])


def resolve_effective_lineage(
    document: dict[str, Any],
    pipeline: dict[str, Any] | None,
    *,
    parse_lookup: Lookup,
    chunk_lookup: Lookup,
    embedding_lookup: Lookup,
) -> dict[str, Any]:
    """Resolve the in-use parse/chunk/embedding run ids for one pipeline."""

    pipeline = pipeline or {}
    document_id = document.get("id")

    def usable(row: dict[str, Any] | None, parent_key: str | None, parent_id: str | None) -> bool:
        if not row or row.get("status") != "completed" or row.get("document_id") != document_id:
            return False
        return parent_key is None or (parent_id is not None and row.get(parent_key) == parent_id)

    def pick(level: str, lookup: Lookup, parent_key: str | None, parent_id: str | None) -> tuple[str | None, str | None]:
        for source, candidate in (
            ("pipeline", pipeline.get(f"{level}_run_id")),
            ("document_default", document.get(f"active_{level}_run_id")),
        ):
            if candidate and usable(lookup(candidate), parent_key, parent_id):
                return candidate, source
        return None, None

    parse_id, parse_source = pick("parse", parse_lookup, None, None)
    chunk_id, chunk_source = pick("chunk", chunk_lookup, "parse_run_id", parse_id) if parse_id else (None, None)
    embedding_id, embedding_source = (
        pick("embedding", embedding_lookup, "chunk_run_id", chunk_id) if chunk_id else (None, None)
    )
    return {
        "pipeline_id": pipeline.get("id"),
        "parse_run_id": parse_id,
        "chunk_run_id": chunk_id,
        "embedding_run_id": embedding_id,
        "sources": {"parse": parse_source, "chunk": chunk_source, "embedding": embedding_source},
    }


def resolve_from_rows(
    document: dict[str, Any],
    pipeline: dict[str, Any] | None,
    *,
    parses: Iterable[dict[str, Any]],
    chunks: Iterable[dict[str, Any]],
    embeddings: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    by_parse = {row["id"]: row for row in parses}
    by_chunk = {row["id"]: row for row in chunks}
    by_embedding = {row["id"]: row for row in embeddings}
    return resolve_effective_lineage(
        document,
        pipeline,
        parse_lookup=by_parse.get,
        chunk_lookup=by_chunk.get,
        embedding_lookup=by_embedding.get,
    )


def is_historical(kind: str, row: dict[str, Any], lineage: dict[str, Any]) -> bool:
    """A completed run is historical when it is not part of the in-use lineage."""

    if row.get("status") != "completed":
        return False
    if kind == "parse":
        return row.get("id") != lineage.get("parse_run_id")
    if kind == "chunk":
        return row.get("id") != lineage.get("chunk_run_id")
    if kind == "embedding":
        return row.get("id") != lineage.get("embedding_run_id")
    if row.get("chunk_run_id") != lineage.get("chunk_run_id"):
        return True
    embedding_id = row.get("embedding_run_id")
    return embedding_id is not None and embedding_id != lineage.get("embedding_run_id")
