import {
  DocumentApiError,
  isDocumentParseResponse,
  isParseJobAcceptedResponse,
  parseDocument,
} from "@/lib/document-api";
import type { DocumentParseResponse, ParseRunStatus } from "@/lib/document-parse-types";
import type {
  ApiProblem,
  Capabilities,
  ChunkConfig,
  ChunkItem,
  ChunkRun,
  ChunkStrategy,
  ContextCandidate,
  DocumentDetail,
  EmbeddingRun,
  EvaluationCase,
  EvaluationDataset,
  EvaluationMetrics,
  EvaluationRun,
  ExperimentRequest,
  ExperimentRun,
  ExperimentStageResults,
  PersistedDocument,
  PersistedParseResponse,
  ParseRun,
  RetrievedCandidate,
  RerankedCandidate,
  RunStatus,
  RunSummary,
  ValidatedCitation,
} from "@/lib/rag-api-types";
import { getSupabaseAccessToken } from "@/lib/supabase/browser";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

type DocumentParseResponseWithPersistence = DocumentParseResponse & {
  documentId?: string | null;
  parseRunId?: string | null;
  runMetadata?: Record<string, unknown> | null;
  document: DocumentParseResponse["document"] & { id?: string | null };
};

type JsonObject = Record<string, unknown>;

function getApiBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return DEFAULT_API_BASE_URL;
  throw new DocumentApiError("configuration_error", "NEXT_PUBLIC_API_BASE_URL is required in production.");
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function invalidResponse(message: string): never {
  throw new DocumentApiError("invalid_response", message);
}

function requiredObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidResponse(`The backend response is missing ${label}.`);
  return value as JsonObject;
}

function field(payload: JsonObject, camelCase: string, snakeCase: string) {
  return payload[camelCase] ?? payload[snakeCase];
}

function string(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function requiredString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) invalidResponse(`The backend response is missing ${label}.`);
  return value;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string") invalidResponse(`The backend response is missing ${label}.`);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function requiredNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalidResponse(`The backend response is missing ${label}.`);
  return value;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function boolean(value: unknown, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numbers(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)) : [];
}

function array<T>(value: unknown, normalize: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(normalize) : [];
}

function requiredArray<T>(value: unknown, normalize: (item: unknown) => T, label: string): T[] {
  if (!Array.isArray(value)) invalidResponse(`The backend response is missing ${label}.`);
  return value.map(normalize);
}

function normalizeProblem(value: unknown): ApiProblem | null {
  const payload = object(value);
  const code = optionalString(payload.code);
  const message = optionalString(payload.message);
  return code && message ? { code, message } : null;
}

function normalizeStatus(value: unknown): RunStatus {
  if (value === "queued" || value === "running" || value === "completed" || value === "failed") return value;
  if (value === "interrupted") return "failed";
  return invalidResponse("The backend response contains an invalid run status.");
}

function normalizeParseStatus(value: unknown): ParseRunStatus {
  return normalizeStatus(value);
}

function normalizeProgress(value: unknown, status: ParseRunStatus): number {
  const progress = optionalNumber(value);
  if (progress !== null) return Math.max(0, Math.min(100, Math.round(progress)));
  if (status === "completed") return 100;
  return status === "running" ? 8 : 0;
}

