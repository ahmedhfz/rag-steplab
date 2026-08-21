import type { DocumentParseResponse, ParseRunStatus } from "@/lib/document-parse-types";

export type RunStatus = ParseRunStatus;
export type ChunkStrategy = "fixed_token" | "recursive_token" | "structure_aware";
export type RetrievalMode = "dense" | "keyword" | "hybrid";
export type ExperimentTargetStage = "retrieval" | "reranking" | "context" | "generation";

export type ApiProblem = {
  code: string;
  message: string;
};

export type ParseRun = {
  id: string;
  documentId: string;
  status: ParseRunStatus;
  progress: number;
  result: PersistedParseResponse | null;
  error: ApiProblem | null;
  runMetadata: Record<string, unknown> | null;
};

export type RunTiming = {
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
};

export type RunSummary = {
  id: string;
  status: RunStatus;
  progress: number | null;
  isStale: boolean;
  isCompatible: boolean;
  compatibilityReason: string | null;
  historicalLineage: boolean;
  upstream: Record<string, string | null>;
  config: Record<string, unknown>;
  timing: RunTiming;
  error: ApiProblem | null;
};

export type PersistedDocument = {
  id: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  pageCount: number;
  sha256: string | null;
  activeParseRunId: string | null;
  activeChunkRunId: string | null;
  activeEmbeddingRunId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DocumentDetail = PersistedDocument & {
  parseRuns: RunSummary[];
  chunkRuns: RunSummary[];
  embeddingRuns: RunSummary[];
  experiments: RunSummary[];
  activeParseRun: PersistedParseResponse | null;
};

export type PersistedParseResponse = DocumentParseResponse & {
  documentId: string | null;
  parseRunId: string | null;
  status: "completed";
  runMetadata: Record<string, unknown> | null;
};

export type ChunkConfig = {
  chunkSizeTokens: number;
  overlapTokens: number;
};

export type ChunkItem = {
  id: string;
  ordinal: number;
  text: string;
  pageNumbers: number[];
  sourceElementIds: string[];
  headingPath: string[];
  tokenCount: number;
  characterCount: number;
};

export type ChunkRun = RunSummary & {
  documentId: string;
  parseRunId: string;
  strategy: ChunkStrategy;
  chunkCount: number;
  chunks: ChunkItem[];
};

export type EmbeddingRun = RunSummary & {
  documentId: string;
  chunkRunId: string;
  model: string;
  dimensions: number;
  embeddingFormatVersion: string;
  embeddingCount: number;
};

export type RetrievalConfig = {
  mode: RetrievalMode;
  topK: number;
};

export type RerankingConfig = {
  enabled: boolean;
  candidateCount: number;
};

export type ContextConfig = {
  tokenBudget: number;
};

export type GenerationConfig = {
  temperature: number;
  maxOutputTokens: number;
};

export type ExperimentRequest = {
  documentId: string;
  chunkRunId: string | null;
  embeddingRunId: string | null;
  query: string;
  targetStage: ExperimentTargetStage;
  retrieval: RetrievalConfig;
  reranking: RerankingConfig;
  context: ContextConfig;
  generation: GenerationConfig;
};

export type RetrievedCandidate = {
  chunkId: string;
  rank: number;
  score: number | null;
  denseScore: number | null;
  keywordScore: number | null;
  keywordRank: number | null;
  rrfScore: number | null;
  text: string;
  documentId: string;
  pageNumbers: number[];
  sourceElementIds: string[];
  headingPath: string[];
};

export type RerankedCandidate = RetrievedCandidate & {
  originalRank: number;
  rerankScore: number | null;
};

export type ContextCandidate = {
  chunkId: string;
  selected: boolean;
  reason: string;
  tokenCount: number;
  text: string;
  pageNumbers: number[];
  sourceElementIds: string[];
};

export type ValidatedCitation = {
  citationId: string;
  documentId: string;
  chunkId: string;
  pageNumbers: number[];
  quote: string | null;
  valid: boolean;
  sourceElementIds: string[];
};

export type ExperimentStageResults = {
  retrieval: {
    candidates: RetrievedCandidate[];
    durationMs: number | null;
  } | null;
  reranking: {
    candidates: RerankedCandidate[];
    durationMs: number | null;
    method: string | null;
    executed: boolean;
  } | null;
  context: {
    candidates: ContextCandidate[];
    finalContext: string;
    tokenBudget: number;
    tokenCount: number;
    durationMs: number | null;
  } | null;
  generation: {
    answer: string;
    citations: ValidatedCitation[];
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    durationMs: number | null;
    insufficientContext: boolean;
  } | null;
};

export type ExperimentRun = RunSummary & {
  documentId: string;
  chunkRunId: string;
  embeddingRunId: string | null;
  query: string;
  targetStage: ExperimentTargetStage;
  stageResults: ExperimentStageResults;
};

export type EvaluationCase = {
  question: string;
  relevantElementIds: string[];
  referenceAnswer: string | null;
};

export type EvaluationDataset = {
  id: string;
  documentId: string;
  parseRunId: string;
  name: string;
  version: number;
  cases: EvaluationCase[];
  createdAt: string | null;
};

export type EvaluationMetrics = {
  hitAtK: number | null;
  recallAtK: number | null;
  precisionAtK: number | null;
  mrr: number | null;
  citationValidity: number | null;
  groundedness: number | null;
  judgeModel: string | null;
  caseCount: number | null;
};

export type EvaluationRun = RunSummary & {
  datasetId: string;
  results: EvaluationMetrics;
};

export type Capabilities = {
  embeddingModel: string;
  embeddingDimensions: number;
  generationModel: string;
  rerankModel: string;
  judgeModel: string;
  embeddingFormatVersion: string;
  limits: Record<string, number>;
};
