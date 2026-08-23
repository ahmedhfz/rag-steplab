from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CamelCaseModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


ElementType = Literal["heading", "paragraph", "list", "table", "other"]


class DocumentMetadata(CamelCaseModel):
    file_name: str
    media_type: str
    size_bytes: int = Field(ge=0)
    page_count: int = Field(ge=0)
    id: str | None = None
    sha256: str | None = None
    created_at: datetime | None = None


class ParsedTable(CamelCaseModel):
    rows: list[list[str]] = Field(default_factory=list)
    markdown: str = ""


class ParsedElement(CamelCaseModel):
    id: str
    type: ElementType
    page_numbers: list[int] = Field(default_factory=list)
    text: str = ""
    level: int | None = Field(default=None, ge=1)
    table: ParsedTable | None = None


class ParsedPage(CamelCaseModel):
    page_number: int = Field(ge=1)
    elements: list[ParsedElement] = Field(default_factory=list)


class StructuredContent(CamelCaseModel):
    pages: list[ParsedPage] = Field(default_factory=list)
    elements: list[ParsedElement] = Field(default_factory=list)


class ParseSummary(CamelCaseModel):
    page_count: int = Field(ge=0)
    heading_count: int = Field(ge=0)
    paragraph_count: int = Field(ge=0)
    list_count: int = Field(ge=0)
    table_count: int = Field(ge=0)


ParseStatus = Literal["queued", "running", "completed", "failed"]


class ParseResponse(CamelCaseModel):
    document: DocumentMetadata
    # Queue yanıtında semantic çıktı henüz oluşmamıştır. Tamamlanan koşuda üç
    # alan birlikte döner; API bunu repository durumundan üretir.
    structured: StructuredContent | None = None
    markdown: str | None = None
    summary: ParseSummary | None = None
    document_id: str | None = None
    parse_run_id: str | None = None
    status: ParseStatus = "completed"
    progress: int = Field(default=0, ge=0, le=100)
    run_metadata: dict[str, Any] | None = None
    error: ApiError | None = None
    reused_document: bool = False


class RunTiming(CamelCaseModel):
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = Field(default=None, ge=0)


RunStatus = Literal["queued", "running", "completed", "failed"]
ExperimentStageStatus = Literal["completed", "skipped"]


class RunSummary(CamelCaseModel):
    id: str
    run_number: int | None = Field(default=None, ge=1)
    created_at: datetime | None = None
    status: RunStatus
    progress: int | None = Field(default=None, ge=0, le=100)
    is_stale: bool = False
    is_compatible: bool = True
    compatibility_reason: str | None = None
    historical_lineage: bool = False
    upstream: dict[str, str | None] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    timing: RunTiming = Field(default_factory=RunTiming)
    error: ApiError | None = None


class DocumentListItem(CamelCaseModel):
    id: str
    file_name: str
    media_type: str
    size_bytes: int
    page_count: int = 0
    sha256: str | None = None
    active_parse_run_id: str | None = None
    active_chunk_run_id: str | None = None
    active_embedding_run_id: str | None = None
    latest_parse_status: ParseStatus | None = None
    latest_parse_error: dict[str, str] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class DocumentUploadResponse(CamelCaseModel):
    """The upload-only contract deliberately contains no parse artifact/run."""

    document: DocumentListItem
    reused_document: bool = False


class DocumentDetail(DocumentListItem):
    parse_runs: list[RunSummary] = Field(default_factory=list)
    chunk_runs: list[RunSummary] = Field(default_factory=list)
    embedding_runs: list[RunSummary] = Field(default_factory=list)
    experiments: list[RunSummary] = Field(default_factory=list)


class DocumentPipelineCreateRequest(CamelCaseModel):
    name: str
    parse_run_id: str | None = None
    chunk_run_id: str | None = None
    embedding_run_id: str | None = None


class DocumentPipelineUpdateRequest(CamelCaseModel):
    expected_revision: int = Field(ge=1)
    name: str | None = None
    parse_run_id: str | None = None
    chunk_run_id: str | None = None
    embedding_run_id: str | None = None


class DocumentPipelineResponse(CamelCaseModel):
    id: str
    document_id: str
    name: str
    parse_run_id: str | None = None
    chunk_run_id: str | None = None
    embedding_run_id: str | None = None
    revision: int = Field(ge=1)
    is_default: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


ChunkStrategy = Literal["fixed_token", "recursive_token", "structure_aware"]
RetrievalMode = Literal["dense", "keyword", "hybrid"]
ExperimentTargetStage = Literal["retrieval", "reranking", "context", "generation"]