function normalizeRun(value: unknown): RunSummary {
  const payload = requiredObject(value, "run metadata");
  const timing = object(payload.timing);
  const upstream = object(payload.upstream);
  const config = object(payload.config);
  const runMetadata = object(payload.runMetadata ?? payload.run_metadata);
  const errorCode = optionalString(field(payload, "errorCode", "error_code"));
  const errorMessage = optionalString(field(payload, "errorMessage", "error_message"));
  const status = normalizeStatus(payload.status);
  const progress = optionalNumber(payload.progress ?? runMetadata.progress);
  const normalizedError = normalizeProblem(payload.error) ?? (errorCode && errorMessage ? { code: errorCode, message: errorMessage } : null);
  return {
    id: requiredString(payload.id, "run id"),
    status,
    progress: progress ?? (status === "running" ? 8 : status === "queued" ? 0 : null),
    isStale: boolean(field(payload, "isStale", "is_stale")),
    isCompatible: boolean(field(payload, "isCompatible", "is_compatible"), !boolean(field(payload, "isStale", "is_stale"))),
    compatibilityReason: optionalString(field(payload, "compatibilityReason", "compatibility_reason")),
    historicalLineage: boolean(field(payload, "historicalLineage", "historical_lineage")),
    upstream: Object.fromEntries(Object.entries(upstream).map(([key, item]) => [key, optionalString(item)])),
    config,
    timing: {
      startedAt: optionalString(timing.startedAt ?? payload.started_at),
      completedAt: optionalString(timing.completedAt ?? payload.completed_at),
      durationMs: optionalNumber(timing.durationMs ?? payload.duration_ms),
    },
    error: normalizedError ?? (payload.status === "interrupted" ? { code: "parse_interrupted", message: "The parse run was interrupted before completion." } : null),
  };
}

function normalizeDocument(value: unknown): PersistedDocument {
  const payload = requiredObject(value, "document");
  return {
    id: requiredString(payload.id, "document id"),
    fileName: requiredString(field(payload, "fileName", "file_name"), "document file name"),
    mediaType: requiredString(field(payload, "mediaType", "media_type"), "document media type"),
    sizeBytes: requiredNumber(field(payload, "sizeBytes", "size_bytes"), "document size"),
    pageCount: requiredNumber(field(payload, "pageCount", "page_count"), "document page count"),
    sha256: optionalString(payload.sha256),
    activeParseRunId: optionalString(field(payload, "activeParseRunId", "active_parse_run_id")),
    activeChunkRunId: optionalString(field(payload, "activeChunkRunId", "active_chunk_run_id")),
    activeEmbeddingRunId: optionalString(field(payload, "activeEmbeddingRunId", "active_embedding_run_id")),
    createdAt: optionalString(field(payload, "createdAt", "created_at")),
    updatedAt: optionalString(field(payload, "updatedAt", "updated_at")),
  };
}

function normalizeChunk(value: unknown): ChunkItem {
  const payload = requiredObject(value, "chunk");
  return {
    id: requiredString(payload.id, "chunk id"),
    ordinal: requiredNumber(payload.ordinal, "chunk ordinal"),
    text: requiredString(payload.text, "chunk text"),
    pageNumbers: numbers(field(payload, "pageNumbers", "page_numbers")),
    sourceElementIds: strings(field(payload, "sourceElementIds", "source_element_ids")),
    headingPath: strings(field(payload, "headingPath", "heading_path")),
    tokenCount: requiredNumber(field(payload, "tokenCount", "token_count"), "chunk token count"),
    characterCount: requiredNumber(field(payload, "characterCount", "character_count"), "chunk character count"),
  };
}

function normalizeRetrievedCandidate(value: unknown): RetrievedCandidate {
  const payload = requiredObject(value, "retrieval candidate");
  const denseScore = optionalNumber(field(payload, "denseScore", "dense_score"));
  const keywordScore = optionalNumber(field(payload, "keywordScore", "keyword_score"));
  const rrfScore = optionalNumber(field(payload, "rrfScore", "rrf_score"));
  return {
    chunkId: requiredString(field(payload, "chunkId", "chunk_id") ?? payload.id, "retrieval chunk id"),
    rank: requiredNumber(payload.rank, "retrieval rank"),
    score: optionalNumber(payload.score) ?? rrfScore ?? denseScore ?? keywordScore,
    denseScore,
    keywordScore,
    keywordRank: optionalNumber(field(payload, "keywordRank", "keyword_rank")),
    rrfScore,
    text: requiredString(payload.text ?? payload.preview, "retrieval candidate text"),
    documentId: requiredString(field(payload, "documentId", "document_id"), "retrieval document id"),
    pageNumbers: numbers(field(payload, "pageNumbers", "page_numbers") ?? payload.pages),
    sourceElementIds: strings(field(payload, "sourceElementIds", "source_element_ids")),
    headingPath: strings(field(payload, "headingPath", "heading_path")),
  };
}

