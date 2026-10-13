import { DocumentApiError, isDocumentParseResponse } from "@/lib/document-api";
import type { DocumentParseResponse, ParseRunStatus } from "@/lib/document-parse-types";
import type {
  AnswerSegment,
  ApiProblem,
  Capabilities,
  ChunkConfig,
  ChunkItem,
  ChunkRun,
  ChunkStrategy,
  ContextCandidate,
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
  GenerationMetricMethod,
  GenerationOutcome,
  GroundingFailureDetail,
  PersistedDocument,
  PersistedParseResponse,
  ParseRun,
  RetrievalScoreSemantics,
  RetrievalTimings,
  RetrievedCandidate,
  RerankedCandidate,
  RunStatus,
  RunSummary,
  StageRetrievalMetrics,
  StageRetrievalMetricsByStage,
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
    sourceExperimentId: optionalString(payload.sourceExperimentId),
    sourceDurationMs: optionalNumber(payload.sourceDurationMs),
  };
}

function normalizeStageIdentity(value: JsonObject) {
  return {
    fingerprint: optionalString(value.fingerprint),
    resultHash: optionalString(value.resultHash),
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
  const runMetadata = object(payload.runMetadata);
  const errorCode = optionalString(payload.errorCode);
  const errorMessage = optionalString(payload.errorMessage);
  const status = normalizeStatus(payload.status);
  const progress = optionalNumber(payload.progress ?? runMetadata.progress);
  const normalizedError = normalizeProblem(payload.error) ?? (errorCode && errorMessage ? { code: errorCode, message: errorMessage } : null);
  return {
    id: requiredString(payload.id, "run id"),
    runNumber: optionalNumber(payload.runNumber),
    phase: optionalString(payload.phase) ?? optionalString(runMetadata.phase),
    createdAt: optionalString(payload.createdAt),
    status,
    progress: progress ?? (status === "running" ? 8 : status === "queued" ? 0 : null),
    isStale: boolean(payload.isStale),
    isCompatible: boolean(payload.isCompatible, !boolean(payload.isStale)),
    compatibilityReason: optionalString(payload.compatibilityReason),
    historicalLineage: boolean(payload.historicalLineage),
    upstream: Object.fromEntries(Object.entries(upstream).map(([key, item]) => [key, optionalString(item)])),
    config,
    timing: {
      startedAt: optionalString(timing.startedAt ?? payload.startedAt),
      completedAt: optionalString(timing.completedAt ?? payload.completedAt),
      // Detay ve özet endpoint'leri farklı isimlendirme kullanabilir; süreyi uydurmadan ikisini de kabul et.
      durationMs: optionalNumber(timing.durationMs ?? payload.durationMs),
    },
    error: normalizedError ?? (payload.status === "interrupted" ? { code: "parse_interrupted", message: "The parse run was interrupted before completion." } : null),
    strategy: typeof payload.strategy === "string" ? normalizeChunkStrategy(payload.strategy) : null,
    chunkCount: optionalNumber(payload.chunkCount),
    model: optionalString(payload.model),
    dimensions: optionalNumber(payload.dimensions),
    embeddingFormatVersion: optionalString(payload.embeddingFormatVersion),
    embeddingCount: optionalNumber(payload.embeddingCount),
    effectiveModel: optionalString(payload.effectiveModel),
  };
}

function normalizeDocument(value: unknown): PersistedDocument {
  const payload = requiredObject(value, "document");
  return {
    id: requiredString(payload.id, "document id"),
    fileName: requiredString(payload.fileName, "document file name"),
    mediaType: requiredString(payload.mediaType, "document media type"),
    sizeBytes: requiredNumber(payload.sizeBytes, "document size"),
    pageCount: requiredNumber(payload.pageCount, "document page count"),
    sha256: optionalString(payload.sha256),
    activeParseRunId: optionalString(payload.activeParseRunId),
    activeChunkRunId: optionalString(payload.activeChunkRunId),
    activeEmbeddingRunId: optionalString(payload.activeEmbeddingRunId),
    latestParseStatus: (() => {
      const value = payload.latestParseStatus;
      return value === "queued" || value === "running" || value === "completed" || value === "failed" ? value : null;
    })(),
    latestParseError: normalizeProblem(payload.latestParseError),
    createdAt: optionalString(payload.createdAt),
    updatedAt: optionalString(payload.updatedAt),
  };
}

function normalizeChunk(value: unknown): ChunkItem {
  const payload = requiredObject(value, "chunk");
  return {
    id: requiredString(payload.id, "chunk id"),
    ordinal: requiredNumber(payload.ordinal, "chunk ordinal"),
    text: requiredString(payload.text, "chunk text"),
    pageNumbers: numbers(payload.pageNumbers),
    sourceElementIds: strings(payload.sourceElementIds),
    headingPath: strings(payload.headingPath),
    tokenCount: requiredNumber(payload.tokenCount, "chunk token count"),
    characterCount: requiredNumber(payload.characterCount, "chunk character count"),
  };
}

function normalizeRetrievedCandidate(value: unknown): RetrievedCandidate {
  const payload = requiredObject(value, "retrieval candidate");
  const denseScore = optionalNumber(payload.denseScore);
  const denseRank = optionalNumber(payload.denseRank);
  const keywordScore = optionalNumber(payload.keywordScore);
  const rrfScore = optionalNumber(payload.rrfScore);
  const fusionScore = optionalNumber(payload.fusionScore);
  return {
    chunkId: requiredString(payload.chunkId ?? payload.id, "retrieval chunk id"),
    rank: requiredNumber(payload.rank, "retrieval rank"),
    score: optionalNumber(payload.score) ?? fusionScore ?? rrfScore ?? denseScore ?? keywordScore,
    denseScore,
    denseRank,
    keywordScore,
    keywordRank: optionalNumber(payload.keywordRank),
    rrfScore,
    fusionScore,
    text: requiredString(payload.text ?? payload.preview, "retrieval candidate text"),
    documentId: requiredString(payload.documentId, "retrieval document id"),
    pageNumbers: numbers(payload.pageNumbers ?? payload.pages),
    sourceElementIds: strings(payload.sourceElementIds),
    headingPath: strings(payload.headingPath),
  };
}

function normalizeRerankedCandidate(value: unknown): RerankedCandidate {
  const payload = object(value);
  return {
    ...normalizeRetrievedCandidate(value),
    originalRank: requiredNumber(payload.originalRank ?? payload.retrievalRank ?? payload.rank, "original retrieval rank"),
    rerankRank: optionalNumber(payload.rerankRank ?? payload.rank),
    rerankScore: optionalNumber(payload.rerankScore),
    rankedBy: payload.rankedBy === "model" || payload.rankedBy === "retrieval_fallback" ? payload.rankedBy : null,
    rerankInputTruncated: typeof payload.rerankInputTruncated === "boolean" ? payload.rerankInputTruncated : null,
  };
}

const RETRIEVAL_SCORE_SEMANTICS: readonly RetrievalScoreSemantics[] = ["cosine_similarity", "postgres_ts_rank", "relative_min_max_fusion_within_candidate_pool"];

function normalizeScoreSemantics(value: unknown): RetrievalScoreSemantics | null {
  return RETRIEVAL_SCORE_SEMANTICS.find((item) => item === value) ?? null;
}

function normalizeRetrievalTimings(value: unknown): RetrievalTimings | null {
  const payload = object(value);
  if (Object.keys(payload).length === 0) return null;
  return {
    queryEmbeddingMs: optionalNumber(payload.queryEmbeddingMs),
    candidateQueryMs: optionalNumber(payload.candidateQueryMs),
    assemblyMs: optionalNumber(payload.assemblyMs),
  };
}

function normalizeGenerationOutcome(value: unknown): GenerationOutcome | null {
  return value === "answered" || value === "insufficient_context" || value === "grounding_rejected" ? value : null;
}

/** Segments are the validated answer units; pre-freeze payloads called them `claims`. */
function normalizeSegments(value: unknown): AnswerSegment[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .map((item) => object(item))
    .filter((item) => typeof item.text === "string" && item.text.trim().length > 0)
    .map((item) => ({ text: (item.text as string).trim(), citationIds: strings(item.citationIds) }));
}

function normalizeGroundingFailureDetail(value: unknown): GroundingFailureDetail | null {
  const payload = object(value);
  const code = optionalString(payload.code);
  if (!code) return null;
  return { code, token: optionalString(payload.token), attempts: optionalNumber(payload.attempts) };
}

function normalizeContextCandidate(value: unknown): ContextCandidate {
  const payload = requiredObject(value, "context candidate");
  return {
    chunkId: requiredString(payload.chunkId ?? payload.id, "context chunk id"),
    selected: boolean(payload.selected ?? payload.included),
    reason: string(payload.reason),
    tokenCount: requiredNumber(payload.tokenCount, "context token count"),
    text: requiredString(payload.text ?? payload.preview, "context candidate text"),
    pageNumbers: numbers(payload.pageNumbers ?? payload.pages),
    sourceElementIds: strings(payload.sourceElementIds),
  };
}

function normalizeCitation(value: unknown, fallbackValid = false): ValidatedCitation {
  const payload = requiredObject(value, "citation");
  return {
    citationId: requiredString(payload.citationId ?? payload.id, "citation id"),
    documentId: requiredString(payload.documentId, "citation document id"),
    chunkId: requiredString(payload.chunkId, "citation chunk id"),
    pageNumbers: numbers(payload.pageNumbers ?? payload.pages),
    quote: optionalString(payload.quote),
    valid: payload.valid === undefined && payload.isValid === undefined ? fallbackValid : boolean(payload.valid ?? payload.isValid),
    sourceElementIds: strings(payload.sourceElementIds),
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
  const rerankingOutput = reranking.results ?? reranking.candidates;
  const rerankingInput = reranking.inputCandidates;
  return {
    retrieval: Object.keys(retrieval).length === 0 ? null : {
      ...normalizeStageIdentity(retrieval),
      candidates: requiredArray(retrieval.candidates ?? retrieval.results, normalizeRetrievedCandidate, "retrieval results"),
      // `candidates` is the whole pool; `results` is the top-K list that reaches context.
      results: Array.isArray(retrieval.results) ? array(retrieval.results, normalizeRetrievedCandidate) : null,
      scoreSemantics: normalizeScoreSemantics(retrieval.scoreSemantics),
      timings: normalizeRetrievalTimings(retrieval.timings),
      durationMs: optionalNumber(retrieval.durationMs),
    },
    reranking: Object.keys(reranking).length === 0 ? null : {
      ...normalizeStageIdentity(reranking),
      // The ordered provider output is the result shown to users. Older
      // payloads without ``results`` fall back to their candidates field.
      candidates: requiredArray(rerankingOutput, normalizeRerankedCandidate, "reranking results"),
      inputCandidates: Array.isArray(rerankingInput) ? array(rerankingInput, normalizeRetrievedCandidate) : null,
      durationMs: optionalNumber(reranking.durationMs),
      method: optionalString(reranking.method ?? reranking.effectiveModel ?? reranking.model),
      rerankScoreSemantics: optionalString(reranking.rerankScoreSemantics),
      executed: reranking.status !== "skipped",
    },
    context: Object.keys(context).length === 0 ? null : {
      ...normalizeStageIdentity(context),
      candidates: array(context.candidates ?? context.selections ?? [...selectedContext, ...excludedContext], normalizeContextCandidate),
      finalContext: requiredText(context.finalContext ?? context.formattedContext ?? context.text, "final context"),
      tokenBudget: requiredNumber(context.tokenBudget, "context token budget"),
      tokenCount: requiredNumber(context.tokenCount ?? context.localTokenCount ?? context.usedTokens, "context token count"),
      durationMs: optionalNumber(context.durationMs),
    },
    generation: Object.keys(generation).length === 0 ? null : {
      ...normalizeStageIdentity(generation),
      answer: typeof generation.answer === "string" ? generation.answer : invalidResponse("The backend response is missing the generated answer."),
      citations: requiredArray(generation.citations, (item) => normalizeCitation(item, generationValidity), "generation citations"),
      model: optionalString(generation.effectiveModel ?? generation.configuredModel ?? generation.model),
      inputTokens: optionalNumber(generation.inputTokens),
      outputTokens: optionalNumber(generation.outputTokens),
      durationMs: optionalNumber(generation.durationMs),
      insufficientContext: boolean(generation.insufficientContext),
      outcome: normalizeGenerationOutcome(generation.outcome),
      segments: normalizeSegments(generation.segments ?? generation.claims),
      groundingFailureDetail: normalizeGroundingFailureDetail(generation.groundingFailureDetail),
    },
  };
}

function normalizeStageRetrievalMetrics(value: unknown): StageRetrievalMetricsByStage | null {
  const payload = object(value);
  if (Object.keys(payload).length === 0) return null;
  const stage = (item: unknown): StageRetrievalMetrics | null => {
    const metrics = object(item);
    if (Object.keys(metrics).length === 0) return null;
    return {
      hitAtK: optionalNumber(metrics.hitAtK),
      precisionAtK: optionalNumber(metrics.precisionAtK),
      recallAtK: optionalNumber(metrics.recallAtK),
      mrr: optionalNumber(metrics.mrr),
      eligibleCaseCount: optionalNumber(metrics.eligibleCaseCount),
    };
  };
  return { retrieval: stage(payload.retrieval), reranking: stage(payload.reranking), context: stage(payload.context) };
}

function normalizeFailedCaseCodes(value: unknown): Array<{ code: string; count: number }> {
  return array(value, (item) => {
    const payload = object(item);
    return { code: string(payload.code), count: optionalNumber(payload.count) ?? 0 };
  }).filter((item) => item.code.length > 0);
}

function normalizeMetrics(value: unknown): EvaluationMetrics {
  const payload = object(value);
  const metrics = object(payload.aggregate ?? payload.metrics ?? payload);
  const generationMetricsPayload = metrics.generationMetrics ?? payload.generationMetrics;
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
    // Additive aggregate fields; a missing value stays null, never a measured 0.
    completedCaseCount: optionalNumber(metrics.completedCaseCount),
    failedCaseCount: optionalNumber(metrics.failedCaseCount),
    failedCaseCodes: normalizeFailedCaseCodes(metrics.failedCaseCodes),
    retrievalMetricsStage: optionalString(metrics.retrievalMetricsStage),
    stageRetrievalMetrics: normalizeStageRetrievalMetrics(metrics.stageRetrievalMetrics),
    citationValidityEligibleCaseCount: optionalNumber(metrics.citationValidityEligibleCaseCount),
    answerableCaseCount: optionalNumber(metrics.answerableCaseCount),
    falseAbstentionRate: optionalNumber(metrics.falseAbstentionRate),
    groundingRejectedCaseCount: optionalNumber(metrics.groundingRejectedCaseCount),
  };
}

function normalizeMetricMethod(value: unknown): GenerationMetricMethod | null {
  return value === "gemini_generation_metrics_v2" || value === "citation_token_overlap_v1" || value === "mixed" ? value : null;
}

function normalizeGenerationMetrics(value: unknown): EvaluationGenerationMetrics | null {
  const metrics = object(value);
  if (Object.keys(metrics).length === 0) return null;
  return {
    faithfulness: optionalNumber(metrics.faithfulness),
    answerRelevance: optionalNumber(metrics.answerRelevance),
    answerCorrectness: optionalNumber(metrics.answerCorrectness),
    eligibleCaseCount: optionalNumber(metrics.eligibleCaseCount),
    scoredCaseCount: optionalNumber(metrics.scoredCaseCount),
    lexicalOverlap: optionalNumber(metrics.lexicalOverlap),
    method: normalizeMetricMethod(metrics.method),
    metricVersion: optionalString(metrics.metricVersion),
    lexicalScoredCaseCount: optionalNumber(metrics.lexicalScoredCaseCount),
    skippedCaseCount: optionalNumber(metrics.skippedCaseCount),
    skippedReason: optionalString(metrics.skippedReason),
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
  const documentId = optionalString(payload.documentId)
    ?? optionalString(document.id)
    ?? fallbackDocumentId;
  const parseRunId = optionalString(payload.parseRunId)
    ?? optionalString(payload.id)
    ?? fallbackParseRunId;
  if (!parseRunId) invalidResponse("The parse response is missing the parse run id.");
  const rawStatus = payload.status ?? (result ? "completed" : null);
  const status = normalizeParseStatus(rawStatus);
  const runMetadata = object(payload.runMetadata);
  const reusedDocument = boolean(payload.reusedDocument);
  const progress = normalizeProgress(payload.progress ?? runMetadata.progress, status);
  const problem = normalizeProblem(payload.error)
    ?? ((status === "failed" || payload.status === "interrupted") && optionalString(payload.errorCode)
      ? {
        code: optionalString(payload.errorCode) ?? "parse_failed",
        message: optionalString(payload.errorMessage) ?? "The parse run failed.",
      }
      : null)
    ?? (payload.status === "interrupted" ? { code: "parse_interrupted", message: "The parse run was interrupted before completion." } : null);
  const normalizedResult = result
    ? normalizePersistedParseResponse({
      ...result,
      documentId: payload.documentId ?? (result as DocumentParseResponse & { documentId?: string | null }).documentId ?? documentId,
      parseRunId: payload.parseRunId ?? parseRunId,
      status: "completed",
      runMetadata: payload.runMetadata ?? null,
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

export const RUN_POLL_TIMEOUT_MS = 15 * 60 * 1_000;
/** Status polls back off from 1 s to 5 s; a run that changes resets to the fast interval. */
export const RUN_POLL_INTERVALS_MS = [1_000, 1_000, 2_000, 2_000, 5_000] as const;
/** Upper bound for one non-polling request; long synchronous POSTs (chunk/embedding, and continue/rerun-generation, which run inline outside hosted environments) get more time. */
export const REQUEST_TIMEOUT_MS = 30_000;
export const LONG_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000;

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function waitForPoll(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The run poll was aborted.", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException("The run poll was aborted.", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isTransientPollError(error: unknown) {
  if (!(error instanceof DocumentApiError)) return false;
  // Only network/timeout failures and retryable HTTP statuses are transient; an
  // invalid payload (no HTTP status) must fail instead of being polled forever.
  return error.code === "backend_unavailable" || error.code === "request_timeout" || error.status === 408 || error.status === 429 || (error.status !== null && error.status >= 500);
}

type RunPollOptions<TStatus extends { status: string }, TDetail extends { status: string }> = {
  /** Lightweight status read; may be the detail read itself when no status endpoint exists. */
  readStatus: (signal: AbortSignal) => Promise<TStatus>;
  /** Full detail read. Called only when the status changed or the run is terminal. */
  readDetail: (signal: AbortSignal) => Promise<TDetail>;
  /** Fingerprint of the status payload; a change triggers a detail read and resets the backoff. */
  progressKey: (status: TStatus) => string;
  initialDetail?: TDetail;
  signal?: AbortSignal;
  onProgress?: (detail: TDetail) => void;
  timeoutMs?: number;
  timeoutError: () => DocumentApiError;
};

/**
 * Single polling loop for parse, experiment and evaluation runs. It polls the
 * lightweight status with an increasing interval, fetches the detail only
 * when progress changes, tolerates transient failures (a temporary outage
 * must not turn a running job into a false failure) and stops after a
 * deadline without changing the durable backend status.
 */
async function pollRun<TStatus extends { status: string }, TDetail extends { status: string }>(
  options: RunPollOptions<TStatus, TDetail>,
): Promise<TDetail> {
  const { readStatus, readDetail, progressKey, signal, onProgress } = options;
  const timeoutMs = options.timeoutMs ?? RUN_POLL_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let detail = options.initialDetail;
  if (detail && !isRunInFlight(detail.status)) return detail;
  let lastKey: string | null = null;
  let quietPolls = detail ? 0 : -1;
  let failures = 0;
  const pollSignal = signal ?? new AbortController().signal;
  const statusIsDetail = (readStatus as unknown) === (readDetail as unknown);
  while (true) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) throw options.timeoutError();
    const delay = failures
      ? Math.min(2_000 * 2 ** Math.min(failures - 1, 3), 10_000)
      : quietPolls < 0 ? 0 : RUN_POLL_INTERVALS_MS[Math.min(quietPolls, RUN_POLL_INTERVALS_MS.length - 1)];
    if (delay) await waitForPoll(Math.min(delay, Math.max(0, deadline - Date.now())), signal);
    if (Date.now() >= deadline) throw options.timeoutError();
    try {
      const status = await readStatus(pollSignal);
      signal?.throwIfAborted();
      failures = 0;
      const key = progressKey(status);
      const terminal = !isRunInFlight(status.status);
      if (terminal || key !== lastKey) {
        detail = statusIsDetail ? status as unknown as TDetail : await readDetail(pollSignal);
        signal?.throwIfAborted();
        onProgress?.(detail);
        quietPolls = 0;
        lastKey = key;
        if (!isRunInFlight(detail.status)) return detail;
      } else {
        quietPolls += 1;
      }
    } catch (error) {
      if (!isTransientPollError(error)) throw error;
      failures += 1;
    }
  }
}

function isRunInFlight(status: string) {
  return status === "queued" || status === "running";
}

function parsePollTimeoutError() {
  return new DocumentApiError(
    "parse_poll_timeout",
    "The parse is still running, but browser polling stopped after 15 minutes. Refresh to resume status checks.",
  );
}

function runPollTimeoutError() {
  return new DocumentApiError("run_poll_timeout", "Browser tracking paused after 15 minutes. Resume tracking to check this run; its backend status is unchanged.");
}

function completedParseResult(run: ParseRun): PersistedParseResponse {
  if (run.status === "failed") {
    const problem = run.error ?? { code: "parse_failed", message: "The parse run failed." };
    throw new DocumentApiError(problem.code, problem.message);
  }
  if (!run.result) throw new DocumentApiError("invalid_response", "The completed parse run returned no normalized content.");
  return run.result;
}

/** Parse runs have no separate status endpoint; an in-flight run payload is already small. */
function pollParseRun(
  parseRunId: string,
  documentId: string | null,
  signal?: AbortSignal,
  onStatus?: ParseStatusListener,
  initial?: ParseRun,
  timeoutMs = RUN_POLL_TIMEOUT_MS,
) {
  const read = (pollSignal: AbortSignal) => getParseRun(parseRunId, pollSignal, documentId);
  return pollRun<ParseRun, ParseRun>({
    readStatus: read,
    readDetail: read,
    progressKey: (run) => `${run.status}:${run.progress}:${typeof run.runMetadata?.phase === "string" ? run.runMetadata.phase : ""}`,
    initialDetail: initial,
    signal,
    onProgress: onStatus,
    timeoutMs,
    timeoutError: parsePollTimeoutError,
  });
}

export async function waitForParseRun(
  parseRunId: string,
  signal?: AbortSignal,
  documentId?: string | null,
  onStatus?: ParseStatusListener,
  timeoutMs = RUN_POLL_TIMEOUT_MS,
): Promise<PersistedParseResponse> {
  return completedParseResult(await pollParseRun(parseRunId, documentId ?? null, signal, onStatus, undefined, timeoutMs));
}

function normalizeChunkRun(value: unknown): ChunkRun {
  const payload = requiredObject(value, "chunk run");
  const run = normalizeRun(payload);
  const chunks = requiredArray(payload.chunks, normalizeChunk, "chunk results");
  const chunkCount = requiredNumber(payload.chunkCount, "chunk count");
  if (run.status === "completed" && chunkCount !== chunks.length) invalidResponse("The completed chunk run count does not match its chunk results.");
  return {
    ...run,
    documentId: requiredString(payload.documentId, "chunk document id"),
    parseRunId: requiredString(payload.parseRunId, "chunk parse run id"),
    strategy: normalizeChunkStrategy(payload.strategy),
    chunkCount,
    chunks,
    reusedArtifact: boolean(payload.reusedArtifact),
  };
}

function normalizeEmbeddingRun(value: unknown): EmbeddingRun {
  const payload = requiredObject(value, "embedding run");
  const run = normalizeRun(payload);
  const documentId = requiredString(payload.documentId, "embedding document id");
  const chunkRunId = requiredString(payload.chunkRunId, "embedding chunk run id");
  return {
    ...run,
    // The run detail endpoint sends lineage as flat fields (no `upstream`); lineage checks read `upstream`.
    upstream: { ...run.upstream, documentId: run.upstream.documentId ?? documentId, chunkRunId: run.upstream.chunkRunId ?? chunkRunId },
    documentId,
    chunkRunId,
    model: requiredString(payload.model, "embedding model"),
    dimensions: requiredNumber(payload.dimensions, "embedding dimensions"),
    embeddingFormatVersion: requiredString(payload.embeddingFormatVersion, "embedding format version"),
    // Only a completed run must carry its final vector count; an accepted (queued/running) run has none yet.
    embeddingCount: run.status === "completed" ? requiredNumber(payload.embeddingCount, "embedding count") : optionalNumber(payload.embeddingCount) ?? 0,
    effectiveModel: optionalString(payload.effectiveModel),
    reusedArtifact: boolean(payload.reusedArtifact),
  };
}

function normalizeExperiment(value: unknown): ExperimentRun {
  const payload = requiredObject(value, "experiment run");
  const run = normalizeRun(payload);
  const targetStage = normalizeTargetStage(payload.targetStage);
  const stageResults = normalizeStageResults(payload.stageResults);
  if (run.status === "completed") {
    if (!stageResults.retrieval) invalidResponse("The completed experiment is missing retrieval results.");
    if ((targetStage === "reranking" || targetStage === "context" || targetStage === "generation") && !stageResults.reranking) invalidResponse("The completed experiment is missing reranking results.");
    if ((targetStage === "context" || targetStage === "generation") && !stageResults.context) invalidResponse("The completed experiment is missing context results.");
    if (targetStage === "generation" && !stageResults.generation) invalidResponse("The completed experiment is missing generation results.");
  }
  return {
    ...run,
    documentId: requiredString(payload.documentId, "experiment document id"),
    chunkRunId: requiredString(payload.chunkRunId, "experiment chunk run id"),
    embeddingRunId: optionalString(payload.embeddingRunId),
    query: requiredString(payload.query, "experiment query"),
    targetStage,
    stageResults,
    experimentFingerprint: optionalString(payload.experimentFingerprint),
    reusedExperiment: boolean(payload.reusedExperiment),
    continuedFromExperimentId: optionalString(payload.continuedFromExperimentId),
    generationRerun: boolean(payload.generationRerun),
    queueDurationMs: optionalNumber(payload.queueDurationMs ?? object(payload.timing).queueDurationMs),
  };
}

function normalizeExperimentSummary(value: unknown): ExperimentSummary {
  const payload = requiredObject(value, "experiment summary");
  const run = normalizeRun(payload);
  const rawStageStatuses = object(payload.stageStatuses);
  const stageStatuses: ExperimentSummary["stageStatuses"] = {};
  for (const stage of ["retrieval", "reranking", "context", "generation"] as const) {
    const status = rawStageStatuses[stage];
    if (status === "completed" || status === "skipped") stageStatuses[stage] = status;
  }
  return {
    ...run,
    documentId: requiredString(payload.documentId, "experiment document id"),
    chunkRunId: requiredString(payload.chunkRunId, "experiment chunk run id"),
    embeddingRunId: optionalString(payload.embeddingRunId),
    query: string(payload.query),
    targetStage: normalizeTargetStage(payload.targetStage),
    candidateCount: optionalNumber(payload.candidateCount),
    experimentFingerprint: optionalString(payload.experimentFingerprint),
    stageStatuses,
  };
}

function normalizeEvaluationRunSummary(value: unknown): EvaluationRunSummary {
  const payload = requiredObject(value, "evaluation run summary");
  const timing = object(payload.timing);
  return {
    id: requiredString(payload.id, "evaluation run id"),
    createdAt: optionalString(payload.createdAt),
    datasetId: requiredString(payload.datasetId, "evaluation dataset id"),
    parseRunId: requiredString(payload.parseRunId, "evaluation parse run id"),
    chunkRunId: optionalString(payload.chunkRunId),
    embeddingRunId: optionalString(payload.embeddingRunId),
    status: normalizeStatus(payload.status),
    timing: {
      startedAt: optionalString(timing.startedAt),
      completedAt: optionalString(timing.completedAt),
      durationMs: optionalNumber(timing.durationMs),
    },
    error: normalizeProblem(payload.error),
  };
}

function normalizeDocumentPipeline(value: unknown): DocumentPipeline {
  const payload = requiredObject(value, "document pipeline");
  return {
    id: requiredString(payload.id, "document pipeline id"),
    documentId: requiredString(payload.documentId, "pipeline document id"),
    name: requiredString(payload.name, "pipeline name"),
    parseRunId: optionalString(payload.parseRunId),
    chunkRunId: optionalString(payload.chunkRunId),
    embeddingRunId: optionalString(payload.embeddingRunId),
    revision: requiredNumber(payload.revision, "pipeline revision"),
    isDefault: Boolean(payload.isDefault),
    createdAt: optionalString(payload.createdAt),
    updatedAt: optionalString(payload.updatedAt),
  };
}

function normalizeDatasetSummary(value: unknown): EvaluationDatasetSummary {
  const payload = requiredObject(value, "evaluation dataset summary");
  return {
    id: requiredString(payload.id, "evaluation dataset id"),
    documentId: requiredString(payload.documentId, "evaluation document id"),
    parseRunId: requiredString(payload.parseRunId, "evaluation parse run id"),
    name: requiredString(payload.name, "evaluation dataset name"),
    version: requiredNumber(payload.version, "evaluation dataset version"),
    seriesId: optionalString(payload.seriesId),
    caseCount: requiredNumber(payload.caseCount, "evaluation dataset case count"),
    createdAt: optionalString(payload.createdAt),
  };
}

function listPayload(value: unknown, key: string): unknown[] {
  if (Array.isArray(value)) return value;
  const payload = requiredObject(value, `${key} list envelope`);
  const items = payload[key] ?? payload.items;
  if (!Array.isArray(items)) invalidResponse(`The backend response is missing the ${key} list.`);
  return items;
}

type RequestOptions = RequestInit & { timeoutMs?: number };

/**
 * Aborts when any source aborts; avoids AbortSignal.any for older Safari.
 * `dispose` detaches the listeners so a long-lived caller signal (run polling)
 * does not accumulate one listener per finished request.
 */
function anySignal(signals: AbortSignal[]) {
  const controller = new AbortController();
  const dispose = () => signals.forEach((item) => item.removeEventListener("abort", abort));
  const abort = () => {
    controller.abort();
    dispose();
  };
  if (signals.some((item) => item.aborted)) controller.abort();
  else signals.forEach((item) => item.addEventListener("abort", abort, { once: true }));
  return { signal: controller.signal, dispose };
}

/**
 * The single authenticated JSON client for the RAG API. Every request has a
 * deadline so a hung connection cannot leave a stage "processing" forever.
 */
async function request(path: string, init: RequestOptions = {}): Promise<unknown> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, signal, ...fetchInit } = init;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const combined = signal ? anySignal([signal, deadline.signal]) : null;
  const requestSignal = combined?.signal ?? deadline.signal;
  const timedOut = () => deadline.signal.aborted && !signal?.aborted;
  const timeoutError = () => new DocumentApiError("request_timeout", "The RAG backend did not respond in time.");
  try {
    let response: Response;
    try {
      const accessToken = await getSupabaseAccessToken();
      if (!accessToken) throw new DocumentApiError("auth_required", "Oturum açmanız gerekiyor.");
      const headers = new Headers(fetchInit.headers);
      if (!(fetchInit.body instanceof FormData)) headers.set("Content-Type", "application/json");
      headers.set("Authorization", `Bearer ${accessToken}`);
      response = await fetch(`${getApiBaseUrl()}${path}`, { ...fetchInit, headers, signal: requestSignal });
    } catch (error) {
      if (isAbortError(error)) throw timedOut() ? timeoutError() : error;
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
    } catch (error) {
      if (isAbortError(error)) throw timedOut() ? timeoutError() : error;
      if (response.ok) throw new DocumentApiError("invalid_response", "The backend returned invalid JSON.", response.status);
    }

    if (!response.ok) {
      const problem = normalizeProblem(object(payload).error);
      throw new DocumentApiError(problem?.code ?? "unknown", problem?.message ?? "The RAG backend returned an error.", response.status);
    }
    return payload;
  } finally {
    clearTimeout(timer);
    combined?.dispose();
  }
}

export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const payload = requiredObject(await request("/capabilities", { signal }), "capabilities");
  return {
    embeddingModel: requiredString(payload.embeddingModel, "embedding model capability"),
    embeddingDimensions: requiredNumber(payload.embeddingDimensions, "embedding dimension capability"),
    generationModel: requiredString(payload.generationModel, "generation model capability"),
    rerankModel: requiredString(payload.rerankModel, "rerank model capability"),
    judgeModel: requiredString(payload.judgeModel, "judge model capability"),
    embeddingFormatVersion: requiredString(payload.embeddingFormatVersion, "embedding format capability"),
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
  const payload = requiredObject(await request("/documents", { method: "POST", body: formData, signal, timeoutMs: LONG_REQUEST_TIMEOUT_MS }), "document upload response");
  return {
    document: normalizeDocument(payload.document),
    reusedDocument: payload.reusedDocument === true,
  };
}

export async function deleteDocument(documentId: string, signal?: AbortSignal): Promise<void> {
  await request(`/documents/${encodeURIComponent(documentId)}`, { method: "DELETE", signal });
}

/**
 * The summary endpoint is the only document workspace contract. A normalizer
 * failure or a missing document surfaces as an error instead of silently
 * falling back to another endpoint with synthesized values.
 *
 * `historicalLineage` on each run is computed by the backend relative to the
 * given saved pipeline (Default Pipeline when omitted). A pipeline deleted in
 * the meantime falls back to the default instead of failing the whole load.
 */
export async function getDocumentSummary(
  documentId: string,
  signal?: AbortSignal,
  pipelineId?: string | null,
): Promise<DocumentSummary> {
  const path = `/documents/${encodeURIComponent(documentId)}/summary`;
  let raw: unknown;
  try {
    raw = await request(pipelineId ? `${path}?pipelineId=${encodeURIComponent(pipelineId)}` : path, { signal });
  } catch (error) {
    if (!pipelineId || !(error instanceof DocumentApiError) || error.code !== "document_pipeline_not_found") throw error;
    raw = await request(path, { signal });
  }
  const payload = requiredObject(raw, "document summary");
  return {
    ...normalizeDocument(payload),
    parseRuns: requiredArray(payload.parseRuns, normalizeRun, "parse run history"),
    chunkRuns: requiredArray(payload.chunkRuns, normalizeRun, "chunk run history"),
    embeddingRuns: requiredArray(payload.embeddingRuns, normalizeRun, "embedding run history"),
    experiments: requiredArray(payload.experiments, normalizeExperimentSummary, "experiment history"),
    evaluationDatasets: requiredArray(payload.evaluationDatasets, normalizeDatasetSummary, "evaluation dataset history"),
    evaluationRuns: requiredArray(payload.evaluationRuns ?? [], normalizeEvaluationRunSummary, "evaluation run history"),
  };
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
  return normalizeParseRun(
    await request(`/parse-runs/${encodeURIComponent(runId)}`, { signal }),
    documentId ?? null,
    runId,
  );
}

export async function createChunkRun(documentId: string, strategy: ChunkStrategy, config: ChunkConfig, parseRunId: string, signal?: AbortSignal): Promise<ChunkRun> {
  const payload = await request(`/documents/${encodeURIComponent(documentId)}/chunks`, {
    method: "POST",
    body: JSON.stringify({ parseRunId, strategy, config }),
    signal,
    timeoutMs: LONG_REQUEST_TIMEOUT_MS,
  });
  return normalizeChunkRun(payload);
}

/**
 * Creates (or reuses) an embedding run and resolves only with a completed run.
 * `?async=true` lets the hosted API answer with 202 right after dispatch
 * instead of holding an API container while the worker computes; the
 * accepted run is polled via `GET /embedding-runs/{id}` until it is terminal.
 * A reused or locally computed run still arrives as a completed 200. A failed
 * run rejects, so callers never record a non-completed embedding in the lineage.
 */
export async function createEmbeddingRun(
  documentId: string,
  chunkRunId: string,
  signal?: AbortSignal,
  onProgress?: (run: EmbeddingRun) => void,
): Promise<EmbeddingRun> {
  const payload = await request(`/documents/${encodeURIComponent(documentId)}/embeddings?async=true`, {
    method: "POST",
    body: JSON.stringify({ chunkRunId }),
    signal,
    timeoutMs: LONG_REQUEST_TIMEOUT_MS,
  });
  const initial = normalizeEmbeddingRun(payload);
  const run = isRunInFlight(initial.status) ? await waitForEmbeddingRun(initial.id, signal, onProgress, initial) : initial;
  if (run.status === "completed") return run;
  const problem = run.error ?? { code: "embedding_run_failed", message: "The embedding run failed." };
  throw new DocumentApiError(problem.code, problem.message);
}

/** Embedding runs have no separate status endpoint; the run payload carries no vectors. */
export function waitForEmbeddingRun(
  runId: string,
  signal?: AbortSignal,
  onProgress?: (run: EmbeddingRun) => void,
  initialRun?: EmbeddingRun,
): Promise<EmbeddingRun> {
  const read = (pollSignal: AbortSignal) => getEmbeddingRun(runId, pollSignal);
  return pollRun<EmbeddingRun, EmbeddingRun>({
    readStatus: read,
    readDetail: read,
    progressKey: (run) => `${run.status}:${run.progress ?? ""}`,
    initialDetail: initialRun,
    signal,
    onProgress,
    timeoutError: runPollTimeoutError,
  });
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

type ExperimentStatus = { id: string; status: RunStatus; stageStatuses: Record<string, string> };

async function getExperimentStatus(experimentId: string, signal?: AbortSignal): Promise<ExperimentStatus> {
  const payload = requiredObject(await request(`/experiments/${encodeURIComponent(experimentId)}/status`, { signal }), "experiment status");
  return {
    id: requiredString(payload.id, "experiment status id"),
    status: normalizeStatus(payload.status),
    stageStatuses: Object.fromEntries(Object.entries(object(payload.stageStatuses)).filter(([, value]) => typeof value === "string")) as Record<string, string>,
  };
}

export async function waitForExperimentRun(
  experimentId: string,
  signal?: AbortSignal,
  onProgress?: (run: ExperimentRun) => void,
  initialRun?: ExperimentRun,
): Promise<ExperimentRun> {
  return pollRun<ExperimentStatus, ExperimentRun>({
    readStatus: (pollSignal) => getExperimentStatus(experimentId, pollSignal),
    readDetail: (pollSignal) => getExperiment(experimentId, pollSignal),
    progressKey: (status) => `${status.status}:${Object.entries(status.stageStatuses).map(([stage, value]) => `${stage}=${value}`).sort().join(",")}`,
    initialDetail: initialRun,
    signal,
    onProgress,
    timeoutError: runPollTimeoutError,
  });
}

export async function getExperiment(experimentId: string, signal?: AbortSignal): Promise<ExperimentRun> {
  return normalizeExperiment(await request(`/experiments/${encodeURIComponent(experimentId)}`, { signal }));
}

export async function continueExperiment(experimentId: string, signal?: AbortSignal): Promise<ExperimentRun> {
  const run = normalizeExperiment(await request(`/experiments/${encodeURIComponent(experimentId)}/continue`, { method: "POST", signal, timeoutMs: LONG_REQUEST_TIMEOUT_MS }));
  return waitForExperimentRun(run.id, signal, undefined, run);
}

export async function rerunGeneration(experimentId: string, signal?: AbortSignal): Promise<ExperimentRun> {
  const run = normalizeExperiment(await request(`/experiments/${encodeURIComponent(experimentId)}/rerun-generation`, { method: "POST", signal, timeoutMs: LONG_REQUEST_TIMEOUT_MS }));
  return waitForExperimentRun(run.id, signal, undefined, run);
}

export async function createEvaluationDataset(input: { documentId: string; parseRunId: string; name: string; cases: EvaluationCase[]; baseDatasetId?: string | null; evaluationMode?: "interactive" | "benchmark" }, signal?: AbortSignal): Promise<EvaluationDataset> {
  const payload = object(await request("/evaluation/datasets", { method: "POST", body: JSON.stringify(input), signal }));
  return normalizeDataset(payload);
}

function normalizeDataset(value: unknown): EvaluationDataset {
  const payload = requiredObject(value, "evaluation dataset");
  return {
    id: requiredString(payload.id, "evaluation dataset id"),
    documentId: requiredString(payload.documentId, "evaluation document id"),
    parseRunId: requiredString(payload.parseRunId, "evaluation parse run id"),
    name: requiredString(payload.name, "evaluation dataset name"),
    version: requiredNumber(payload.version, "evaluation dataset version"),
    seriesId: optionalString(payload.seriesId),
    cases: requiredArray(payload.cases, (item) => {
      const evaluationCase = requiredObject(item, "evaluation case");
      return {
        question: requiredString(evaluationCase.question, "evaluation question"),
        relevantElementIds: strings(evaluationCase.relevantElementIds),
        referenceAnswer: optionalString(evaluationCase.referenceAnswer),
        expectedOutcome: evaluationCase.expectedOutcome === "insufficient_context" ? "insufficient_context" : "answer",
      };
    }, "evaluation cases"),
    createdAt: optionalString(payload.createdAt),
  };
}

export async function listEvaluationDatasets(documentId: string, signal?: AbortSignal): Promise<EvaluationDatasetSummary[]> {
  const payload = await request(`/evaluation/datasets?documentId=${encodeURIComponent(documentId)}`, { signal });
  return listPayload(payload, "datasets").map(normalizeDatasetSummary);
}

export async function getEvaluationDataset(datasetId: string, signal?: AbortSignal): Promise<EvaluationDataset> {
  return normalizeDataset(await request(`/evaluation/datasets/${encodeURIComponent(datasetId)}`, { signal }));
}

export type EvaluationRunRequest = {
  datasetId: string;
  pipelineId?: string | null;
  chunkRunId: string;
  embeddingRunId: string | null;
  retrieval: ExperimentRequest["retrieval"];
  reranking: ExperimentRequest["reranking"];
  context: ExperimentRequest["context"];
  generation: ExperimentRequest["generation"];
  judge: boolean;
};

export async function createEvaluationRunAsync(
  input: EvaluationRunRequest,
  signal?: AbortSignal,
  onProgress?: (run: EvaluationRun) => void,
): Promise<EvaluationRun> {
  const run = normalizeEvaluationRun(await request("/evaluation/runs?async=true", { method: "POST", body: JSON.stringify(input), signal }));
  onProgress?.(run);
  return waitForEvaluationRun(run.id, signal, onProgress, run);
}

type EvaluationRunStatus = { id: string; status: RunStatus; completedCases: number | null };

async function getEvaluationRunStatus(runId: string, signal?: AbortSignal): Promise<EvaluationRunStatus> {
  const payload = requiredObject(await request(`/evaluation/runs/${encodeURIComponent(runId)}/status`, { signal }), "evaluation run status");
  return {
    id: requiredString(payload.id, "evaluation run status id"),
    status: normalizeStatus(payload.status),
    completedCases: optionalNumber(payload.completedCases),
  };
}

export async function waitForEvaluationRun(
  runId: string,
  signal?: AbortSignal,
  onProgress?: (run: EvaluationRun) => void,
  initialRun?: EvaluationRun,
): Promise<EvaluationRun> {
  return pollRun<EvaluationRunStatus, EvaluationRun>({
    readStatus: (pollSignal) => getEvaluationRunStatus(runId, pollSignal),
    readDetail: (pollSignal) => getEvaluationRun(runId, pollSignal),
    progressKey: (status) => `${status.status}:${status.completedCases ?? ""}`,
    initialDetail: initialRun,
    signal,
    onProgress,
    timeoutError: runPollTimeoutError,
  });
}

function normalizeEvaluationRun(value: unknown): EvaluationRun {
  const payload = requiredObject(value, "evaluation run");
  const resultsPayload = requiredObject(payload.results, "evaluation results");
  const rawCaseResults = resultsPayload.caseResults;
  return {
    ...normalizeRun(payload),
    datasetId: requiredString(payload.datasetId, "evaluation dataset id"),
    results: normalizeMetrics(resultsPayload),
    caseResults: Array.isArray(rawCaseResults)
      ? rawCaseResults.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).map((item) => ({
        question: string(item.question),
        expectedElementIds: strings(item.expectedElementIds),
        retrievedElementIds: strings(item.retrievedElementIds),
        referenceAnswer: optionalString(item.referenceAnswer),
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
        // A missing metric stays null: "not scored", never a measured 0.
        citationValidity: optionalNumber(item.citationValidity),
        groundedness: optionalNumber(item.groundedness),
        groundednessDetail: object(item.groundednessDetail),
        generationMetrics: normalizeGenerationMetrics(item.generationMetrics),
        experimentId: string(item.experimentId),
        status: item.status === "failed" ? "failed" : "completed",
        errorCode: optionalString(item.errorCode),
        errorMessage: optionalString(item.errorMessage),
        generationOutcome: normalizeGenerationOutcome(item.generationOutcome),
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
  return completedParseResult(await pollParseRun(initial.id, initial.documentId || documentId, signal, onStatus, initial));
}

export const reparsePersistedDocument = parsePersistedDocument;
