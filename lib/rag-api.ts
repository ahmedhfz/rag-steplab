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
  DocumentPipeline,
  DocumentPipelineCreateInput,
  DocumentPipelineUpdateInput,
  DocumentUploadResponse,
  DocumentSummary,
  EmbeddingRun,
  EvaluationCase,
  EvaluationDataset,
  EvaluationDatasetSummary,
  EvaluationGenerationMetrics,
  EvaluationMetrics,
  EvaluationRun,
  EvaluationRunSummary,
  ExperimentRequest,
  ExperimentRun,
  ExperimentSummary,
  ExperimentStageResults,
  PersistedDocument,
  PersistedParseResponse,
  ParseRun,
  RetrievedCandidate,
  RerankedCandidate,
  RunStatus,
  RunSummary,
  StageReuseMetadata,
  ValidatedCitation,
} from "@/lib/rag-api-types";
import { getSupabaseAccessToken } from "@/lib/supabase/browser";
import { resolveApiBaseUrl } from "@/lib/api-base-url";

type DocumentParseResponseWithPersistence = DocumentParseResponse & {
  documentId?: string | null;
  parseRunId?: string | null;
  runMetadata?: Record<string, unknown> | null;
  reusedDocument?: boolean;
  document: DocumentParseResponse["document"] & { id?: string | null };
};

type JsonObject = Record<string, unknown>;

function getApiBaseUrl() {
  const apiBaseUrl = resolveApiBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL, process.env.NODE_ENV);
  if (apiBaseUrl) return apiBaseUrl;
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

function normalizeReuse(value: unknown): StageReuseMetadata | null {
  const payload = object(value);
  if (Object.keys(payload).length === 0) return null;
  return {
    reused: boolean(payload.reused),
    executed: boolean(payload.executed),
    sourceExperimentId: optionalString(field(payload, "sourceExperimentId", "source_experiment_id")),
    sourceDurationMs: optionalNumber(field(payload, "sourceDurationMs", "source_duration_ms")),
  };
}