function normalizeRerankedCandidate(value: unknown): RerankedCandidate {
  const payload = object(value);
  return {
    ...normalizeRetrievedCandidate(value),
    originalRank: requiredNumber(field(payload, "originalRank", "original_rank") ?? field(payload, "retrievalRank", "retrieval_rank") ?? payload.rank, "original retrieval rank"),
    rerankScore: optionalNumber(field(payload, "rerankScore", "rerank_score")),
  };
}

function normalizeContextCandidate(value: unknown): ContextCandidate {
  const payload = requiredObject(value, "context candidate");
  return {
    chunkId: requiredString(field(payload, "chunkId", "chunk_id") ?? payload.id, "context chunk id"),
    selected: boolean(payload.selected ?? payload.included),
    reason: string(payload.reason),
    tokenCount: requiredNumber(field(payload, "tokenCount", "token_count"), "context token count"),
    text: requiredString(payload.text ?? payload.preview, "context candidate text"),
    pageNumbers: numbers(field(payload, "pageNumbers", "page_numbers") ?? payload.pages),
    sourceElementIds: strings(field(payload, "sourceElementIds", "source_element_ids")),
  };
}

function normalizeCitation(value: unknown, fallbackValid = false): ValidatedCitation {
  const payload = requiredObject(value, "citation");
  return {
    citationId: requiredString(field(payload, "citationId", "citation_id") ?? payload.id, "citation id"),
    documentId: requiredString(field(payload, "documentId", "document_id"), "citation document id"),
    chunkId: requiredString(field(payload, "chunkId", "chunk_id"), "citation chunk id"),
    pageNumbers: numbers(field(payload, "pageNumbers", "page_numbers") ?? payload.pages),
    quote: optionalString(payload.quote),
    valid: payload.valid === undefined && payload.isValid === undefined ? fallbackValid : boolean(payload.valid ?? payload.isValid),
    sourceElementIds: strings(field(payload, "sourceElementIds", "source_element_ids")),
  };
}

function normalizeStageResults(value: unknown): ExperimentStageResults {
  const payload = object(value);
  const retrieval = object(payload.retrieval);
  const reranking = object(payload.reranking);
  const context = object(payload.context);
  const generation = object(payload.generation);
  const generationValidity = boolean(object(generation.citationValidity).valid);
  const selectedContext = array(context.selected, (item) => ({ ...object(item), selected: true, tokenCount: object(item).localTokenCount ?? object(item).tokenCount }));
  const excludedContext = array(context.excluded, (item) => ({ ...object(item), selected: false, tokenCount: object(item).localTokenCount ?? object(item).tokenCount }));
  return {
    retrieval: Object.keys(retrieval).length === 0 ? null : {
      candidates: requiredArray(retrieval.candidates ?? retrieval.results, normalizeRetrievedCandidate, "retrieval results"),
      durationMs: optionalNumber(field(retrieval, "durationMs", "duration_ms")),
    },
    reranking: Object.keys(reranking).length === 0 ? null : {
      candidates: requiredArray(reranking.candidates ?? reranking.results, normalizeRerankedCandidate, "reranking results"),
      durationMs: optionalNumber(field(reranking, "durationMs", "duration_ms")),
      method: optionalString(reranking.method ?? reranking.effectiveModel ?? reranking.model),
      executed: reranking.status !== "skipped",
    },
    context: Object.keys(context).length === 0 ? null : {
      candidates: array(context.candidates ?? context.selections ?? [...selectedContext, ...excludedContext], normalizeContextCandidate),
      finalContext: requiredText(context.finalContext ?? context.formattedContext ?? context.text, "final context"),
      tokenBudget: requiredNumber(field(context, "tokenBudget", "token_budget"), "context token budget"),
      tokenCount: requiredNumber(context.tokenCount ?? context.localTokenCount ?? context.usedTokens, "context token count"),
      durationMs: optionalNumber(field(context, "durationMs", "duration_ms")),
    },
    generation: Object.keys(generation).length === 0 ? null : {
      answer: typeof generation.answer === "string" ? generation.answer : invalidResponse("The backend response is missing the generated answer."),
      citations: requiredArray(generation.citations, (item) => normalizeCitation(item, generationValidity), "generation citations"),
      model: optionalString(generation.effectiveModel ?? generation.configuredModel ?? generation.model),
      inputTokens: optionalNumber(field(generation, "inputTokens", "input_tokens")),
      outputTokens: optionalNumber(field(generation, "outputTokens", "output_tokens")),
      durationMs: optionalNumber(field(generation, "durationMs", "duration_ms")),
      insufficientContext: boolean(field(generation, "insufficientContext", "insufficient_context")),
    },
  };
}