class ChunkConfig(CamelCaseModel):
    chunk_size_tokens: int = Field(default=512, ge=32, le=4096)
    overlap_tokens: int = Field(default=64, ge=0, le=1024)


class ChunkRunRequest(CamelCaseModel):
    parse_run_id: str | None = None
    strategy: ChunkStrategy = "structure_aware"
    config: ChunkConfig = Field(default_factory=ChunkConfig)


class ChunkItem(CamelCaseModel):
    id: str
    ordinal: int
    text: str
    page_numbers: list[int] = Field(default_factory=list)
    source_element_ids: list[str] = Field(default_factory=list)
    heading_path: list[str] = Field(default_factory=list)
    token_count: int = Field(ge=0)
    character_count: int = Field(ge=0)


class ChunkRunResponse(RunSummary):
    document_id: str
    parse_run_id: str
    strategy: ChunkStrategy
    chunk_count: int = Field(ge=0)
    chunks: list[ChunkItem] = Field(default_factory=list)
    reused_artifact: bool = False


class EmbeddingRunRequest(CamelCaseModel):
    chunk_run_id: str | None = None


class EmbeddingRunResponse(RunSummary):
    document_id: str
    chunk_run_id: str
    model: str
    dimensions: int = Field(ge=1)
    embedding_format_version: str
    embedding_count: int = Field(ge=0)
    effective_model: str | None = None
    reused_artifact: bool = False


class RetrievalConfig(CamelCaseModel):
    mode: RetrievalMode = "hybrid"
    top_k: int = Field(default=5, ge=1, le=50)


class RerankingConfig(CamelCaseModel):
    enabled: bool = False
    candidate_count: int = Field(default=10, ge=1, le=20)


class ContextConfig(CamelCaseModel):
    token_budget: int = Field(default=3000, ge=256, le=12000)


class GenerationConfig(CamelCaseModel):
    temperature: float = Field(default=0.1, ge=0, le=2)
    max_output_tokens: int = Field(default=1024, ge=64, le=4096)


class ExperimentCreateRequest(CamelCaseModel):
    document_id: str
    pipeline_id: str | None = None
    chunk_run_id: str | None = None
    embedding_run_id: str | None = None
    query: str = Field(min_length=1, max_length=4000)
    target_stage: ExperimentTargetStage = "generation"
    retrieval: RetrievalConfig = Field(default_factory=RetrievalConfig)
    reranking: RerankingConfig = Field(default_factory=RerankingConfig)
    context: ContextConfig = Field(default_factory=ContextConfig)
    generation: GenerationConfig = Field(default_factory=GenerationConfig)


class ExperimentResponse(RunSummary):
    document_id: str
    chunk_run_id: str
    embedding_run_id: str | None = None
    query: str
    target_stage: ExperimentTargetStage
    stage_results: dict[str, Any] = Field(default_factory=dict)
    experiment_fingerprint: str | None = None
    reused_experiment: bool = False
    continued_from_experiment_id: str | None = None
    generation_rerun: bool = False


class EvaluationCase(CamelCaseModel):
    question: str = Field(min_length=1, max_length=4000)
    relevant_element_ids: list[str] = Field(default_factory=list)
    reference_answer: str | None = None


class EvaluationDatasetRequest(CamelCaseModel):
    document_id: str
    parse_run_id: str | None = None
    name: str = Field(min_length=1, max_length=200)
    cases: list[EvaluationCase] = Field(min_length=1, max_length=10)
    base_dataset_id: str | None = None


class EvaluationDatasetResponse(CamelCaseModel):
    id: str
    document_id: str
    parse_run_id: str
    name: str
    version: int
    series_id: str | None = None
    cases: list[EvaluationCase]
    created_at: datetime | None = None


class EvaluationRunRequest(CamelCaseModel):
    dataset_id: str
    pipeline_id: str | None = None
    chunk_run_id: str | None = None
    embedding_run_id: str | None = None
    retrieval: RetrievalConfig = Field(default_factory=RetrievalConfig)
    reranking: RerankingConfig = Field(default_factory=RerankingConfig)
    context: ContextConfig = Field(default_factory=ContextConfig)
    generation: GenerationConfig = Field(default_factory=GenerationConfig)
    judge: bool = False


class EvaluationRunResponse(RunSummary):
    id: str
    dataset_id: str
    results: dict[str, Any] = Field(default_factory=dict)


class CapabilitiesResponse(CamelCaseModel):
    embedding_model: str
    embedding_dimensions: int
    generation_model: str
    rerank_model: str
    judge_model: str
    embedding_format_version: str
    limits: dict[str, int]


class ApiError(CamelCaseModel):
    code: str
    message: str


class ErrorResponse(CamelCaseModel):
    error: ApiError