function normalizeStageIdentity(value: JsonObject) {
  return {
    fingerprint: optionalString(value.fingerprint),
    resultHash: optionalString(field(value, "resultHash", "result_hash")),
    reuse: normalizeReuse(value.reuse),
    provenance: Object.keys(object(value.provenance)).length ? object(value.provenance) : null,
  };
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
    runNumber: optionalNumber(field(payload, "runNumber", "run_number")),
    phase: optionalString(field(payload, "phase", "phase")) ?? optionalString(runMetadata.phase),
    createdAt: optionalString(field(payload, "createdAt", "created_at")),
    status,
    progress: progress ?? (status === "running" ? 8 : status === "queued" ? 0 : null),
    isStale: boolean(field(payload, "isStale", "is_stale")),
    isCompatible: boolean(field(payload, "isCompatible", "is_compatible"), !boolean(field(payload, "isStale", "is_stale"))),
    compatibilityReason: optionalString(field(payload, "compatibilityReason", "compatibility_reason")),
    historicalLineage: boolean(field(payload, "historicalLineage", "historical_lineage")),
    upstream: Object.fromEntries(Object.entries(upstream).map(([key, item]) => [key, optionalString(item)])),
    config,
    timing: {
      startedAt: optionalString(timing.startedAt ?? field(payload, "startedAt", "started_at")),
      completedAt: optionalString(timing.completedAt ?? field(payload, "completedAt", "completed_at")),
      // Detay ve özet endpoint'leri farklı isimlendirme kullanabilir; süreyi uydurmadan ikisini de kabul et.
      durationMs: optionalNumber(timing.durationMs ?? field(payload, "durationMs", "duration_ms")),
    },
    error: normalizedError ?? (payload.status === "interrupted" ? { code: "parse_interrupted", message: "The parse run was interrupted before completion." } : null),
    strategy: typeof payload.strategy === "string" ? normalizeChunkStrategy(payload.strategy) : null,
    chunkCount: optionalNumber(field(payload, "chunkCount", "chunk_count")),
    model: optionalString(payload.model),
    dimensions: optionalNumber(payload.dimensions),
    embeddingFormatVersion: optionalString(field(payload, "embeddingFormatVersion", "embedding_format_version")),
    embeddingCount: optionalNumber(field(payload, "embeddingCount", "embedding_count")),
    effectiveModel: optionalString(field(payload, "effectiveModel", "effective_model")),
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
    latestParseStatus: (() => {
      const value = field(payload, "latestParseStatus", "latest_parse_status");
      return value === "queued" || value === "running" || value === "completed" || value === "failed" ? value : null;
    })(),
    latestParseError: normalizeProblem(field(payload, "latestParseError", "latest_parse_error")),
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
    rerankRank: optionalNumber(field(payload, "rerankRank", "rerank_rank") ?? payload.rank),
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
      ...normalizeStageIdentity(retrieval),
      candidates: requiredArray(retrieval.candidates ?? retrieval.results, normalizeRetrievedCandidate, "retrieval results"),
      durationMs: optionalNumber(field(retrieval, "durationMs", "duration_ms")),
    },
    reranking: Object.keys(reranking).length === 0 ? null : {
      ...normalizeStageIdentity(reranking),
      candidates: requiredArray(reranking.candidates ?? reranking.results, normalizeRerankedCandidate, "reranking results"),
      durationMs: optionalNumber(field(reranking, "durationMs", "duration_ms")),
      method: optionalString(reranking.method ?? reranking.effectiveModel ?? reranking.model),
      rerankScoreSemantics: optionalString(reranking.rerankScoreSemantics),
      executed: reranking.status !== "skipped",
    },
    context: Object.keys(context).length === 0 ? null : {
      ...normalizeStageIdentity(context),
      candidates: array(context.candidates ?? context.selections ?? [...selectedContext, ...excludedContext], normalizeContextCandidate),
      finalContext: requiredText(context.finalContext ?? context.formattedContext ?? context.text, "final context"),
      tokenBudget: requiredNumber(field(context, "tokenBudget", "token_budget"), "context token budget"),
      tokenCount: requiredNumber(context.tokenCount ?? context.localTokenCount ?? context.usedTokens, "context token count"),
      durationMs: optionalNumber(field(context, "durationMs", "duration_ms")),
    },
    generation: Object.keys(generation).length === 0 ? null : {
      ...normalizeStageIdentity(generation),
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
  const generationMetricsPayload = field(metrics, "generationMetrics", "generation_metrics") ?? field(payload, "generationMetrics", "generation_metrics");
  const generationMetrics = normalizeGenerationMetrics(generationMetricsPayload);
  return {
    hitAtK: optionalNumber(metrics.hitAtK),
    recallAtK: optionalNumber(metrics.recallAtK),
    precisionAtK: optionalNumber(metrics.precisionAtK),
    mrr: optionalNumber(metrics.mrr),
    citationValidity: optionalNumber(metrics.citationValidity),
    groundedness: optionalNumber(metrics.groundedness ?? metrics.faithfulness),
    judgeModel: optionalString(metrics.judgeModel),
    caseCount: optionalNumber(metrics.caseCount),
    retrievalEligibleCaseCount: optionalNumber(metrics.retrievalEligibleCaseCount),
    abstentionEligibleCaseCount: optionalNumber(metrics.abstentionEligibleCaseCount),
    abstentionAccuracy: optionalNumber(metrics.abstentionAccuracy),
    generationMetrics,
  };
}