function normalizeMetrics(value: unknown): EvaluationMetrics {
  const payload = object(value);
  const metrics = object(payload.aggregate ?? payload.metrics ?? payload);
  return {
    hitAtK: optionalNumber(metrics.hitAtK),
    recallAtK: optionalNumber(metrics.recallAtK),
    precisionAtK: optionalNumber(metrics.precisionAtK),
    mrr: optionalNumber(metrics.mrr),
    citationValidity: optionalNumber(metrics.citationValidity),
    groundedness: optionalNumber(metrics.groundedness ?? metrics.faithfulness),
    judgeModel: optionalString(metrics.judgeModel),
    caseCount: optionalNumber(metrics.caseCount),
  };
}

function normalizeChunkStrategy(value: unknown): ChunkStrategy {
  if (value === "fixed_token" || value === "recursive_token" || value === "structure_aware") return value;
  return invalidResponse("The backend response contains an invalid chunk strategy.");
}

function normalizeTargetStage(value: unknown): ExperimentRun["targetStage"] {
  if (value === "retrieval" || value === "reranking" || value === "context" || value === "generation") return value;
  return invalidResponse("The backend response contains an invalid experiment target stage.");
}

function normalizePersistedParseResponse(value: unknown, requirePersistenceIds = false): PersistedParseResponse {
  if (!isDocumentParseResponse(value)) invalidResponse("The backend returned an invalid parse contract.");
  const payload = value as DocumentParseResponseWithPersistence;
  const documentId = payload.documentId ?? payload.document.id ?? null;
  const parseRunId = payload.parseRunId ?? null;
  if (requirePersistenceIds && (!documentId || !parseRunId)) invalidResponse("The persisted parse response is missing lifecycle IDs.");
  return {
    ...value,
    documentId,
    parseRunId,
    status: "completed",
    runMetadata: payload.runMetadata ?? null,
  };
}

function parseResultCandidate(value: unknown): unknown {
  if (isDocumentParseResponse(value)) return value;
  const payload = object(value);
  for (const key of ["result", "parse", "output", "data"]) {
    if (isDocumentParseResponse(payload[key])) return payload[key];
  }
  return null;
}

function normalizeParseRun(value: unknown, fallbackDocumentId: string | null = null, fallbackParseRunId: string | null = null): ParseRun {
  const payload = requiredObject(value, "parse run");
  const result = parseResultCandidate(value);
  const document = result ? object((result as DocumentParseResponse).document) : object(payload.document);
  const documentId = optionalString(field(payload, "documentId", "document_id"))
    ?? optionalString(document.id)
    ?? fallbackDocumentId;
  const parseRunId = optionalString(field(payload, "parseRunId", "parse_run_id"))
    ?? optionalString(payload.id)
    ?? fallbackParseRunId;
  if (!parseRunId) invalidResponse("The parse response is missing the parse run id.");
  const rawStatus = payload.status ?? (result ? "completed" : isParseJobAcceptedResponse(value) ? value.status : null);
  const status = normalizeParseStatus(rawStatus);
  const runMetadata = object(payload.runMetadata ?? payload.run_metadata);
  const progress = normalizeProgress(payload.progress ?? runMetadata.progress, status);
  const problem = normalizeProblem(payload.error)
    ?? ((status === "failed" || payload.status === "interrupted") && optionalString(field(payload, "errorCode", "error_code"))
      ? {
        code: optionalString(field(payload, "errorCode", "error_code")) ?? "parse_failed",
        message: optionalString(field(payload, "errorMessage", "error_message")) ?? "The parse run failed.",
      }
      : null)
    ?? (payload.status === "interrupted" ? { code: "parse_interrupted", message: "The parse run was interrupted before completion." } : null);
  const normalizedResult = result
    ? normalizePersistedParseResponse({
      ...result,
      documentId: field(payload, "documentId", "document_id") ?? (result as DocumentParseResponse & { documentId?: string | null }).documentId ?? documentId,
      parseRunId: field(payload, "parseRunId", "parse_run_id") ?? parseRunId,
      status: "completed",
      runMetadata: payload.runMetadata ?? payload.run_metadata ?? null,
    }, true)
    : null;
  if (status === "completed" && !normalizedResult) invalidResponse("The completed parse run is missing normalized content.");
  return {
    id: parseRunId,
    documentId: documentId ?? normalizedResult?.documentId ?? "",
    status,
    progress,
    result: normalizedResult,
    error: problem,
    runMetadata,
  };
}

