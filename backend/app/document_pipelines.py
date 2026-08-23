from __future__ import annotations

from typing import Any

from .config import get_settings
from .errors import ApiProblem
from .pipeline import (
    _require_compatible_chunk,
    _require_compatible_embedding,
    _require_compatible_parse,
)
from .repository import Repository
from .schemas import DocumentPipelineCreateRequest, DocumentPipelineUpdateRequest


POINTER_FIELDS = ("parse_run_id", "chunk_run_id", "embedding_run_id")


def _normalized_name(name: str) -> str:
    value = name.strip()
    if not 1 <= len(value) <= 100:
        raise ApiProblem(422, "invalid_pipeline_name", "Pipeline name must be between 1 and 100 characters.")
    return value


def _canonicalize_lineage(
    repository: Repository,
    document_id: str,
    selection: dict[str, str | None],
    *,
    explicit_fields: set[str],
) -> dict[str, str | None]:
    """Keep compatible historical artifacts and remove only unusable implicit pointers."""
    result = dict(selection)

    def invalid(field: str, problem: ApiProblem, *descendants: str) -> None:
        if field in explicit_fields:
            raise problem
        result[field] = None
        for descendant in descendants:
            result[descendant] = None

    parse_id = result.get("parse_run_id")
    if parse_id:
        try:
            _require_compatible_parse(repository, document_id, parse_id)
        except ApiProblem as problem:
            invalid("parse_run_id", problem, "chunk_run_id", "embedding_run_id")

    chunk_id = result.get("chunk_run_id")
    if chunk_id:
        try:
            chunk = _require_compatible_chunk(repository, document_id, chunk_id)
            if not result.get("parse_run_id") or chunk.get("parse_run_id") != result["parse_run_id"]:
                raise ApiProblem(409, "lineage_incompatible", "The chunk run does not belong to the selected parse.")
        except ApiProblem as problem:
            invalid("chunk_run_id", problem, "embedding_run_id")

    embedding_id = result.get("embedding_run_id")
    if embedding_id:
        try:
            if not result.get("chunk_run_id"):
                raise ApiProblem(409, "lineage_incompatible", "An embedding run requires selected chunks.")
            _require_compatible_embedding(
                repository,
                document_id,
                embedding_id,
                chunk_run_id=result["chunk_run_id"],
                settings=get_settings(),
                require_current_contract=True,
            )
        except ApiProblem as problem:
            invalid("embedding_run_id", problem)

    return result


def create_document_pipeline(
    repository: Repository,
    document_id: str,
    request: DocumentPipelineCreateRequest,
) -> dict[str, Any]:
    document = repository.get_document_row(document_id)
    if document is None:
        raise ApiProblem(404, "document_not_found", "The document was not found.")
    explicit = request.model_fields_set.intersection(POINTER_FIELDS)
    selection = {
        field: getattr(request, field) if field in explicit else document.get(f"active_{field}")
        for field in POINTER_FIELDS
    }
    selection = _canonicalize_lineage(repository, document_id, selection, explicit_fields=explicit)
    return repository.create_document_pipeline(
        {
            "owner_user_id": document["owner_user_id"],
            "document_id": document_id,
            "name": _normalized_name(request.name),
            **selection,
        }
    )


def update_document_pipeline(
    repository: Repository,
    pipeline_id: str,
    request: DocumentPipelineUpdateRequest,
) -> dict[str, Any]:
    current = repository.get_document_pipeline_row(pipeline_id)
    if current is None:
        raise ApiProblem(404, "document_pipeline_not_found", "The pipeline was not found.")
    fields = request.model_fields_set
    explicit = fields.intersection(POINTER_FIELDS)
    selection = {field: current.get(field) for field in POINTER_FIELDS}
    for field in explicit:
        selection[field] = getattr(request, field)

    if "parse_run_id" in explicit and "chunk_run_id" not in explicit:
        selection["chunk_run_id"] = None
        selection["embedding_run_id"] = None
    elif "chunk_run_id" in explicit and "embedding_run_id" not in explicit:
        selection["embedding_run_id"] = None

    selection = _canonicalize_lineage(
        repository,
        current["document_id"],
        selection,
        explicit_fields=explicit,
    )
    changes: dict[str, Any] = selection
    if "name" in fields:
        if request.name is None:
            raise ApiProblem(422, "invalid_pipeline_name", "Pipeline name cannot be null.")
        changes["name"] = _normalized_name(request.name)
    updated = repository.update_document_pipeline(pipeline_id, request.expected_revision, changes)
    if updated is None:
        raise ApiProblem(404, "document_pipeline_not_found", "The pipeline was not found.")
    return updated