function normalizeGenerationMetrics(value: unknown): EvaluationGenerationMetrics | null {
  const metrics = object(value);
  if (Object.keys(metrics).length === 0) return null;
  return {
    faithfulness: optionalNumber(metrics.faithfulness),
    answerRelevance: optionalNumber(field(metrics, "answerRelevance", "answer_relevance")),
    answerCorrectness: optionalNumber(field(metrics, "answerCorrectness", "answer_correctness")),
    eligibleCaseCount: optionalNumber(field(metrics, "eligibleCaseCount", "eligible_case_count")),
    scoredCaseCount: optionalNumber(field(metrics, "scoredCaseCount", "scored_case_count")),
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
    reusedDocument: payload.reusedDocument === true,
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
  const reusedDocument = boolean(payload.reusedDocument ?? payload.reused_document);
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
      reusedDocument,
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
    reusedDocument: reusedDocument || normalizedResult?.reusedDocument === true,
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

export function waitForPoll(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The parse poll was aborted.", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException("The parse poll was aborted.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForParsePoll(signal?: AbortSignal) {
  return waitForPoll(PARSE_POLL_INTERVAL_MS, signal);
}

async function pollRun<T extends { status: string }>(
  read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, onProgress?: (run: T) => void, initialRun?: T,
): Promise<T> {
  const deadline = Date.now() + PARSE_POLL_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const activeSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
  const timeoutError = () => new DocumentApiError("run_poll_timeout", "Browser tracking paused after 15 minutes. Resume tracking to check this run; its backend status is unchanged.");
  const timeout = setTimeout(() => timeoutController.abort(), PARSE_POLL_TIMEOUT_MS);
  let run = initialRun;
  let failures = 0;
  try {
    while (true) {
      activeSignal.throwIfAborted();
      if (Date.now() >= deadline) throw timeoutError();
      if (run && run.status !== "queued" && run.status !== "running") return run;
      const delay = failures ? Math.min(2_000 * 2 ** Math.min(failures - 1, 3), 10_000) : run ? 650 : 0;
      if (delay) await waitForPoll(Math.min(delay, deadline - Date.now()), activeSignal);
      if (Date.now() >= deadline) continue;
      try {
        run = await read(activeSignal);
        activeSignal.throwIfAborted();
        failures = 0;
        onProgress?.(run);
      } catch (error) {
        if (!isTransientParsePollError(error)) throw error;
        failures++;
      }
    }
  } catch (error) {
    if (timeoutController.signal.aborted && !signal?.aborted) throw timeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    reusedArtifact: boolean(field(payload, "reusedArtifact", "reused_artifact")),
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
    effectiveModel: optionalString(field(payload, "effectiveModel", "effective_model")),
    reusedArtifact: boolean(field(payload, "reusedArtifact", "reused_artifact")),
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
    experimentFingerprint: optionalString(field(payload, "experimentFingerprint", "experiment_fingerprint")),
    reusedExperiment: boolean(field(payload, "reusedExperiment", "reused_experiment")),
    continuedFromExperimentId: optionalString(field(payload, "continuedFromExperimentId", "continued_from_experiment_id")),
    generationRerun: boolean(field(payload, "generationRerun", "generation_rerun")),
  };
}

function normalizeExperimentSummary(value: unknown): ExperimentSummary {
  const payload = requiredObject(value, "experiment summary");
  const run = normalizeRun(payload);
  const rawStageStatuses = object(field(payload, "stageStatuses", "stage_statuses"));
  const stageStatuses: ExperimentSummary["stageStatuses"] = {};
  for (const stage of ["retrieval", "reranking", "context", "generation"] as const) {
    const status = rawStageStatuses[stage];
    if (status === "completed" || status === "skipped") stageStatuses[stage] = status;
  }
  return {
    ...run,
    documentId: requiredString(field(payload, "documentId", "document_id"), "experiment document id"),
    chunkRunId: requiredString(field(payload, "chunkRunId", "chunk_run_id"), "experiment chunk run id"),
    embeddingRunId: optionalString(field(payload, "embeddingRunId", "embedding_run_id")),
    query: string(payload.query),
    targetStage: normalizeTargetStage(field(payload, "targetStage", "target_stage")),
    candidateCount: optionalNumber(field(payload, "candidateCount", "candidate_count")),
    experimentFingerprint: optionalString(field(payload, "experimentFingerprint", "experiment_fingerprint")),
    stageStatuses,
  };
}

function normalizeEvaluationRunSummary(value: unknown): EvaluationRunSummary {
  const payload = requiredObject(value, "evaluation run summary");
  const timing = object(payload.timing);
  return {
    id: requiredString(payload.id, "evaluation run id"),
    createdAt: optionalString(field(payload, "createdAt", "created_at")),
    datasetId: requiredString(field(payload, "datasetId", "dataset_id"), "evaluation dataset id"),
    parseRunId: requiredString(field(payload, "parseRunId", "parse_run_id"), "evaluation parse run id"),
    chunkRunId: optionalString(field(payload, "chunkRunId", "chunk_run_id")),
    embeddingRunId: optionalString(field(payload, "embeddingRunId", "embedding_run_id")),
    status: normalizeStatus(payload.status),
    timing: {
      startedAt: optionalString(field(timing, "startedAt", "started_at")),
      completedAt: optionalString(field(timing, "completedAt", "completed_at")),
      durationMs: optionalNumber(field(timing, "durationMs", "duration_ms")),
    },
    error: normalizeProblem(payload.error),
  };
}

function normalizeDocumentPipeline(value: unknown): DocumentPipeline {
  const payload = requiredObject(value, "document pipeline");
  return {
    id: requiredString(payload.id, "document pipeline id"),
    documentId: requiredString(field(payload, "documentId", "document_id"), "pipeline document id"),
    name: requiredString(payload.name, "pipeline name"),
    parseRunId: optionalString(field(payload, "parseRunId", "parse_run_id")),
    chunkRunId: optionalString(field(payload, "chunkRunId", "chunk_run_id")),
    embeddingRunId: optionalString(field(payload, "embeddingRunId", "embedding_run_id")),
    revision: requiredNumber(payload.revision, "pipeline revision"),
    isDefault: Boolean(field(payload, "isDefault", "is_default")),
    createdAt: optionalString(field(payload, "createdAt", "created_at")),
    updatedAt: optionalString(field(payload, "updatedAt", "updated_at")),
  };
}

function normalizeDatasetSummary(value: unknown): EvaluationDatasetSummary {
  const payload = requiredObject(value, "evaluation dataset summary");
  return {
    id: requiredString(payload.id, "evaluation dataset id"),
    documentId: requiredString(field(payload, "documentId", "document_id"), "evaluation document id"),
    parseRunId: requiredString(field(payload, "parseRunId", "parse_run_id"), "evaluation parse run id"),
    name: requiredString(payload.name, "evaluation dataset name"),
    version: requiredNumber(payload.version, "evaluation dataset version"),
    seriesId: optionalString(field(payload, "seriesId", "series_id")),
    caseCount: requiredNumber(field(payload, "caseCount", "case_count"), "evaluation dataset case count"),
    createdAt: optionalString(field(payload, "createdAt", "created_at")),
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

  if (response.status === 204) return null;
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
  const result = await pollParseRun(initial, signal, onStatus);
  return { ...result, reusedDocument: initial.reusedDocument || result.reusedDocument };
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

export async function uploadDocument(file: File, signal?: AbortSignal): Promise<DocumentUploadResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);
  const payload = requiredObject(await request("/documents", { method: "POST", body: formData, signal }), "document upload response");
  return {
    document: normalizeDocument(payload.document),
    reusedDocument: payload.reusedDocument === true || payload.reused_document === true,
  };
}

export async function deleteDocument(documentId: string, signal?: AbortSignal): Promise<void> {
  await request(`/documents/${encodeURIComponent(documentId)}`, { method: "DELETE", signal });
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

export async function getDocumentSummary(documentId: string, signal?: AbortSignal): Promise<DocumentSummary> {
  try {
    const payload = object(await request(`/documents/${encodeURIComponent(documentId)}/summary`, { signal }));
    return {
      ...normalizeDocument(payload),
      parseRuns: requiredArray(payload.parseRuns, normalizeRun, "parse run history"),
      chunkRuns: requiredArray(payload.chunkRuns, normalizeRun, "chunk run history"),
      embeddingRuns: requiredArray(payload.embeddingRuns, normalizeRun, "embedding run history"),
      experiments: requiredArray(payload.experiments, normalizeExperimentSummary, "experiment history"),
      evaluationDatasets: requiredArray(payload.evaluationDatasets ?? payload.datasets, normalizeDatasetSummary, "evaluation dataset history"),
      evaluationRuns: requiredArray(payload.evaluationRuns ?? [], normalizeEvaluationRunSummary, "evaluation run history"),
    };
  } catch (error) {
    // Older previews may not expose the additive endpoint yet. Keep the
    // legacy contract as a temporary compatibility path; production hot paths
    // use the summary endpoint above and never request this fallback.
    if (!(error instanceof DocumentApiError) || (error.status !== 404 && error.code !== "invalid_response")) throw error;
    const legacy = await getDocument(documentId, signal);
    let evaluationDatasets: EvaluationDatasetSummary[] = [];
    try {
      // Summary response'u evaluation run normalizasyonu gibi additive alanlar
      // yüzünden legacy fallback'e düşse bile dataset listesi kalıcı kalmalıdır.
      evaluationDatasets = await listEvaluationDatasets(documentId, signal);
    } catch (datasetError) {
      if (!(datasetError instanceof DocumentApiError) || (datasetError.status !== 404 && datasetError.code !== "invalid_response")) throw datasetError;
    }
    return {
      ...legacy,
      experiments: legacy.experiments.map((run) => ({
        ...run,
        documentId,
        chunkRunId: run.upstream.chunkRunId ?? "",
        embeddingRunId: run.upstream.embeddingRunId ?? null,
        query: "",
        targetStage: "generation" as const,
        candidateCount: null,
        experimentFingerprint: null,
        stageStatuses: {},
      })),
      evaluationDatasets,
      evaluationRuns: [],
      activeParseRun: legacy.activeParseRun,
    };
  }
}

export async function getDocumentSourceUrl(
  documentId: string,
  signal?: AbortSignal,
): Promise<{ sourceUrl: string; mode: "signed" | "proxy"; expiresIn: number }> {
  const payload = requiredObject(await request(`/documents/${encodeURIComponent(documentId)}/source-url`, { signal }), "document source URL");
  const sourceUrl = requiredString(payload.sourceUrl, "document source URL");
  const mode = payload.mode === "signed" ? "signed" : "proxy";
  return {
    sourceUrl: mode === "proxy" ? `${getApiBaseUrl()}${sourceUrl}` : sourceUrl,
    mode,
    expiresIn: requiredNumber(payload.expiresIn, "document source URL expiry"),
  };
}

export async function getDocumentSourcePreviewUrl(
  documentId: string,
  signal?: AbortSignal,
): Promise<{ sourceUrl: string; mode: "signed" | "proxy"; expiresIn: number; revoke: () => void }> {
  const descriptor = await getDocumentSourceUrl(documentId, signal);
  if (descriptor.mode === "signed") {
    return { ...descriptor, revoke: () => undefined };
  }
  const token = await getSupabaseAccessToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const response = await fetch(descriptor.sourceUrl, { headers, signal, credentials: "omit" });
  if (!response.ok) throw new DocumentApiError("source_unavailable", "The private PDF source could not be loaded.", response.status);
  const objectUrl = URL.createObjectURL(await response.blob());
  return { ...descriptor, sourceUrl: objectUrl, revoke: () => URL.revokeObjectURL(objectUrl) };
}

export async function listDocumentPipelines(documentId: string, signal?: AbortSignal): Promise<DocumentPipeline[]> {
  const payload = await request(`/documents/${encodeURIComponent(documentId)}/pipelines`, { signal });
  return listPayload(payload, "pipelines").map(normalizeDocumentPipeline);
}

export async function createDocumentPipeline(
  documentId: string,
  input: DocumentPipelineCreateInput,
  signal?: AbortSignal,
): Promise<DocumentPipeline> {
  return normalizeDocumentPipeline(await request(`/documents/${encodeURIComponent(documentId)}/pipelines`, {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  }));
}

export async function updateDocumentPipeline(
  pipelineId: string,
  input: DocumentPipelineUpdateInput,
  signal?: AbortSignal,
): Promise<DocumentPipeline> {
  return normalizeDocumentPipeline(await request(`/document-pipelines/${encodeURIComponent(pipelineId)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
    signal,
  }));
}

export async function deleteDocumentPipeline(pipelineId: string, signal?: AbortSignal): Promise<void> {
  await request(`/document-pipelines/${encodeURIComponent(pipelineId)}`, { method: "DELETE", signal });
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

export async function createExperimentAsync(
  input: ExperimentRequest,
  signal?: AbortSignal,
  onProgress?: (run: ExperimentRun) => void,
): Promise<ExperimentRun> {
  const run = normalizeExperiment(await request("/experiments?async=true", { method: "POST", body: JSON.stringify(input), signal }));
  onProgress?.(run);
  return waitForExperimentRun(run.id, signal, onProgress, run);
}

export async function waitForExperimentRun(
  experimentId: string,
  signal?: AbortSignal,
  onProgress?: (run: ExperimentRun) => void,
  initialRun?: ExperimentRun,
): Promise<ExperimentRun> {
  return pollRun((pollSignal) => getExperiment(experimentId, pollSignal), signal, onProgress, initialRun);
}

export async function getExperiment(experimentId: string, signal?: AbortSignal): Promise<ExperimentRun> {
  return normalizeExperiment(await request(`/experiments/${encodeURIComponent(experimentId)}`, { signal }));
}

export async function getExperimentStatus(experimentId: string, signal?: AbortSignal): Promise<{
  id: string;
  status: RunStatus;
  stageStatuses: Record<string, string>;
  timing: { startedAt: string | null; completedAt: string | null; durationMs: number | null };
  error: ApiProblem | null;
}> {
  const payload = requiredObject(await request(`/experiments/${encodeURIComponent(experimentId)}/status`, { signal }), "experiment status");
  const timing = object(payload.timing);
  return {
    id: requiredString(payload.id, "experiment status id"),
    status: normalizeStatus(payload.status),
    stageStatuses: Object.fromEntries(Object.entries(object(payload.stageStatuses ?? payload.stage_statuses)).filter(([, value]) => typeof value === "string")) as Record<string, string>,
    timing: {
      startedAt: optionalString(field(timing, "startedAt", "started_at")),
      completedAt: optionalString(field(timing, "completedAt", "completed_at")),
      durationMs: optionalNumber(field(timing, "durationMs", "duration_ms")),
    },
    error: normalizeProblem(payload.error),
  };
}

export async function continueExperiment(experimentId: string, signal?: AbortSignal): Promise<ExperimentRun> {
  const run = normalizeExperiment(await request(`/experiments/${encodeURIComponent(experimentId)}/continue`, { method: "POST", signal }));
  return waitForExperimentRun(run.id, signal, undefined, run);
}

export async function rerunGeneration(experimentId: string, signal?: AbortSignal): Promise<ExperimentRun> {
  const run = normalizeExperiment(await request(`/experiments/${encodeURIComponent(experimentId)}/rerun-generation`, { method: "POST", signal }));
  return waitForExperimentRun(run.id, signal, undefined, run);
}

export async function listExperiments(documentId: string, signal?: AbortSignal): Promise<ExperimentSummary[]> {
  const payload = await request(`/experiments?documentId=${encodeURIComponent(documentId)}`, { signal });
  return listPayload(payload, "experiments").map(normalizeExperimentSummary);
}

export async function createEvaluationDataset(input: { documentId: string; parseRunId: string; name: string; cases: EvaluationCase[]; baseDatasetId?: string | null; evaluationMode?: "interactive" | "benchmark" }, signal?: AbortSignal): Promise<EvaluationDataset> {
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
    seriesId: optionalString(field(payload, "seriesId", "series_id")),
    cases: requiredArray(payload.cases, (item) => {
      const evaluationCase = requiredObject(item, "evaluation case");
      return {
        question: requiredString(evaluationCase.question, "evaluation question"),
        relevantElementIds: strings(field(evaluationCase, "relevantElementIds", "relevant_element_ids")),
        referenceAnswer: optionalString(field(evaluationCase, "referenceAnswer", "reference_answer")),
        expectedOutcome: evaluationCase.expectedOutcome === "insufficient_context" ? "insufficient_context" : "answer",
      };
    }, "evaluation cases"),
    createdAt: optionalString(field(payload, "createdAt", "created_at")),
  };
}

export async function listEvaluationDatasets(documentId: string, signal?: AbortSignal): Promise<EvaluationDatasetSummary[]> {
  const payload = await request(`/evaluation/datasets?documentId=${encodeURIComponent(documentId)}`, { signal });
  return listPayload(payload, "datasets").map(normalizeDatasetSummary);
}

export async function getEvaluationDataset(datasetId: string, signal?: AbortSignal): Promise<EvaluationDataset> {
  return normalizeDataset(await request(`/evaluation/datasets/${encodeURIComponent(datasetId)}`, { signal }));
}

export async function createEvaluationRun(input: {
  datasetId: string;
  pipelineId?: string | null;
  chunkRunId: string;
  embeddingRunId: string | null;
  retrieval: ExperimentRequest["retrieval"];
  reranking: ExperimentRequest["reranking"];
  context: ExperimentRequest["context"];
  generation: ExperimentRequest["generation"];
  judge: boolean;
}, signal?: AbortSignal): Promise<EvaluationRun> {
  return normalizeEvaluationRun(await request("/evaluation/runs", { method: "POST", body: JSON.stringify(input), signal }));
}

export async function createEvaluationRunAsync(
  input: Parameters<typeof createEvaluationRun>[0],
  signal?: AbortSignal,
  onProgress?: (run: EvaluationRun) => void,
): Promise<EvaluationRun> {
  const run = normalizeEvaluationRun(await request("/evaluation/runs?async=true", { method: "POST", body: JSON.stringify(input), signal }));
  onProgress?.(run);
  return waitForEvaluationRun(run.id, signal, onProgress, run);
}

export async function waitForEvaluationRun(
  runId: string,
  signal?: AbortSignal,
  onProgress?: (run: EvaluationRun) => void,
  initialRun?: EvaluationRun,
): Promise<EvaluationRun> {
  return pollRun((pollSignal) => getEvaluationRun(runId, pollSignal), signal, onProgress, initialRun);
}

function normalizeEvaluationRun(value: unknown): EvaluationRun {
  const payload = requiredObject(value, "evaluation run");
  const resultsPayload = requiredObject(payload.results, "evaluation results");
  const rawCaseResults = resultsPayload.caseResults;
  return {
    ...normalizeRun(payload),
    datasetId: requiredString(field(payload, "datasetId", "dataset_id"), "evaluation dataset id"),
    results: normalizeMetrics(resultsPayload),
    caseResults: Array.isArray(rawCaseResults)
      ? rawCaseResults.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).map((item) => ({
        question: string(item.question),
        expectedElementIds: strings(field(item, "expectedElementIds", "expected_element_ids")),
        retrievedElementIds: strings(field(item, "retrievedElementIds", "retrieved_element_ids")),
        referenceAnswer: optionalString(field(item, "referenceAnswer", "reference_answer")),
        answer: optionalString(item.answer),
        citations: array(item.citations, (citation) => normalizeCitation(citation)),
        expectedOutcome: item.expectedOutcome === "insufficient_context" ? "insufficient_context" : "answer",
        insufficientContext: typeof item.insufficientContext === "boolean" ? item.insufficientContext : undefined,
        retrievalEligible: typeof item.retrievalEligible === "boolean" ? item.retrievalEligible : undefined,
        abstentionCorrect: typeof item.abstentionCorrect === "boolean" ? item.abstentionCorrect : null,
        hitAtK: optionalNumber(item.hitAtK),
        precisionAtK: optionalNumber(item.precisionAtK),
        recallAtK: optionalNumber(item.recallAtK),
        mrr: optionalNumber(item.mrr),
        citationValidity: optionalNumber(item.citationValidity) ?? 0,
        groundedness: optionalNumber(item.groundedness) ?? 0,
        groundednessDetail: object(item.groundednessDetail),
        generationMetrics: normalizeGenerationMetrics(field(item, "generationMetrics", "generation_metrics")),
        experimentId: string(item.experimentId),
      }))
      : [],
  };
}

export async function listEvaluationRuns(datasetId: string, signal?: AbortSignal): Promise<EvaluationRun[]> {
  const payload = await request(`/evaluation/runs?datasetId=${encodeURIComponent(datasetId)}`, { signal });
  return listPayload(payload, "runs").map(normalizeEvaluationRun);
}

export async function getEvaluationRun(runId: string, signal?: AbortSignal): Promise<EvaluationRun> {
  return normalizeEvaluationRun(await request(`/evaluation/runs/${encodeURIComponent(runId)}`, { signal }));
}

export async function getChunkRun(runId: string, signal?: AbortSignal): Promise<ChunkRun> {
  return normalizeChunkRun(await request(`/chunk-runs/${encodeURIComponent(runId)}`, { signal }));
}

export async function getEmbeddingRun(runId: string, signal?: AbortSignal): Promise<EmbeddingRun> {
  return normalizeEmbeddingRun(await request(`/embedding-runs/${encodeURIComponent(runId)}`, { signal }));
}

export async function parsePersistedDocument(
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

export const reparsePersistedDocument = parsePersistedDocument;