export type ParseStatusListener = (run: ParseRun) => void;

export const PARSE_POLL_INTERVAL_MS = process.env.NODE_ENV === "test" ? 250 : 2_000;
export const PARSE_POLL_TIMEOUT_MS = 15 * 60 * 1_000;

function parsePollTimedOut(deadline: number) {
  if (Date.now() < deadline) return;
  throw new DocumentApiError(
    "parse_poll_timeout",
    "The parse is still running, but browser polling stopped after 15 minutes. Refresh to resume status checks.",
  );
}

function waitForParsePoll(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The parse poll was aborted.", "AbortError"));
      return;
    }
    const timeout = setTimeout(resolve, PARSE_POLL_INTERVAL_MS);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new DOMException("The parse poll was aborted.", "AbortError"));
    }, { once: true });
  });
}

function isTransientParsePollError(error: unknown) {
  if (!(error instanceof DocumentApiError)) return false;
  return error.code === "backend_unavailable" || error.status === null || error.status === 408 || error.status === 429 || (error.status !== null && error.status >= 500);
}

async function pollParseRun(
  initial: ParseRun,
  signal?: AbortSignal,
  onStatus?: ParseStatusListener,
  timeoutMs = PARSE_POLL_TIMEOUT_MS,
  startedAt = Date.now(),
): Promise<PersistedParseResponse> {
  let current = initial;
  const deadline = startedAt + timeoutMs;
  while (current.status === "queued" || current.status === "running") {
    parsePollTimedOut(deadline);
    await waitForParsePoll(signal);
    parsePollTimedOut(deadline);
    try {
      current = await getParseRun(current.id, signal, current.documentId || null);
      onStatus?.(current);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // A temporary network outage must not turn a valid queued/running run into
      // a false failure. The next poll re-reads the durable run state.
      if (isTransientParsePollError(error)) continue;
      throw error;
    }
  }
  if (current.status === "failed") {
    const problem = current.error ?? { code: "parse_failed", message: "The parse run failed." };
    throw new DocumentApiError(problem.code, problem.message);
  }
  if (!current.result) throw new DocumentApiError("invalid_response", "The completed parse run returned no normalized content.");
  return current.result;
}

export async function waitForParseRun(
  parseRunId: string,
  signal?: AbortSignal,
  documentId?: string | null,
  onStatus?: ParseStatusListener,
  timeoutMs = PARSE_POLL_TIMEOUT_MS,
): Promise<PersistedParseResponse> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let initial: ParseRun;
  while (true) {
    parsePollTimedOut(deadline);
    try {
      initial = await getParseRun(parseRunId, signal, documentId);
      break;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (!isTransientParsePollError(error)) throw error;
      await waitForParsePoll(signal);
    }
  }
  onStatus?.(initial);
  if (initial.status === "completed") {
    if (!initial.result) throw new DocumentApiError("invalid_response", "The completed parse response returned no normalized content.");
    return initial.result;
  }
  return pollParseRun(initial, signal, onStatus, timeoutMs, startedAt);
}

function normalizeChunkRun(value: unknown): ChunkRun {
  const payload = requiredObject(value, "chunk run");
  const run = normalizeRun(payload);
  const chunks = requiredArray(payload.chunks, normalizeChunk, "chunk results");
  const chunkCount = requiredNumber(field(payload, "chunkCount", "chunk_count"), "chunk count");
  if (run.status === "completed" && chunkCount !== chunks.length) invalidResponse("The completed chunk run count does not match its chunk results.");
  return {
    ...run,
    documentId: requiredString(field(payload, "documentId", "document_id"), "chunk document id"),
    parseRunId: requiredString(field(payload, "parseRunId", "parse_run_id"), "chunk parse run id"),
    strategy: normalizeChunkStrategy(payload.strategy),
    chunkCount,
    chunks,
  };
}

function normalizeEmbeddingRun(value: unknown): EmbeddingRun {
  const payload = requiredObject(value, "embedding run");
  return {
    ...normalizeRun(payload),
    documentId: requiredString(field(payload, "documentId", "document_id"), "embedding document id"),
    chunkRunId: requiredString(field(payload, "chunkRunId", "chunk_run_id"), "embedding chunk run id"),
    model: requiredString(payload.model, "embedding model"),
    dimensions: requiredNumber(payload.dimensions, "embedding dimensions"),
    embeddingFormatVersion: requiredString(field(payload, "embeddingFormatVersion", "embedding_format_version"), "embedding format version"),
    embeddingCount: requiredNumber(field(payload, "embeddingCount", "embedding_count"), "embedding count"),
  };
}

function normalizeExperiment(value: unknown): ExperimentRun {
  const payload = requiredObject(value, "experiment run");
  const run = normalizeRun(payload);
  const targetStage = normalizeTargetStage(field(payload, "targetStage", "target_stage"));
  const stageResults = normalizeStageResults(field(payload, "stageResults", "stage_results"));
  if (run.status === "completed") {
    if (!stageResults.retrieval) invalidResponse("The completed experiment is missing retrieval results.");
    if ((targetStage === "reranking" || targetStage === "context" || targetStage === "generation") && !stageResults.reranking) invalidResponse("The completed experiment is missing reranking results.");
    if ((targetStage === "context" || targetStage === "generation") && !stageResults.context) invalidResponse("The completed experiment is missing context results.");
    if (targetStage === "generation" && !stageResults.generation) invalidResponse("The completed experiment is missing generation results.");
  }
  return {
    ...run,
    documentId: requiredString(field(payload, "documentId", "document_id"), "experiment document id"),
    chunkRunId: requiredString(field(payload, "chunkRunId", "chunk_run_id"), "experiment chunk run id"),
    embeddingRunId: optionalString(field(payload, "embeddingRunId", "embedding_run_id")),
    query: requiredString(payload.query, "experiment query"),
    targetStage,
    stageResults,
  };
}

function listPayload(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  const payload = requiredObject(value, `${key} list envelope`);
  const items = payload[key] ?? payload.items;
  if (!Array.isArray(items)) invalidResponse(`The backend response is missing the ${key} list.`);
  return items;
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    const accessToken = await getSupabaseAccessToken();
    if (!accessToken && process.env.NODE_ENV !== "test") {
      throw new DocumentApiError("auth_required", "Oturum açmanız gerekiyor.");
    }
    const headers = new Headers(init.headers);
    if (!(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof DocumentApiError) throw error;
    if (error instanceof Error && error.message === "supabase_session_unavailable") {
      throw new DocumentApiError("auth_required", "Oturum doğrulanamadı. Lütfen tekrar giriş yapın.");
    }
    if (error instanceof Error && error.message === "supabase_configuration_missing") {
      throw new DocumentApiError("configuration_error", "Supabase auth yapılandırması eksik.");
    }
    throw new DocumentApiError("backend_unavailable", "The RAG backend could not be reached.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) throw new DocumentApiError("invalid_response", "The backend returned invalid JSON.", response.status);
  }

  if (!response.ok) {
    const problem = normalizeProblem(object(payload).error);
    throw new DocumentApiError(problem?.code ?? "unknown", problem?.message ?? "The RAG backend returned an error.", response.status);
  }
  return payload;
}

export async function parseAndPersistDocument(
  file: File,
  signal?: AbortSignal,
  onStatus?: ParseStatusListener,
): Promise<PersistedParseResponse> {
  const initial = normalizeParseRun(await parseDocument(file, signal));
  onStatus?.(initial);
  if (initial.status === "completed") {
    if (!initial.result) throw new DocumentApiError("invalid_response", "The completed parse response returned no normalized content.");
    return initial.result;
  }
  return pollParseRun(initial, signal, onStatus);
}

export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const payload = requiredObject(await request("/capabilities", { signal }), "capabilities");
  return {
    embeddingModel: requiredString(field(payload, "embeddingModel", "embedding_model"), "embedding model capability"),
    embeddingDimensions: requiredNumber(field(payload, "embeddingDimensions", "embedding_dimensions"), "embedding dimension capability"),
    generationModel: requiredString(field(payload, "generationModel", "generation_model"), "generation model capability"),
    rerankModel: requiredString(field(payload, "rerankModel", "rerank_model"), "rerank model capability"),
    judgeModel: requiredString(field(payload, "judgeModel", "judge_model"), "judge model capability"),
    embeddingFormatVersion: requiredString(field(payload, "embeddingFormatVersion", "embedding_format_version"), "embedding format capability"),
    limits: Object.fromEntries(Object.entries(requiredObject(payload.limits, "capability limits")).map(([key, item]) => [key, requiredNumber(item, `capability limit ${key}`)])),
  };
}

export async function listDocuments(signal?: AbortSignal): Promise<PersistedDocument[]> {
  const payload = await request("/documents", { signal });
  return listPayload(payload, "documents").map(normalizeDocument);
}

export async function getDocument(documentId: string, signal?: AbortSignal): Promise<DocumentDetail> {
  const payload = object(await request(`/documents/${encodeURIComponent(documentId)}`, { signal }));
  const activeParsePayload = payload.activeParseRun;
  const activeParse = activeParsePayload === null || activeParsePayload === undefined
    ? null
    : normalizeParseRun(activeParsePayload, documentId, optionalString(field(object(activeParsePayload), "parseRunId", "parse_run_id")))
      .result;
  return {
    ...normalizeDocument(payload),
    parseRuns: requiredArray(payload.parseRuns, normalizeRun, "parse run history"),
    chunkRuns: requiredArray(payload.chunkRuns, normalizeRun, "chunk run history"),
    embeddingRuns: requiredArray(payload.embeddingRuns, normalizeRun, "embedding run history"),
    experiments: requiredArray(payload.experiments, normalizeRun, "experiment history"),
    activeParseRun: activeParse,
  };
}

export async function getParseRun(runId: string, signal?: AbortSignal, documentId?: string | null): Promise<ParseRun> {
  try {
    return normalizeParseRun(
      await request(`/parse-runs/${encodeURIComponent(runId)}`, { signal }),
      documentId ?? null,
      runId,
    );
  } catch (error) {
    if (!(error instanceof DocumentApiError) || error.status !== 404 || !documentId) throw error;
    return normalizeParseRun(
      await request(`/documents/${encodeURIComponent(documentId)}/parse-runs/${encodeURIComponent(runId)}`, { signal }),
      documentId,
      runId,
    );
  }
}

export async function createChunkRun(documentId: string, strategy: ChunkStrategy, config: ChunkConfig, parseRunId: string, signal?: AbortSignal): Promise<ChunkRun> {
  const payload = await request(`/documents/${encodeURIComponent(documentId)}/chunks`, {
    method: "POST",
    body: JSON.stringify({ parseRunId, strategy, config }),
    signal,
  });
  return normalizeChunkRun(payload);
}

export async function createEmbeddingRun(documentId: string, chunkRunId: string, signal?: AbortSignal): Promise<EmbeddingRun> {
  const payload = await request(`/documents/${encodeURIComponent(documentId)}/embeddings`, {
    method: "POST",
    body: JSON.stringify({ chunkRunId }),
    signal,
  });
  return normalizeEmbeddingRun(payload);
}

export async function createExperiment(input: ExperimentRequest, signal?: AbortSignal): Promise<ExperimentRun> {
  return normalizeExperiment(await request("/experiments", { method: "POST", body: JSON.stringify(input), signal }));
}

export async function listExperiments(documentId: string, signal?: AbortSignal): Promise<ExperimentRun[]> {
  const payload = await request(`/experiments?documentId=${encodeURIComponent(documentId)}`, { signal });
  return listPayload(payload, "experiments").map(normalizeExperiment);
}

export async function createEvaluationDataset(input: { documentId: string; parseRunId: string; name: string; cases: EvaluationCase[] }, signal?: AbortSignal): Promise<EvaluationDataset> {
  const payload = object(await request("/evaluation/datasets", { method: "POST", body: JSON.stringify(input), signal }));
  return normalizeDataset(payload);
}

function normalizeDataset(value: unknown): EvaluationDataset {
  const payload = requiredObject(value, "evaluation dataset");
  return {
    id: requiredString(payload.id, "evaluation dataset id"),
    documentId: requiredString(field(payload, "documentId", "document_id"), "evaluation document id"),
    parseRunId: requiredString(field(payload, "parseRunId", "parse_run_id"), "evaluation parse run id"),
    name: requiredString(payload.name, "evaluation dataset name"),
    version: requiredNumber(payload.version, "evaluation dataset version"),
    cases: requiredArray(payload.cases, (item) => {
      const evaluationCase = requiredObject(item, "evaluation case");
      return {
        question: requiredString(evaluationCase.question, "evaluation question"),
        relevantElementIds: strings(field(evaluationCase, "relevantElementIds", "relevant_element_ids")),
        referenceAnswer: optionalString(field(evaluationCase, "referenceAnswer", "reference_answer")),
      };
    }, "evaluation cases"),
    createdAt: optionalString(field(payload, "createdAt", "created_at")),
  };
}

export async function listEvaluationDatasets(documentId: string, signal?: AbortSignal): Promise<EvaluationDataset[]> {
  const payload = await request(`/evaluation/datasets?documentId=${encodeURIComponent(documentId)}`, { signal });
  return listPayload(payload, "datasets").map(normalizeDataset);
}

export async function createEvaluationRun(input: {
  datasetId: string;
  chunkRunId: string;
  embeddingRunId: string;
  retrieval: ExperimentRequest["retrieval"];
  reranking: ExperimentRequest["reranking"];
  context: ExperimentRequest["context"];
  generation: ExperimentRequest["generation"];
  judge: boolean;
}, signal?: AbortSignal): Promise<EvaluationRun> {
  return normalizeEvaluationRun(await request("/evaluation/runs", { method: "POST", body: JSON.stringify(input), signal }));
}

function normalizeEvaluationRun(value: unknown): EvaluationRun {
  const payload = requiredObject(value, "evaluation run");
  return {
    ...normalizeRun(payload),
    datasetId: requiredString(field(payload, "datasetId", "dataset_id"), "evaluation dataset id"),
    results: normalizeMetrics(requiredObject(payload.results, "evaluation results")),
  };
}

export async function listEvaluationRuns(datasetId: string, signal?: AbortSignal): Promise<EvaluationRun[]> {
  const payload = await request(`/evaluation/runs?datasetId=${encodeURIComponent(datasetId)}`, { signal });
  return listPayload(payload, "runs").map(normalizeEvaluationRun);
}

export async function getChunkRun(runId: string, signal?: AbortSignal): Promise<ChunkRun> {
  return normalizeChunkRun(await request(`/chunk-runs/${encodeURIComponent(runId)}`, { signal }));
}

export async function getEmbeddingRun(runId: string, signal?: AbortSignal): Promise<EmbeddingRun> {
  return normalizeEmbeddingRun(await request(`/embedding-runs/${encodeURIComponent(runId)}`, { signal }));
}

export async function reparsePersistedDocument(
  documentId: string,
  signal?: AbortSignal,
  onStatus?: ParseStatusListener,
): Promise<PersistedParseResponse> {
  const initial = normalizeParseRun(
    await request(`/documents/${encodeURIComponent(documentId)}/parse`, { method: "POST", signal }),
    documentId,
  );
  onStatus?.(initial);
  if (initial.status === "completed") {
    if (!initial.result) throw new DocumentApiError("invalid_response", "The completed parse response returned no normalized content.");
    return initial.result;
  }
  return pollParseRun(initial, signal, onStatus);
}
