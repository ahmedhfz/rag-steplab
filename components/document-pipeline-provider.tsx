"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useAuthBootstrap } from "@/components/auth-provider";
import { DocumentApiError, type DocumentApiErrorCode } from "@/lib/document-api";
import { validatePdfFile, type DocumentFileValidationError } from "@/lib/document-file";
import type { DocumentParseResponse } from "@/lib/document-parse-types";
import {
  createChunkRun,
  createEmbeddingRun,
  createDocumentPipeline,
  createEvaluationDataset,
  createEvaluationRunAsync,
  createExperimentAsync,
  continueExperiment,
  getCapabilities,
  getChunkRun,
  getDocumentSummary,
  getEvaluationDataset,
  getEvaluationRun,
  getExperiment,
  getParseRun,
  getEmbeddingRun,
  listDocumentPipelines,
  listDocuments,
  uploadDocument,
  listEvaluationRuns,
  parseAndPersistDocument,
  reparsePersistedDocument,
  deleteDocumentPipeline,
  rerunGeneration,
  waitForParseRun,
  updateDocumentPipeline,
  waitForEvaluationRun,
} from "@/lib/rag-api";
import type {
  Capabilities,
  ChunkConfig,
  ChunkRun,
  ChunkStrategy,
  DocumentSummary,
  DocumentPipeline,
  DocumentLineageSelection,
  EmbeddingRun,
  EvaluationCase,
  EvaluationDataset,
  EvaluationDatasetSummary,
  EvaluationRun,
  ExperimentRequest,
  ExperimentRun,
  ExperimentSummary,
  PersistedDocument,
  ParseRun,
  RunSummary,
} from "@/lib/rag-api-types";
import type { DocumentActivityEventType } from "@/lib/rag-ui-types";

export type DocumentParseStatus = "not-started" | "ready" | "queued" | "running" | "completed" | "failed";
export type PipelineOperationStatus = "locked" | "ready" | "processing" | "completed" | "skipped" | "error" | "stale";
export type PersistenceStatus = "checking" | "available" | "unavailable";

export type DocumentActivityEvent = {
  id: number;
  type: DocumentActivityEventType;
  errorCode?: DocumentApiErrorCode;
};
export type { DocumentLineageSelection } from "@/lib/rag-api-types";

type LineageSelectionStore = Record<string, DocumentLineageSelection>;

type DocumentSnapshot = {
  detail: DocumentSummary;
  summaryFetchedAt?: number;
  selection: DocumentLineageSelection;
  parseResult: DocumentParseResponse | null;
  parseStatus: DocumentParseStatus;
  inFlightParseRunId: string | null;
  parseError: DocumentApiError | null;
  chunkRun: ChunkRun | null;
  chunkStatus: PipelineOperationStatus;
  embeddingRun: EmbeddingRun | null;
  embeddingStatus: PipelineOperationStatus;
  experiments: ExperimentSummary[];
  datasets: EvaluationDatasetSummary[];
  experimentStatus: PipelineOperationStatus;
  experimentRun: ExperimentRun | null;
  evaluationStatus: PipelineOperationStatus;
};

type PipelineMutationContext = {
  documentId: string;
  pipelineId: string;
  requestId: number;
  documentEpoch: number;
};

type EvaluationRunInput = {
  datasetId: string;
  pipelineId?: string | null;
  judge: boolean;
  retrieval: ExperimentRequest["retrieval"];
  reranking: ExperimentRequest["reranking"];
  context: ExperimentRequest["context"];
  generation: ExperimentRequest["generation"];
};

type DocumentPipelineContextValue = {
  pendingUpload: File | null;
  fileError: DocumentFileValidationError | null;
  parseStatus: DocumentParseStatus;
  parseProgress: number;
  parseProgressEstimated: boolean;
  parsePhase: string | null;
  parseResult: DocumentParseResponse | null;
  parseError: DocumentApiError | null;
  activity: DocumentActivityEvent[];
  persistenceStatus: PersistenceStatus;
  persistenceError: DocumentApiError | null;
  capabilities: Capabilities | null;
  documents: PersistedDocument[];
  activeDocumentId: string | null;
  activeDocumentMetadata: PersistedDocument | null;
  activeDocument: DocumentSummary | null;
  selectedParseRunId: string | null;
  selectedChunkRunId: string | null;
  selectedEmbeddingRunId: string | null;
  /** Read-only artifact cursor; never changes the saved pipeline lineage. */
  inspectedParseRunId: string | null;
  inspectedChunkRunId: string | null;
  inspectedEmbeddingRunId: string | null;
  chunkStatus: PipelineOperationStatus;
  chunkRun: ChunkRun | null;
  chunkError: DocumentApiError | null;
  embeddingStatus: PipelineOperationStatus;
  embeddingRun: EmbeddingRun | null;
  embeddingError: DocumentApiError | null;
  experimentStatus: PipelineOperationStatus;
  experimentRun: ExperimentRun | null;
  experimentError: DocumentApiError | null;
  experimentHistory: Array<ExperimentRun | ExperimentSummary>;
  evaluationDatasets: EvaluationDatasetSummary[];
  evaluationStatus: PipelineOperationStatus;
  evaluationRun: EvaluationRun | null;
  evaluationError: DocumentApiError | null;
  evaluationHistory: EvaluationRun[];
  uploadNotice: "created" | "reused" | null;
  pipelines: DocumentPipeline[];
  activePipelineId: string | null;
  activePipeline: DocumentPipeline | null;
  pipelineSelectionMode: "scratch" | "saved";
  selectFile: (file: File | undefined) => void;
  addDocument: (file: File) => Promise<PersistedDocument | null>;
  selectPersistedDocument: (documentId: string) => Promise<void>;
  selectParseRun: (runId: string) => Promise<void>;
  selectChunkRun: (runId: string) => Promise<void>;
  selectEmbeddingRun: (runId: string) => Promise<void>;
  inspectParseRun: (runId: string) => Promise<ParseRun | null>;
  inspectChunkRun: (runId: string) => Promise<ChunkRun | null>;
  inspectEmbeddingRun: (runId: string) => Promise<EmbeddingRun | null>;
  setPipelineParseRun: (runId: string) => Promise<boolean>;
  setPipelineChunkRun: (runId: string) => Promise<boolean>;
  setPipelineEmbeddingRun: (runId: string) => Promise<boolean>;
  selectPipeline: (pipelineId: string | null) => Promise<void>;
  createPipeline: (name: string) => Promise<DocumentPipeline | null>;
  renamePipeline: (pipelineId: string, name: string) => Promise<DocumentPipeline | null>;
  deletePipeline: (pipelineId: string) => Promise<void>;
  removeFile: () => void;
  parseSelectedFile: () => Promise<void>;
  reparseActiveDocument: () => Promise<void>;
  parseActiveDocument: () => Promise<void>;
  runChunking: (strategy: ChunkStrategy, config: ChunkConfig) => Promise<ChunkRun | null>;
  runEmbedding: () => Promise<EmbeddingRun | null>;
  runExperiment: (input: Omit<ExperimentRequest, "documentId" | "chunkRunId" | "embeddingRunId">) => Promise<void>;
  loadExperiment: (experimentId: string) => Promise<void>;
  loadEvaluationDataset: (datasetId: string) => Promise<EvaluationDataset | null>;
  loadEvaluationRun: (runId: string) => Promise<void>;
  continueExperiment: () => Promise<void>;
  rerunGeneration: () => Promise<void>;
  createDataset: (name: string, cases: EvaluationCase[], baseDatasetId?: string | null) => Promise<void>;
  runEvaluation: (input: EvaluationRunInput) => Promise<void>;
  refreshPersistence: () => Promise<void>;
  refreshEvaluationRuns: (datasetId: string) => Promise<void>;
};

const DocumentPipelineContext = createContext<DocumentPipelineContextValue | null>(null);
const ACTIVE_DOCUMENT_STORAGE_KEY = "rag-steplab-active-document-id";
const ACTIVE_DOCUMENT_STORAGE_PREFIX = `${ACTIVE_DOCUMENT_STORAGE_KEY}:`;
const LINEAGE_SELECTION_STORAGE_KEY = "rag-steplab-lineage-selections-v1";
const LINEAGE_SELECTION_STORAGE_PREFIX = `${LINEAGE_SELECTION_STORAGE_KEY}:`;
const ACTIVE_PIPELINE_STORAGE_KEY = "rag-steplab-active-pipeline-id";
const ACTIVE_PIPELINE_STORAGE_PREFIX = `${ACTIVE_PIPELINE_STORAGE_KEY}:`;
const ACTIVE_PIPELINE_DOCUMENT_STORAGE_PREFIX = `${ACTIVE_PIPELINE_STORAGE_KEY}:document:`;
const SCRATCH_PIPELINE_STORAGE_VALUE = "__scratch__";
const SUMMARY_CACHE_MAX_AGE_MS = 60_000;

function activeDocumentStorageKey(userId?: string | null) {
  return userId ? `${ACTIVE_DOCUMENT_STORAGE_PREFIX}${userId}` : ACTIVE_DOCUMENT_STORAGE_KEY;
}

function rememberActiveDocument(documentId: string | null, userId?: string | null) {
  try {
    const key = activeDocumentStorageKey(userId);
    if (documentId) window.localStorage.setItem(key, documentId);
    else window.localStorage.removeItem(key);
  } catch {
    // Kalıcı seçim bir kolaylıktır; storage engeli gerçek pipeline'ı durdurmamalıdır.
  }
}

function activePipelineStorageKey(userId?: string | null, documentId?: string | null) {
  if (documentId) return userId
    ? `${ACTIVE_PIPELINE_DOCUMENT_STORAGE_PREFIX}${userId}:${documentId}`
    : `${ACTIVE_PIPELINE_DOCUMENT_STORAGE_PREFIX}${documentId}`;
  return userId ? `${ACTIVE_PIPELINE_STORAGE_PREFIX}${userId}` : ACTIVE_PIPELINE_STORAGE_KEY;
}

function rememberActivePipeline(pipelineId: string | null, userId?: string | null, documentId?: string | null) {
  try {
    const key = activePipelineStorageKey(userId, documentId);
    window.localStorage.setItem(key, pipelineId ?? SCRATCH_PIPELINE_STORAGE_VALUE);
  } catch {
    // Pipeline kimliği yalnız oturum kolaylığıdır; asıl seçim server state'idir.
  }
}

function readActivePipeline(documentId: string, userId?: string | null): string | null | undefined {
  try {
    const scoped = window.localStorage.getItem(activePipelineStorageKey(userId, documentId));
    const value = scoped ?? window.localStorage.getItem(activePipelineStorageKey(userId));
    if (value === null) return undefined;
    return value === SCRATCH_PIPELINE_STORAGE_VALUE ? null : value;
  } catch {
    return undefined;
  }
}

function lineageSelectionStorageKey(userId?: string | null) {
  return userId ? `${LINEAGE_SELECTION_STORAGE_PREFIX}${userId}` : LINEAGE_SELECTION_STORAGE_KEY;
}

function emptyLineageSelection(): DocumentLineageSelection {
  return { selectedParseRunId: null, selectedChunkRunId: null, selectedEmbeddingRunId: null };
}

function pipelineSelection(pipeline: DocumentPipeline): DocumentLineageSelection {
  return {
    selectedParseRunId: pipeline.parseRunId,
    selectedChunkRunId: pipeline.chunkRunId,
    selectedEmbeddingRunId: pipeline.embeddingRunId,
  };
}

function normalizeLineageSelection(value: unknown): DocumentLineageSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyLineageSelection();
  const payload = value as Record<string, unknown>;
  const id = (key: keyof DocumentLineageSelection) => typeof payload[key] === "string" ? payload[key] as string : null;
  return {
    selectedParseRunId: id("selectedParseRunId"),
    selectedChunkRunId: id("selectedChunkRunId"),
    selectedEmbeddingRunId: id("selectedEmbeddingRunId"),
  };
}

function readLineageSelections(userId?: string | null): LineageSelectionStore {
  try {
    const raw = window.localStorage.getItem(lineageSelectionStorageKey(userId));
    if (!raw) return {};
    const payload = JSON.parse(raw) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return Object.fromEntries(Object.entries(payload).map(([documentId, selection]) => [documentId, normalizeLineageSelection(selection)]));
  } catch {
    return {};
  }
}

function rememberLineageSelections(selections: LineageSelectionStore, userId?: string | null) {
  try {
    window.localStorage.setItem(lineageSelectionStorageKey(userId), JSON.stringify(selections));
  } catch {
    // Seçim persistence yalnız bir kolaylıktır; pipeline'ı durdurmamalıdır.
  }
}

function completedCompatibleRun(run: RunSummary | undefined) {
  return Boolean(run && run.status === "completed" && run.isCompatible);
}

function pipelineStatusFromRun(run: RunSummary): PipelineOperationStatus {
  if (run.status === "queued" || run.status === "running") return "processing";
  if (run.status === "completed") return "completed";
  return "error";
}

function resolveLineageSelection(
  detail: DocumentSummary,
  stored?: DocumentLineageSelection,
  strict = false,
): DocumentLineageSelection {
  const candidate = stored ?? emptyLineageSelection();
  const parse = detail.parseRuns.find((run) => run.id === candidate.selectedParseRunId && completedCompatibleRun(run))
    ?? (strict ? undefined : detail.parseRuns.find((run) => run.id === detail.activeParseRunId && completedCompatibleRun(run)));
  const parseRunId = parse?.id ?? null;
  const chunk = parseRunId
    ? detail.chunkRuns.find((run) => run.id === candidate.selectedChunkRunId && run.upstream.parseRunId === parseRunId && completedCompatibleRun(run))
      ?? (strict ? undefined : detail.chunkRuns.find((run) => run.id === detail.activeChunkRunId && run.upstream.parseRunId === parseRunId && completedCompatibleRun(run)))
    : undefined;
  const chunkRunId = chunk?.id ?? null;
  const embedding = chunkRunId
    ? detail.embeddingRuns.find((run) => run.id === candidate.selectedEmbeddingRunId && run.upstream.chunkRunId === chunkRunId && completedCompatibleRun(run))
      ?? (strict ? undefined : detail.embeddingRuns.find((run) => run.id === detail.activeEmbeddingRunId && run.upstream.chunkRunId === chunkRunId && completedCompatibleRun(run)))
    : undefined;
  return {
    selectedParseRunId: parseRunId,
    selectedChunkRunId: chunkRunId,
    selectedEmbeddingRunId: embedding?.id ?? null,
  };
}

function asApiError(error: unknown, fallback: string) {
  return error instanceof DocumentApiError ? error : new DocumentApiError("unknown", fallback);
}

function removeControllerIfCurrent(controllers: Map<string, AbortController>, key: string, controller: AbortController) {
  if (controllers.get(key) === controller) controllers.delete(key);
}

export function DocumentPipelineProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { userId: authoritativeUserId } = useAuthBootstrap();
  const [authUserId, setAuthUserId] = useState<string | null>(authoritativeUserId);
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [fileError, setFileError] = useState<DocumentFileValidationError | null>(null);
  const [parseStatus, setParseStatus] = useState<DocumentParseStatus>("not-started");
  const [parseProgress, setParseProgress] = useState(0);
  const [parsePhase, setParsePhase] = useState<string | null>(null);
  // Docling exposes coarse stage checkpoints, so the UI may interpolate between
  // them while the long-running conversion itself is still in progress.
  const [lastReportedParseProgress, setLastReportedParseProgress] = useState(0);
  const [parseResult, setParseResult] = useState<DocumentParseResponse | null>(null);
  const [parseError, setParseError] = useState<DocumentApiError | null>(null);
  const parseInFlightRef = useRef(false);
  const activeParseRunIdRef = useRef<string | null>(null);
  const [activity, setActivity] = useState<DocumentActivityEvent[]>([]);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>("checking");
  const [persistenceError, setPersistenceError] = useState<DocumentApiError | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [documents, setDocuments] = useState<PersistedDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activeDocumentMetadata, setActiveDocumentMetadata] = useState<PersistedDocument | null>(null);
  const [activeDocument, setActiveDocument] = useState<DocumentSummary | null>(null);
  const [selectedParseRunId, setSelectedParseRunId] = useState<string | null>(null);
  const [selectedChunkRunId, setSelectedChunkRunId] = useState<string | null>(null);
  const [selectedEmbeddingRunId, setSelectedEmbeddingRunId] = useState<string | null>(null);
  const [inspectedParseRunId, setInspectedParseRunId] = useState<string | null>(null);
  const [inspectedChunkRunId, setInspectedChunkRunId] = useState<string | null>(null);
  const [inspectedEmbeddingRunId, setInspectedEmbeddingRunId] = useState<string | null>(null);
  const [chunkStatus, setChunkStatus] = useState<PipelineOperationStatus>("locked");
  const [chunkRun, setChunkRun] = useState<ChunkRun | null>(null);
  const [chunkError, setChunkError] = useState<DocumentApiError | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<PipelineOperationStatus>("locked");
  const [embeddingRun, setEmbeddingRun] = useState<EmbeddingRun | null>(null);
  const [embeddingError, setEmbeddingError] = useState<DocumentApiError | null>(null);
  const [experimentStatus, setExperimentStatus] = useState<PipelineOperationStatus>("locked");
  const [experimentRun, setExperimentRun] = useState<ExperimentRun | null>(null);
  const [experimentError, setExperimentError] = useState<DocumentApiError | null>(null);
  const [experimentHistory, setExperimentHistory] = useState<Array<ExperimentRun | ExperimentSummary>>([]);
  const [evaluationDatasets, setEvaluationDatasets] = useState<EvaluationDatasetSummary[]>([]);
  const [evaluationStatus, setEvaluationStatus] = useState<PipelineOperationStatus>("locked");
  const [evaluationRun, setEvaluationRun] = useState<EvaluationRun | null>(null);
  const [evaluationError, setEvaluationError] = useState<DocumentApiError | null>(null);
  const [evaluationHistory, setEvaluationHistory] = useState<EvaluationRun[]>([]);
  const [uploadNotice, setUploadNotice] = useState<"created" | "reused" | null>(null);
  const [pipelines, setPipelines] = useState<DocumentPipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const documentEpochRef = useRef(0);
  const documentLoadRequestRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const inspectionRequestRef = useRef(0);
  const inspectedParseRunIdRef = useRef<string | null>(null);
  const inspectedChunkRunIdRef = useRef<string | null>(null);
  const inspectedEmbeddingRunIdRef = useRef<string | null>(null);
  const activeDocumentRef = useRef<DocumentSummary | null>(null);
  const activeDocumentSummaryLoadedAtRef = useRef(0);
  const activePipelineRef = useRef<DocumentPipeline | null>(null);
  const authUserIdRef = useRef<string | null>(authUserId);
  const lineageSelectionsRef = useRef<LineageSelectionStore>({});
  const activityIdRef = useRef(0);
  const controllersRef = useRef(new Map<string, AbortController>());
  const artifactCacheRef = useRef(new Map<string, ParseRun | ChunkRun | EmbeddingRun | ExperimentRun | EvaluationDataset | EvaluationRun>());
  const pipelineRevisionRef = useRef(new Map<string, number>());
  const pipelineMutationQueueRef = useRef(new Map<string, Promise<boolean>>());
  const persistActivePipelineSelectionRef = useRef<(selection: DocumentLineageSelection) => Promise<boolean>>(async () => false);

  const setInspectedSelection = useCallback((selection: DocumentLineageSelection) => {
    inspectedParseRunIdRef.current = selection.selectedParseRunId;
    inspectedChunkRunIdRef.current = selection.selectedChunkRunId;
    inspectedEmbeddingRunIdRef.current = selection.selectedEmbeddingRunId;
    setInspectedParseRunId(selection.selectedParseRunId);
    setInspectedChunkRunId(selection.selectedChunkRunId);
    setInspectedEmbeddingRunId(selection.selectedEmbeddingRunId);
  }, []);

  const beginArtifactInspection = useCallback((kind: "parse" | "chunk" | "embedding", runId: string) => {
    const requestId = ++inspectionRequestRef.current;
    if (kind === "parse") {
      inspectedParseRunIdRef.current = runId;
      setInspectedParseRunId(runId);
    } else if (kind === "chunk") {
      inspectedChunkRunIdRef.current = runId;
      setInspectedChunkRunId(runId);
    } else {
      inspectedEmbeddingRunIdRef.current = runId;
      setInspectedEmbeddingRunId(runId);
    }
    return requestId;
  }, []);

  const replaceController = useCallback((key: string) => {
    controllersRef.current.get(key)?.abort();
    const controller = new AbortController();
    controllersRef.current.set(key, controller);
    return controller;
  }, []);

  useEffect(() => () => {
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
  }, []);

  const handleAuthUserChange = useCallback((nextUserId: string | null) => {
    if (authUserIdRef.current === nextUserId) return;
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    documentLoadRequestRef.current += 1;
    documentEpochRef.current += 1;
    selectionRequestRef.current += 1;
    inspectionRequestRef.current += 1;
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    activeParseRunIdRef.current = null;
    activeDocumentRef.current = null;
    activeDocumentSummaryLoadedAtRef.current = 0;
    activePipelineRef.current = null;
    pipelineRevisionRef.current.clear();
    pipelineMutationQueueRef.current.clear();
    lineageSelectionsRef.current = {};
    artifactCacheRef.current.clear();
    setActiveDocument(null);
    setActiveDocumentId(null);
    setActiveDocumentMetadata(null);
    setCapabilities(null);
    setDocuments([]);
    setPersistenceStatus("checking");
    setPersistenceError(null);
    setPendingUpload(null);
    setFileError(null);
    setActivity([]);
    setParseStatus("not-started");
    setParseProgress(0);
    setLastReportedParseProgress(0);
    setParseResult(null);
    setParseError(null);
    setSelectedParseRunId(null);
    setSelectedChunkRunId(null);
    setSelectedEmbeddingRunId(null);
    inspectedParseRunIdRef.current = null;
    inspectedChunkRunIdRef.current = null;
    inspectedEmbeddingRunIdRef.current = null;
    setInspectedParseRunId(null);
    setInspectedChunkRunId(null);
    setInspectedEmbeddingRunId(null);
    setChunkStatus("locked");
    setChunkRun(null);
    setChunkError(null);
    setEmbeddingStatus("locked");
    setEmbeddingRun(null);
    setEmbeddingError(null);
    setExperimentStatus("locked");
    setExperimentRun(null);
    setExperimentError(null);
    setExperimentHistory([]);
    setEvaluationDatasets([]);
    setEvaluationStatus("locked");
    setEvaluationRun(null);
    setEvaluationError(null);
    setEvaluationHistory([]);
    setPipelines([]);
    setActivePipelineId(null);
    authUserIdRef.current = nextUserId;
    setAuthUserId(nextUserId);
  }, []);

  useEffect(() => {
    handleAuthUserChange(authoritativeUserId);
  }, [authoritativeUserId, handleAuthUserChange]);

  const cacheArtifact = useCallback((kind: string, id: string, value: ParseRun | ChunkRun | EmbeddingRun | ExperimentRun | EvaluationDataset | EvaluationRun) => {
    // Yalnız tamamlanan run immutable kabul edilir; devam eden/hatalı detay tekrar doğrulanır.
    if ("status" in value && value.status !== "completed") return;
    const key = `${kind}:${id}`;
    artifactCacheRef.current.delete(key);
    artifactCacheRef.current.set(key, value);
    const keys = [...artifactCacheRef.current.keys()].filter((item) => item.startsWith(`${kind}:`));
    while (keys.length > 16) {
      artifactCacheRef.current.delete(keys.shift() as string);
    }
  }, []);

  const readArtifact = useCallback(<T extends ParseRun | ChunkRun | EmbeddingRun | ExperimentRun | EvaluationDataset | EvaluationRun,>(kind: string, id: string) => {
    return artifactCacheRef.current.get(`${kind}:${id}`) as T | undefined;
  }, []);

  const addActivity = useCallback((type: DocumentActivityEventType, errorCode?: DocumentApiErrorCode) => {
    const id = ++activityIdRef.current;
    setActivity((current) => [...current, { id, type, errorCode }]);
  }, []);

  const applyParseRunStatus = useCallback((run: ParseRun, expectedRunId: number) => {
    if (runIdRef.current !== expectedRunId) return;
    activeParseRunIdRef.current = run.id;
    setParseStatus(run.status);
    setLastReportedParseProgress(run.progress);
    setParseProgress((current) => Math.max(current, run.progress));
    setParsePhase(typeof run.runMetadata?.phase === "string" ? run.runMetadata.phase : null);
    if (run.status === "failed") {
      const problem = run.error ?? { code: "parse_failed", message: "The parse run failed." };
      setParseError(new DocumentApiError(problem.code, problem.message));
    } else {
      setParseError(null);
    }
  }, []);

  const rememberSelection = useCallback((documentId: string, selection: DocumentLineageSelection) => {
    const next = { ...lineageSelectionsRef.current, [documentId]: selection };
    lineageSelectionsRef.current = next;
    rememberLineageSelections(next, authUserId);
  }, [authUserId]);

  const commitDocumentSnapshot = useCallback((
    snapshot: DocumentSnapshot,
    persistSelection = true,
    summaryFetchedAt?: number,
  ) => {
    activeDocumentRef.current = snapshot.detail;
    const fetchedAt = summaryFetchedAt ?? snapshot.summaryFetchedAt;
    if (fetchedAt !== undefined) activeDocumentSummaryLoadedAtRef.current = fetchedAt;
    setActiveDocumentId(snapshot.detail.id);
    setActiveDocumentMetadata({
      id: snapshot.detail.id,
      fileName: snapshot.detail.fileName,
      mediaType: snapshot.detail.mediaType,
      sizeBytes: snapshot.detail.sizeBytes,
      pageCount: snapshot.detail.pageCount,
      sha256: snapshot.detail.sha256,
      activeParseRunId: snapshot.detail.activeParseRunId,
      activeChunkRunId: snapshot.detail.activeChunkRunId,
      activeEmbeddingRunId: snapshot.detail.activeEmbeddingRunId,
      createdAt: snapshot.detail.createdAt,
      updatedAt: snapshot.detail.updatedAt,
    });
    setActiveDocument(snapshot.detail);
    setSelectedParseRunId(snapshot.selection.selectedParseRunId);
    setSelectedChunkRunId(snapshot.selection.selectedChunkRunId);
    setSelectedEmbeddingRunId(snapshot.selection.selectedEmbeddingRunId);
    inspectionRequestRef.current += 1;
    setInspectedSelection(snapshot.selection);
    setPersistenceError(null);
    if (persistSelection && !activePipelineRef.current) rememberSelection(snapshot.detail.id, snapshot.selection);
    activeParseRunIdRef.current = snapshot.inFlightParseRunId ?? snapshot.selection.selectedParseRunId;
    setParseResult(snapshot.parseResult);
    setParseStatus(snapshot.parseStatus);
    setChunkRun(snapshot.chunkRun);
    setChunkStatus(snapshot.chunkStatus);
    setChunkError(null);
    setEmbeddingRun(snapshot.embeddingRun);
    setEmbeddingStatus(snapshot.embeddingStatus);
    setEmbeddingError(null);
    setExperimentHistory(snapshot.experiments);
    setExperimentRun(snapshot.experimentRun);
    setExperimentStatus(snapshot.experimentStatus);
    setExperimentError(null);
    setEvaluationDatasets(snapshot.datasets);
    setEvaluationStatus(snapshot.evaluationStatus);
    setEvaluationRun(null);
    setEvaluationHistory([]);
    setEvaluationError(null);
    setParseError(snapshot.parseError);
    const selectedParseSummary = snapshot.detail.parseRuns.find((run) => run.id === snapshot.selection.selectedParseRunId);
    const loadedParseProgress = snapshot.inFlightParseRunId
      ? snapshot.detail.parseRuns.find((run) => run.id === snapshot.inFlightParseRunId)?.progress ?? 0
      : selectedParseSummary?.progress ?? (snapshot.parseResult ? 100 : 0);
    setLastReportedParseProgress(loadedParseProgress);
    setParseProgress(loadedParseProgress);
    setParsePhase(snapshot.inFlightParseRunId
      ? snapshot.detail.parseRuns.find((run) => run.id === snapshot.inFlightParseRunId)?.phase ?? null
      : selectedParseSummary?.phase ?? (snapshot.parseResult ? "completed" : null));
  }, [rememberSelection, setInspectedSelection]);

  const buildDocumentSnapshot = useCallback((
    detail: DocumentSummary,
    selectionOverride?: DocumentLineageSelection,
    strictSelection = false,
  ): DocumentSnapshot => {
    const selection = resolveLineageSelection(
      detail,
      selectionOverride ?? lineageSelectionsRef.current[detail.id],
      strictSelection,
    );
    const parseSummary = selection.selectedParseRunId
      ? detail.parseRuns.find((run) => run.id === selection.selectedParseRunId) ?? null
      : null;
    const inFlightParseSummary = detail.parseRuns.find((run) => run.status === "queued" || run.status === "running") ?? null;
    const latestParseSummary = detail.parseRuns[0] ?? null;
    const failedReparseSummary = latestParseSummary?.status === "failed" && latestParseSummary.id !== detail.activeParseRunId
      ? latestParseSummary
      : null;
    const visibleParseSummary = inFlightParseSummary ?? failedReparseSummary ?? parseSummary;
    const parseRun = selection.selectedParseRunId ? readArtifact<ParseRun>("parse", selection.selectedParseRunId) : undefined;
    const legacyActiveParse = selection.selectedParseRunId === detail.activeParseRun?.parseRunId ? detail.activeParseRun : null;
    const chunkRun = selection.selectedChunkRunId ? readArtifact<ChunkRun>("chunk", selection.selectedChunkRunId) : undefined;
    const embeddingRun = selection.selectedEmbeddingRunId ? readArtifact<EmbeddingRun>("embedding", selection.selectedEmbeddingRunId) : undefined;
    const chunkSummary = selection.selectedChunkRunId ? detail.chunkRuns.find((run) => run.id === selection.selectedChunkRunId) : undefined;
    const embeddingSummary = selection.selectedEmbeddingRunId ? detail.embeddingRuns.find((run) => run.id === selection.selectedEmbeddingRunId) : undefined;
    const chunkMatchesLineage = Boolean(
      chunkSummary
      && chunkSummary.upstream.parseRunId === selection.selectedParseRunId
      && completedCompatibleRun(chunkSummary)
      && (!chunkRun || (chunkRun.documentId === detail.id && chunkRun.parseRunId === selection.selectedParseRunId)),
    );
    const embeddingMatchesLineage = Boolean(
      embeddingSummary
      && embeddingSummary.upstream.chunkRunId === selection.selectedChunkRunId
      && completedCompatibleRun(embeddingSummary)
      && (!embeddingRun || (embeddingRun.documentId === detail.id && embeddingRun.chunkRunId === selection.selectedChunkRunId)),
    );
    const effectiveSelection: DocumentLineageSelection = {
      selectedParseRunId: parseSummary && completedCompatibleRun(parseSummary) ? selection.selectedParseRunId : null,
      selectedChunkRunId: chunkMatchesLineage ? selection.selectedChunkRunId : null,
      selectedEmbeddingRunId: embeddingMatchesLineage ? selection.selectedEmbeddingRunId : null,
    };
    const filteredDatasets = detail.evaluationDatasets.filter((dataset) => dataset.parseRunId === effectiveSelection.selectedParseRunId);
    const selectedExperimentSummary = detail.experiments.find((run) => run.isCompatible
      && run.upstream.chunkRunId === effectiveSelection.selectedChunkRunId
      && (run.embeddingRunId === null || run.embeddingRunId === effectiveSelection.selectedEmbeddingRunId)) ?? null;
    const selectedExperiment = selectedExperimentSummary ? readArtifact<ExperimentRun>("experiment", selectedExperimentSummary.id) ?? null : null;
    const nextParseStatus: DocumentParseStatus = inFlightParseSummary
      ? inFlightParseSummary.status
      : failedReparseSummary
        ? "failed"
        : (parseRun?.result ?? legacyActiveParse)
          ? "completed"
          : parseSummary?.status === "completed"
            ? "completed"
            : "not-started";
    const embeddingReady = Boolean(effectiveSelection.selectedChunkRunId && embeddingMatchesLineage && embeddingRun);
    return {
      detail,
      selection: effectiveSelection,
      parseResult: effectiveSelection.selectedParseRunId ? parseRun?.result ?? legacyActiveParse ?? null : null,
      parseStatus: nextParseStatus,
      inFlightParseRunId: inFlightParseSummary?.id ?? null,
      parseError: visibleParseSummary?.error
        ? new DocumentApiError(visibleParseSummary.error.code, visibleParseSummary.error.message)
        : null,
      chunkRun: chunkMatchesLineage ? chunkRun ?? null : null,
      chunkStatus: !effectiveSelection.selectedParseRunId ? "locked" : chunkRun ? "completed" : "ready",
      embeddingRun: embeddingMatchesLineage ? embeddingRun ?? null : null,
      embeddingStatus: !effectiveSelection.selectedChunkRunId ? "locked" : embeddingReady ? "completed" : "ready",
      experiments: detail.experiments,
      datasets: filteredDatasets,
      experimentStatus: selectedExperiment ? "completed" : effectiveSelection.selectedChunkRunId ? "ready" : "locked",
      experimentRun: selectedExperiment,
      evaluationStatus: effectiveSelection.selectedChunkRunId && effectiveSelection.selectedEmbeddingRunId && filteredDatasets.length > 0 ? "ready" : "locked",
    };
  }, [readArtifact]);

  const loadDocumentSnapshot = useCallback(async (
    documentId: string,
    signal: AbortSignal,
    selectionOverride?: DocumentLineageSelection,
    strictSelection = false,
  ): Promise<DocumentSnapshot> => {
    const detail = await getDocumentSummary(documentId, signal);
    return {
      ...buildDocumentSnapshot(detail, selectionOverride, strictSelection),
      summaryFetchedAt: Date.now(),
    };
  }, [buildDocumentSnapshot]);

  const hydrateParseDetail = useCallback(async (
    documentId: string,
    runId: string,
    expectedSelection = selectionRequestRef.current,
    expectedInspection = inspectionRequestRef.current,
  ) => {
    const epoch = documentEpochRef.current;
    const cached = readArtifact<ParseRun>("parse", runId);
    if (cached && cached.documentId !== documentId) return null;
    const isCurrent = () => documentEpochRef.current === epoch
      && selectionRequestRef.current === expectedSelection
      && inspectionRequestRef.current === expectedInspection
      && inspectedParseRunIdRef.current === runId
      && activeDocumentRef.current?.id === documentId;
    if (cached) {
      if (isCurrent()) {
        setParseResult(cached.result);
        setParseStatus(cached.status);
        setParseError(cached.error ? new DocumentApiError(cached.error.code, cached.error.message) : null);
      }
      return cached;
    }
    const controllerKey = `detail:parse:${documentId}:${runId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const run = await getParseRun(runId, controller.signal, documentId);
      if (run.documentId !== documentId) return null;
      cacheArtifact("parse", runId, run);
      if (!isCurrent()) return run;
      setParseResult(run.result);
      setParseStatus(run.status);
      setParseError(run.error ? new DocumentApiError(run.error.code, run.error.message) : null);
      return run;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && isCurrent()) {
        setParseError(asApiError(error, "The selected parse run could not be loaded."));
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [cacheArtifact, readArtifact, replaceController]);

  const hydrateChunkDetail = useCallback(async (
    documentId: string,
    runId: string,
    expectedSelection = selectionRequestRef.current,
    expectedInspection = inspectionRequestRef.current,
  ) => {
    const epoch = documentEpochRef.current;
    const cached = readArtifact<ChunkRun>("chunk", runId);
    if (cached && cached.documentId !== documentId) return null;
    const isCurrent = () => documentEpochRef.current === epoch
      && selectionRequestRef.current === expectedSelection
      && inspectionRequestRef.current === expectedInspection
      && inspectedChunkRunIdRef.current === runId
      && activeDocumentRef.current?.id === documentId;
    if (cached) {
      if (isCurrent()) {
        setChunkRun(cached);
        setChunkStatus(pipelineStatusFromRun(cached));
      }
      return cached;
    }
    const controllerKey = `detail:chunk:${documentId}:${runId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const run = await getChunkRun(runId, controller.signal);
      if (run.documentId !== documentId) return null;
      cacheArtifact("chunk", runId, run);
      if (!isCurrent()) return run;
      setChunkRun(run);
      setChunkStatus(pipelineStatusFromRun(run));
      return run;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && isCurrent()) {
        setChunkError(asApiError(error, "The selected chunk run could not be loaded."));
        setChunkStatus("error");
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [cacheArtifact, readArtifact, replaceController]);

  const hydrateEmbeddingDetail = useCallback(async (
    documentId: string,
    runId: string,
    expectedSelection = selectionRequestRef.current,
    expectedInspection = inspectionRequestRef.current,
  ) => {
    const epoch = documentEpochRef.current;
    const cached = readArtifact<EmbeddingRun>("embedding", runId);
    if (cached && cached.documentId !== documentId) return null;
    const isCurrent = () => documentEpochRef.current === epoch
      && selectionRequestRef.current === expectedSelection
      && inspectionRequestRef.current === expectedInspection
      && inspectedEmbeddingRunIdRef.current === runId
      && activeDocumentRef.current?.id === documentId;
    if (cached) {
      if (isCurrent()) {
        setEmbeddingRun(cached);
        setEmbeddingStatus(pipelineStatusFromRun(cached));
      }
      return cached;
    }
    const controllerKey = `detail:embedding:${documentId}:${runId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const run = await getEmbeddingRun(runId, controller.signal);
      if (run.documentId !== documentId) return null;
      cacheArtifact("embedding", runId, run);
      if (!isCurrent()) return run;
      setEmbeddingRun(run);
      setEmbeddingStatus(pipelineStatusFromRun(run));
      return run;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && isCurrent()) {
        setEmbeddingError(asApiError(error, "The selected embedding run could not be loaded."));
        setEmbeddingStatus("error");
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [cacheArtifact, readArtifact, replaceController]);

  useEffect(() => {
    if (parseStatus !== "queued" && parseStatus !== "running") return;

    // The parser reports authoritative checkpoints. Between checkpoints, move
    // slowly through a capped range so a long Docling conversion does not look
    // frozen. The UI marks these values as estimated.
    const interval = window.setInterval(() => {
      setParseProgress((current) => {
        if (current < 30) return current;
        const cap = current < 72 ? 70 : current < 90 ? 88 : 98;
        return Math.min(cap, current + 1);
      });
    }, 750);

    return () => window.clearInterval(interval);
  }, [parseStatus]);

  const resumeParseRun = useCallback(async (documentId: string, parseRunId: string, expectedRunId: number) => {
    const controller = replaceController(`parse-resume:${documentId}`);
    try {
      const completedResult = await waitForParseRun(
        parseRunId,
        controller.signal,
        documentId,
        (run) => applyParseRunStatus(run, expectedRunId),
      );
      if (runIdRef.current !== expectedRunId || activeDocumentRef.current?.id !== documentId || activeParseRunIdRef.current !== parseRunId) return;
      const selection = {
        selectedParseRunId: parseRunId,
        selectedChunkRunId: null,
        selectedEmbeddingRunId: null,
      };
      if (!await persistActivePipelineSelectionRef.current(selection)) return;
      const snapshot = await loadDocumentSnapshot(
        documentId,
        controller.signal,
        selection,
        Boolean(activePipelineRef.current),
      );
      if (runIdRef.current !== expectedRunId || activeDocumentRef.current?.id !== documentId) return;
      documentEpochRef.current += 1;
      selectionRequestRef.current += 1;
      commitDocumentSnapshot(snapshot);
      setParseResult(completedResult);
      setParseStatus("completed");
      addActivity("parseCompleted");
    } catch (error) {
      if (runIdRef.current !== expectedRunId || activeDocumentRef.current?.id !== documentId || (error instanceof DOMException && error.name === "AbortError")) return;
      const apiError = asApiError(error, "The persisted document could not be parsed.");
      setParseError(apiError);
      if (apiError.code !== "parse_poll_timeout") {
        setParseStatus("failed");
        addActivity("parseFailed", apiError.code);
      }
    } finally {
      if (runIdRef.current === expectedRunId) removeControllerIfCurrent(controllersRef.current, `parse-resume:${documentId}`, controller);
    }
  }, [addActivity, applyParseRunStatus, commitDocumentSnapshot, loadDocumentSnapshot, replaceController]);

  const loadThenCommitDocument = useCallback(async (
    documentId: string,
    signal: AbortSignal,
    pipelineId: string | null | undefined,
  ) => {
    const requestId = ++documentLoadRequestRef.current;
    const pipelinesPromise = listDocumentPipelines(documentId, signal).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // Yalnız additive endpoint'in henüz bulunmadığı preview'larda legacy
      // workspace'e dön; gerçek network/auth hatalarını görünür bırak.
      if (!(error instanceof DocumentApiError)
        || (error.status !== 404 && error.code !== "invalid_response")) throw error;
      return [] as DocumentPipeline[];
    });
    const [nextPipelines, loadedSummary] = await Promise.all([
      pipelinesPromise,
      getDocumentSummary(documentId, signal).then((detail) => ({ detail, fetchedAt: Date.now() })),
    ]);
    const scopedPipelines = nextPipelines.filter((item) => item.documentId === documentId);
    const pipeline = pipelineId === null
      ? null
      : scopedPipelines.find((item) => item.id === pipelineId)
        ?? scopedPipelines.find((item) => item.isDefault || item.name === "Default Pipeline")
        ?? scopedPipelines[0]
        ?? null;
    const snapshot = buildDocumentSnapshot(
      loadedSummary.detail,
      pipeline ? pipelineSelection(pipeline) : lineageSelectionsRef.current[documentId],
      Boolean(pipeline),
    );
    if (documentLoadRequestRef.current !== requestId) return null;
    documentEpochRef.current += 1;
    selectionRequestRef.current += 1;
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    setPipelines(scopedPipelines);
    pipelineRevisionRef.current = new Map(scopedPipelines.map((item) => [item.id, item.revision]));
    activePipelineRef.current = pipeline;
    setActivePipelineId(pipeline?.id ?? null);
    rememberActivePipeline(pipeline?.id ?? null, authUserId, documentId);
    commitDocumentSnapshot({ ...snapshot, summaryFetchedAt: loadedSummary.fetchedAt }, !pipeline);
    rememberActiveDocument(documentId, authUserId);
    setPersistenceError(null);
    setPersistenceStatus("available");
    return snapshot;
  }, [authUserId, buildDocumentSnapshot, commitDocumentSnapshot]);

  const refreshPersistence = useCallback(async () => {
    const controller = replaceController("bootstrap");
    setPersistenceStatus("checking");
    setPersistenceError(null);
    try {
      const [nextCapabilities, nextDocuments] = await Promise.all([
        getCapabilities(controller.signal),
        listDocuments(controller.signal),
      ]);
      setCapabilities(nextCapabilities);
      setDocuments(nextDocuments);

      const documentId = activeDocumentRef.current?.id;
      if (documentId && nextDocuments.some((document) => document.id === documentId)) {
        const preferredPipelineId = activePipelineRef.current?.id ?? readActivePipeline(documentId, authUserId);
        const loaded = await loadThenCommitDocument(documentId, controller.signal, preferredPipelineId);
        if (loaded && !parseInFlightRef.current && (loaded.parseStatus === "queued" || loaded.parseStatus === "running") && loaded.inFlightParseRunId) {
          void resumeParseRun(documentId, loaded.inFlightParseRunId, runIdRef.current);
        }
      }
      setPersistenceStatus("available");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCapabilities(null);
      setPersistenceError(asApiError(error, "Persistent pipeline data could not be loaded."));
      setPersistenceStatus("unavailable");
    }
  }, [authUserId, loadThenCommitDocument, replaceController, resumeParseRun]);

  const selectPersistedDocument = useCallback(async (documentId: string, metadataOverride?: PersistedDocument) => {
    const metadata = metadataOverride ?? documents.find((document) => document.id === documentId);
    if (!metadata) return;
    const previousDocument = activeDocumentRef.current;
    const previousMetadata = activeDocumentMetadata;
    const previousDocumentId = activeDocumentId;
    const previousSummaryFetchedAt = activeDocumentSummaryLoadedAtRef.current;
    const previousPipeline = activePipelineRef.current;
    const previousPipelines = pipelines;
    const previousPipelineId = activePipelineId;
    const previousSnapshot = previousDocument
      ? buildDocumentSnapshot(previousDocument, {
          selectedParseRunId,
          selectedChunkRunId,
          selectedEmbeddingRunId,
        }, Boolean(previousPipeline))
      : null;
    const storedPipelineId = readActivePipeline(documentId, authUserId);
    const controller = replaceController("document");
    documentLoadRequestRef.current += 1;
    documentEpochRef.current += 1;
    selectionRequestRef.current += 1;
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    activeDocumentRef.current = null;
    activeDocumentSummaryLoadedAtRef.current = 0;
    setActiveDocument(null);
    setActiveDocumentId(documentId);
    setActiveDocumentMetadata(metadata);
    setSelectedParseRunId(null);
    setSelectedChunkRunId(null);
    setSelectedEmbeddingRunId(null);
    inspectionRequestRef.current += 1;
    setInspectedSelection(emptyLineageSelection());
    setParseResult(null);
    setChunkRun(null);
    setEmbeddingRun(null);
    setExperimentRun(null);
    setExperimentHistory([]);
    setEvaluationRun(null);
    setEvaluationHistory([]);
    setChunkStatus("locked");
    setEmbeddingStatus("locked");
    setExperimentStatus("locked");
    setEvaluationStatus("locked");
    setParseStatus("not-started");
    setParseError(null);
    setPersistenceError(null);
    // The document list is already authoritative. Detail hydration must not
    // replace it with a global loading state or hide the instant selection.
    setPersistenceStatus("available");
    rememberActiveDocument(documentId, authUserId);
    const selectionToken = selectionRequestRef.current;
    try {
      activePipelineRef.current = null;
      setActivePipelineId(null);
      setPipelines([]);
      const loaded = await loadThenCommitDocument(documentId, controller.signal, storedPipelineId);
      if (!loaded) return;
      setPendingUpload(null);
      setFileError(null);
      if ((loaded.parseStatus === "queued" || loaded.parseStatus === "running") && loaded.inFlightParseRunId) {
        void resumeParseRun(documentId, loaded.inFlightParseRunId, runIdRef.current);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (selectionToken === selectionRequestRef.current) {
        // Başarısız bir switch, yeni document state'inin eski committed state'i
        // kısmen ezmesine izin vermemeli.
        documentLoadRequestRef.current += 1;
        documentEpochRef.current += 1;
        runIdRef.current += 1;
        activeDocumentRef.current = previousDocument;
        activeDocumentSummaryLoadedAtRef.current = previousSummaryFetchedAt;
        activePipelineRef.current = previousPipeline;
        setPipelines(previousPipelines);
        setActivePipelineId(previousPipelineId);
        if (previousSnapshot) {
          commitDocumentSnapshot(previousSnapshot, false, previousSummaryFetchedAt);
        } else {
          setActiveDocument(previousDocument);
          setActiveDocumentMetadata(previousMetadata);
          setActiveDocumentId(previousDocumentId);
        }
      }
      setPersistenceError(asApiError(error, "The selected document could not be loaded."));
      setPersistenceStatus(documents.length > 0 ? "available" : "unavailable");
    }
  }, [activeDocumentId, activeDocumentMetadata, activePipelineId, authUserId, buildDocumentSnapshot, commitDocumentSnapshot, documents, loadThenCommitDocument, pipelines, replaceController, resumeParseRun, selectedChunkRunId, selectedEmbeddingRunId, selectedParseRunId, setInspectedSelection]);

  const addDocument = useCallback(async (file: File): Promise<PersistedDocument | null> => {
    const validationError = validatePdfFile(file);
    if (validationError) {
      throw new DocumentApiError(
        validationError === "invalidPdf" ? "invalid_file_type" : "file_too_large",
        validationError === "invalidPdf" ? "Only PDF files are supported." : "The PDF must be 50 MB or smaller.",
      );
    }
    const selectionToken = selectionRequestRef.current;
    const controller = replaceController("document-upload");
    try {
      const response = await uploadDocument(file, controller.signal);
      setUploadNotice(response.reusedDocument ? "reused" : "created");
      setDocuments((current) => [response.document, ...current.filter((item) => item.id !== response.document.id)]);
      // Keep an upload race from stealing focus from a document selected while
      // the storage request was in flight.
      if (selectionRequestRef.current === selectionToken) {
        await selectPersistedDocument(response.document.id, response.document);
      }
      return response.document;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "document-upload", controller);
    }
  }, [replaceController, selectPersistedDocument]);

  useEffect(() => {
    if (!authUserId && process.env.NODE_ENV !== "test") return;

    const controller = replaceController("bootstrap");
    void Promise.all([getCapabilities(controller.signal), listDocuments(controller.signal)])
      .then(async ([nextCapabilities, nextDocuments]) => {
        setCapabilities(nextCapabilities);
        setDocuments(nextDocuments);
        const storedSelections = readLineageSelections(authUserId);
        lineageSelectionsRef.current = storedSelections;
        let documentId: string | null = null;
        let pipelineId: string | null | undefined;
        let legacyDocumentId: string | null = null;
        try {
          documentId = window.localStorage.getItem(activeDocumentStorageKey(authUserId));
          if (!documentId && authUserId) legacyDocumentId = window.localStorage.getItem(ACTIVE_DOCUMENT_STORAGE_KEY);
          documentId = documentId ?? legacyDocumentId;
          pipelineId = documentId ? readActivePipeline(documentId, authUserId) : undefined;
        } catch {
          // Browser storage kapalıysa kalıcı backend verisi yine kullanılabilir.
        }
        if (documentId && nextDocuments.some((document) => document.id === documentId)) {
          if (legacyDocumentId) rememberActiveDocument(documentId, authUserId);
          const loaded = await loadThenCommitDocument(documentId, controller.signal, pipelineId);
          if (loaded && (loaded.parseStatus === "queued" || loaded.parseStatus === "running") && loaded.inFlightParseRunId) {
            void resumeParseRun(documentId, loaded.inFlightParseRunId, runIdRef.current);
          }
        } else if (documentId) {
          rememberActiveDocument(null, authUserId);
        }
        setPersistenceStatus("available");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCapabilities(null);
        setPersistenceError(asApiError(error, "Persistent pipeline data could not be loaded."));
        setPersistenceStatus("unavailable");
      });
    return () => controller.abort();
  }, [authUserId, loadThenCommitDocument, replaceController, resumeParseRun]);

  const selectFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const validationError = validatePdfFile(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    activeParseRunIdRef.current = null;
    setPendingUpload(file);
    setFileError(null);
    setParseStatus("ready");
    setLastReportedParseProgress(0);
    setParseProgress(0);
    setParsePhase(null);
    setParseError(null);
    setActivity([]);
    addActivity("documentSelected");
  }, [addActivity]);

  const removeFile = useCallback(() => {
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    activeParseRunIdRef.current = selectedParseRunId;
    setPendingUpload(null);
    setFileError(null);
    setParseStatus(selectedParseRunId ? "completed" : "not-started");
    setParseError(null);
    setActivity([]);
  }, [selectedParseRunId]);

  const parseSelectedFile = useCallback(async () => {
    if (!pendingUpload || parseInFlightRef.current || parseStatus === "queued" || parseStatus === "running") return;
    const currentRunId = runIdRef.current;
    const controller = replaceController("parse");
    parseInFlightRef.current = true;
    activeParseRunIdRef.current = null;
    setParseStatus("queued");
    setLastReportedParseProgress(0);
    setParseProgress(0);
    setParseError(null);
    addActivity("parseRequested");
    addActivity("parsing");
    try {
      const result = await parseAndPersistDocument(
        pendingUpload,
        controller.signal,
        (run) => applyParseRunStatus(run, currentRunId),
      );
      if (runIdRef.current !== currentRunId) return;
      if (result.documentId && result.parseRunId) {
        const snapshot = await loadDocumentSnapshot(result.documentId, controller.signal, {
          selectedParseRunId: result.parseRunId,
          selectedChunkRunId: null,
          selectedEmbeddingRunId: null,
        });
        if (runIdRef.current !== currentRunId) return;
        parseInFlightRef.current = false;
        runIdRef.current += 1;
        documentEpochRef.current += 1;
        selectionRequestRef.current += 1;
        commitDocumentSnapshot(snapshot);
        setDocuments((current) => [
          {
            id: snapshot.detail.id,
            fileName: snapshot.detail.fileName,
            mediaType: snapshot.detail.mediaType,
            sizeBytes: snapshot.detail.sizeBytes,
            pageCount: snapshot.detail.pageCount,
            sha256: snapshot.detail.sha256,
            activeParseRunId: snapshot.detail.activeParseRunId,
            activeChunkRunId: snapshot.detail.activeChunkRunId,
            activeEmbeddingRunId: snapshot.detail.activeEmbeddingRunId,
            createdAt: snapshot.detail.createdAt,
            updatedAt: snapshot.detail.updatedAt,
          },
          ...current.filter((item) => item.id !== snapshot.detail.id),
        ]);
        rememberActiveDocument(snapshot.detail.id, authUserId);
        setPendingUpload(null);
        setPersistenceStatus("available");
        setParseResult(result);
        setParseStatus("completed");
        setLastReportedParseProgress(100);
        setParseProgress(100);
        setParsePhase("completed");
        addActivity("parseCompleted");
      }
    } catch (error) {
      if (runIdRef.current !== currentRunId || (error instanceof DOMException && error.name === "AbortError")) return;
      const apiError = asApiError(error, "The document could not be parsed.");
      setParseError(apiError);
      if (apiError.code !== "parse_poll_timeout") {
        setParseStatus("failed");
        addActivity("parseFailed", apiError.code);
      }
    } finally {
      if (runIdRef.current === currentRunId) {
        parseInFlightRef.current = false;
        removeControllerIfCurrent(controllersRef.current, "parse", controller);
      }
    }
  }, [addActivity, applyParseRunStatus, authUserId, commitDocumentSnapshot, loadDocumentSnapshot, parseStatus, pendingUpload, replaceController]);

  const reparseActiveDocument = useCallback(async () => {
    const documentId = activeDocumentRef.current?.id;
    if (!documentId || parseInFlightRef.current || parseStatus === "queued" || parseStatus === "running") return;
    const currentRunId = runIdRef.current;
    const controller = replaceController("reparse");
    parseInFlightRef.current = true;
    activeParseRunIdRef.current = null;
    setParseStatus("queued");
    setLastReportedParseProgress(0);
    setParseProgress(0);
    setParsePhase("queued");
    setParseError(null);
    addActivity("parseRequested");
    addActivity("parsing");
    try {
      const result = await reparsePersistedDocument(
        documentId,
        controller.signal,
        (run) => applyParseRunStatus(run, currentRunId),
      );
      if (runIdRef.current !== currentRunId) return;
      activeParseRunIdRef.current = result.parseRunId;
      const selection = {
        selectedParseRunId: result.parseRunId,
        selectedChunkRunId: null,
        selectedEmbeddingRunId: null,
      };
      if (!await persistActivePipelineSelectionRef.current(selection)) return;
      const snapshot = await loadDocumentSnapshot(
        documentId,
        controller.signal,
        selection,
        Boolean(activePipelineRef.current),
      );
      if (runIdRef.current !== currentRunId) return;
      parseInFlightRef.current = false;
      runIdRef.current += 1;
      documentEpochRef.current += 1;
      selectionRequestRef.current += 1;
      removeControllerIfCurrent(controllersRef.current, "reparse", controller);
      commitDocumentSnapshot(snapshot);
      setParseStatus("completed");
      setParseResult(result);
      setLastReportedParseProgress(100);
      setParseProgress(100);
      setParsePhase("completed");
      setEvaluationRun(null);
      addActivity("parseCompleted");
      setDocuments((current) => current.map((document) => document.id === documentId ? {
        ...document,
        pageCount: snapshot.detail.pageCount,
        activeParseRunId: snapshot.detail.activeParseRunId,
        activeChunkRunId: snapshot.detail.activeChunkRunId,
        activeEmbeddingRunId: snapshot.detail.activeEmbeddingRunId,
      } : document));
    } catch (error) {
      if (runIdRef.current !== currentRunId || (error instanceof DOMException && error.name === "AbortError")) return;
      const apiError = asApiError(error, "The persisted document could not be reparsed.");
      setParseError(apiError);
      if (apiError.code !== "parse_poll_timeout") {
        setParseStatus("failed");
        addActivity("parseFailed", apiError.code);
      }
    } finally {
      if (runIdRef.current === currentRunId) {
        parseInFlightRef.current = false;
        removeControllerIfCurrent(controllersRef.current, "reparse", controller);
      }
    }
  }, [addActivity, applyParseRunStatus, commitDocumentSnapshot, loadDocumentSnapshot, parseStatus, replaceController]);

  const parseActiveDocument = reparseActiveDocument;

  const replacePipelineState = useCallback((pipeline: DocumentPipeline) => {
    pipelineRevisionRef.current.set(pipeline.id, pipeline.revision);
    activePipelineRef.current = pipeline;
    setActivePipelineId(pipeline.id);
    setPipelines((current) => current.map((item) => item.id === pipeline.id ? pipeline : item));
    setPersistenceError(null);
  }, []);

  const pipelineMutationIsCurrent = useCallback((context: PipelineMutationContext) => (
    selectionRequestRef.current === context.requestId
    && documentEpochRef.current === context.documentEpoch
    && activeDocumentRef.current?.id === context.documentId
    && activePipelineRef.current?.id === context.pipelineId
  ), []);

  const recordPipelineResponse = useCallback((
    pipeline: DocumentPipeline,
    context: PipelineMutationContext,
  ) => {
    pipelineRevisionRef.current.set(pipeline.id, pipeline.revision);
    if (pipelineMutationIsCurrent(context)) {
      replacePipelineState(pipeline);
      return;
    }
    const active = activePipelineRef.current;
    const next = active?.id === pipeline.id
      ? {
          ...pipeline,
          parseRunId: active.parseRunId,
          chunkRunId: active.chunkRunId,
          embeddingRunId: active.embeddingRunId,
        }
      : pipeline;
    if (active?.id === pipeline.id) activePipelineRef.current = next;
    setPipelines((items) => items.map((item) => item.id === pipeline.id ? next : item));
  }, [pipelineMutationIsCurrent, replacePipelineState]);

  const persistActivePipelineSelection = useCallback(async (
    selection: DocumentLineageSelection,
  ): Promise<boolean> => {
    const current = activePipelineRef.current;
    if (!current) {
      if (activeDocumentRef.current) rememberSelection(activeDocumentRef.current.id, selection);
      return true;
    }
    const context: PipelineMutationContext = {
      documentId: current.documentId,
      pipelineId: current.id,
      requestId: selectionRequestRef.current,
      documentEpoch: documentEpochRef.current,
    };
    pipelineRevisionRef.current.set(current.id, pipelineRevisionRef.current.get(current.id) ?? current.revision);

    const persist = async (): Promise<boolean> => {
      const expectedRevision = pipelineRevisionRef.current.get(context.pipelineId) ?? current.revision;
      const input = {
        expectedRevision,
        parseRunId: selection.selectedParseRunId,
        chunkRunId: selection.selectedChunkRunId,
        embeddingRunId: selection.selectedEmbeddingRunId,
      };
      try {
        recordPipelineResponse(await updateDocumentPipeline(context.pipelineId, input), context);
        return true;
      } catch (error) {
        const conflict = error instanceof DocumentApiError && error.code === "pipeline_conflict";
        if (!pipelineMutationIsCurrent(context)) return false;
        const controller = replaceController(`pipeline-conflict:${context.pipelineId}`);
        try {
          const nextPipelines = await listDocumentPipelines(context.documentId, controller.signal);
          nextPipelines.forEach((item) => pipelineRevisionRef.current.set(item.id, item.revision));
          if (!pipelineMutationIsCurrent(context)) return false;
          setPipelines(nextPipelines);
          const refreshed = nextPipelines.find((item) => item.id === context.pipelineId) ?? null;
          if (!refreshed || !pipelineMutationIsCurrent(context)) return false;
          pipelineRevisionRef.current.set(refreshed.id, refreshed.revision);
          activePipelineRef.current = refreshed;
          setActivePipelineId(refreshed.id);
          const snapshot = await loadDocumentSnapshot(
            refreshed.documentId,
            controller.signal,
            pipelineSelection(refreshed),
            true,
          );
          if (!pipelineMutationIsCurrent(context)) return false;
          // Snapshot commit, geç bir conflict cevabının yeni seçimi ezebileceği son kritik sınırdır.
          commitDocumentSnapshot(snapshot, false);
          if (!conflict) {
            if (pipelineMutationIsCurrent(context)) {
              setPersistenceError(asApiError(error, "Pipeline selection could not be saved."));
            }
            return false;
          }
          const desiredAlreadyPersisted = refreshed.parseRunId === selection.selectedParseRunId
            && refreshed.chunkRunId === selection.selectedChunkRunId
            && refreshed.embeddingRunId === selection.selectedEmbeddingRunId;
          if (desiredAlreadyPersisted) return true;
          if (!pipelineMutationIsCurrent(context)) return false;
          const retried = await updateDocumentPipeline(refreshed.id, {
            ...input,
            expectedRevision: refreshed.revision,
          }, controller.signal);
          recordPipelineResponse(retried, context);
          if (!pipelineMutationIsCurrent(context) || activeDocumentRef.current?.id !== context.documentId) return false;
          commitDocumentSnapshot(buildDocumentSnapshot(activeDocumentRef.current, selection, true), false);
          return true;
        } catch (reconcileError) {
          if (!(reconcileError instanceof DOMException && reconcileError.name === "AbortError")
            && pipelineMutationIsCurrent(context)) {
            setPersistenceError(asApiError(reconcileError, "Pipeline conflict could not be reconciled."));
          }
          return false;
        } finally {
          removeControllerIfCurrent(controllersRef.current, `pipeline-conflict:${context.pipelineId}`, controller);
        }
      }
    };

    const previous = pipelineMutationQueueRef.current.get(current.id) ?? Promise.resolve(true);
    const queued = previous.catch(() => false).then(persist);
    pipelineMutationQueueRef.current.set(current.id, queued);
    void queued.finally(() => {
      if (pipelineMutationQueueRef.current.get(current.id) === queued) {
        pipelineMutationQueueRef.current.delete(current.id);
      }
    });
    return queued;
  }, [buildDocumentSnapshot, commitDocumentSnapshot, loadDocumentSnapshot, pipelineMutationIsCurrent, recordPipelineResponse, rememberSelection, replaceController]);
  useEffect(() => {
    persistActivePipelineSelectionRef.current = persistActivePipelineSelection;
  }, [persistActivePipelineSelection]);

  const selectPipeline = useCallback(async (pipelineId: string | null) => {
    const document = activeDocumentRef.current;
    if (!document) return;
    const pipeline = pipelineId ? pipelines.find((item) => item.id === pipelineId && item.documentId === document.id) ?? null : null;
    if (pipelineId && !pipeline) return;
    const controller = replaceController("pipeline-select");
    const requestId = ++selectionRequestRef.current;
    try {
      const selection = pipeline ? pipelineSelection(pipeline) : lineageSelectionsRef.current[document.id] ?? emptyLineageSelection();
      const summaryIsFresh = Date.now() - activeDocumentSummaryLoadedAtRef.current <= SUMMARY_CACHE_MAX_AGE_MS;
      const snapshot = summaryIsFresh
        ? buildDocumentSnapshot(document, selection, Boolean(pipeline))
        : await loadDocumentSnapshot(document.id, controller.signal, selection, Boolean(pipeline));
      if (selectionRequestRef.current !== requestId || activeDocumentRef.current?.id !== document.id) return;
      activePipelineRef.current = pipeline;
      if (pipeline) pipelineRevisionRef.current.set(pipeline.id, pipeline.revision);
      setActivePipelineId(pipeline?.id ?? null);
      rememberActivePipeline(pipeline?.id ?? null, authUserId, document.id);
      commitDocumentSnapshot(snapshot, !pipeline);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setPersistenceError(asApiError(error, "Pipeline could not be selected."));
      }
    } finally {
      removeControllerIfCurrent(controllersRef.current, "pipeline-select", controller);
    }
  }, [authUserId, buildDocumentSnapshot, commitDocumentSnapshot, loadDocumentSnapshot, pipelines, replaceController]);

  const createPipeline = useCallback(async (name: string) => {
    const document = activeDocumentRef.current;
    if (!document) return null;
    const controller = replaceController("pipeline-create");
    try {
      const pipeline = await createDocumentPipeline(document.id, {
        name,
        parseRunId: selectedParseRunId,
        chunkRunId: selectedChunkRunId,
        embeddingRunId: selectedEmbeddingRunId,
      }, controller.signal);
      if (pipeline.documentId !== document.id) {
        throw new DocumentApiError("incompatible_lineage", "The created pipeline belongs to a different document.");
      }
      setPipelines((current) => [...current, pipeline]);
      pipelineRevisionRef.current.set(pipeline.id, pipeline.revision);
      activePipelineRef.current = pipeline;
      setActivePipelineId(pipeline.id);
      rememberActivePipeline(pipeline.id, authUserId, document.id);
      commitDocumentSnapshot(buildDocumentSnapshot(document, pipelineSelection(pipeline), true), false);
      setPersistenceError(null);
      return pipeline;
    } catch (error) {
      setPersistenceError(asApiError(error, "Pipeline could not be created."));
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "pipeline-create", controller);
    }
  }, [authUserId, buildDocumentSnapshot, commitDocumentSnapshot, replaceController, selectedChunkRunId, selectedEmbeddingRunId, selectedParseRunId]);

  const renamePipeline = useCallback(async (pipelineId: string, name: string) => {
    const current = pipelines.find((item) => item.id === pipelineId);
    if (!current) return null;
    const mutationContext: PipelineMutationContext | null = activePipelineRef.current?.id === pipelineId
      ? {
          documentId: current.documentId,
          pipelineId,
          requestId: selectionRequestRef.current,
          documentEpoch: documentEpochRef.current,
        }
      : null;
    try {
      const updated = await updateDocumentPipeline(pipelineId, { expectedRevision: current.revision, name });
      setPipelines((items) => items.map((item) => item.id === updated.id ? updated : item));
      setPersistenceError(null);
      if (activePipelineRef.current?.id === updated.id) replacePipelineState(updated);
      return updated;
    } catch (error) {
      if (error instanceof DocumentApiError && error.code === "pipeline_conflict") {
        try {
          const refreshed = await listDocumentPipelines(current.documentId);
          setPipelines(refreshed);
          const latest = refreshed.find((item) => item.id === pipelineId);
          refreshed.forEach((item) => pipelineRevisionRef.current.set(item.id, item.revision));
          if (latest && mutationContext && pipelineMutationIsCurrent(mutationContext)) {
            replacePipelineState(latest);
            const controller = replaceController(`pipeline-rename-conflict:${pipelineId}`);
            try {
              const snapshot = await loadDocumentSnapshot(latest.documentId, controller.signal, pipelineSelection(latest), true);
              if (!pipelineMutationIsCurrent(mutationContext)) return null;
              commitDocumentSnapshot(snapshot, false);
            } finally {
              removeControllerIfCurrent(controllersRef.current, `pipeline-rename-conflict:${pipelineId}`, controller);
            }
          }
          if (latest?.name === name) return latest;
          if (latest) {
            if (mutationContext && !pipelineMutationIsCurrent(mutationContext)) return null;
            const updated = await updateDocumentPipeline(pipelineId, { expectedRevision: latest.revision, name });
            setPipelines((items) => items.map((item) => item.id === updated.id ? updated : item));
            if (mutationContext && pipelineMutationIsCurrent(mutationContext)) replacePipelineState(updated);
            return updated;
          }
        } catch (reconcileError) {
          setPersistenceError(asApiError(reconcileError, "Pipeline rename conflict could not be reconciled."));
          return null;
        }
      }
      setPersistenceError(asApiError(error, "Pipeline could not be renamed."));
      return null;
    }
  }, [commitDocumentSnapshot, loadDocumentSnapshot, pipelineMutationIsCurrent, pipelines, replaceController, replacePipelineState]);

  const deletePipeline = useCallback(async (pipelineId: string) => {
    const current = pipelines.find((item) => item.id === pipelineId);
    if (!current) return;
    try {
      await deleteDocumentPipeline(pipelineId);
      setPersistenceError(null);
      setPipelines((items) => items.filter((item) => item.id !== pipelineId));
      const activePipeline = activePipelineRef.current;
      if (activePipeline?.id === pipelineId) {
        const document = activeDocumentRef.current;
        if (document) rememberSelection(document.id, { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId });
        activePipelineRef.current = null;
        setActivePipelineId(null);
        rememberActivePipeline(null, authUserId, activePipeline.documentId);
      }
    } catch (error) {
      setPersistenceError(asApiError(error, "Pipeline could not be deleted."));
    }
  }, [authUserId, pipelines, rememberSelection, selectedChunkRunId, selectedEmbeddingRunId, selectedParseRunId]);

  const inspectParseRun = useCallback(async (runId: string): Promise<ParseRun | null> => {
    const document = activeDocumentRef.current;
    const summary = document?.parseRuns.find((run) => run.id === runId);
    if (!document || !summary || summary.status !== "completed") return null;
    const expectedSelection = selectionRequestRef.current;
    const expectedInspection = beginArtifactInspection("parse", runId);
    setParseResult(null);
    setParseError(null);
    setParseStatus("ready");
    return hydrateParseDetail(document.id, runId, expectedSelection, expectedInspection);
  }, [beginArtifactInspection, hydrateParseDetail]);

  const inspectChunkRun = useCallback(async (runId: string): Promise<ChunkRun | null> => {
    const document = activeDocumentRef.current;
    const summary = document?.chunkRuns.find((run) => run.id === runId);
    if (!document || !summary || summary.status !== "completed") return null;
    const expectedSelection = selectionRequestRef.current;
    const expectedInspection = beginArtifactInspection("chunk", runId);
    setChunkRun(null);
    setChunkError(null);
    setChunkStatus("ready");
    return hydrateChunkDetail(document.id, runId, expectedSelection, expectedInspection);
  }, [beginArtifactInspection, hydrateChunkDetail]);

  const inspectEmbeddingRun = useCallback(async (runId: string): Promise<EmbeddingRun | null> => {
    const document = activeDocumentRef.current;
    const summary = document?.embeddingRuns.find((run) => run.id === runId);
    if (!document || !summary || summary.status !== "completed") return null;
    const expectedSelection = selectionRequestRef.current;
    const expectedInspection = beginArtifactInspection("embedding", runId);
    setEmbeddingRun(null);
    setEmbeddingError(null);
    setEmbeddingStatus("ready");
    return hydrateEmbeddingDetail(document.id, runId, expectedSelection, expectedInspection);
  }, [beginArtifactInspection, hydrateEmbeddingDetail]);

  const selectParseRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.parseRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary)) return;
    // Saved pipelines are immutable through the historical selector. Use the
    // explicit setPipeline* action when the working lineage should change.
    if (activePipelineRef.current) {
      await inspectParseRun(runId);
      return;
    }
    const selection = { selectedParseRunId: runId, selectedChunkRunId: null, selectedEmbeddingRunId: null };
    const requestId = ++selectionRequestRef.current;
    rememberSelection(document.id, selection);
    setSelectedParseRunId(runId);
    setSelectedChunkRunId(null);
    setSelectedEmbeddingRunId(null);
    inspectionRequestRef.current += 1;
    setInspectedSelection(selection);
    setParseResult(null);
    setChunkRun(null);
    setEmbeddingRun(null);
    setChunkStatus("ready");
    setEmbeddingStatus("locked");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    void hydrateParseDetail(document.id, runId, requestId, inspectionRequestRef.current);
  }, [hydrateParseDetail, inspectParseRun, rememberSelection, setInspectedSelection]);

  const selectChunkRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.chunkRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary)) return;
    if (activePipelineRef.current) {
      await inspectChunkRun(runId);
      return;
    }
    if (summary?.upstream.parseRunId !== selectedParseRunId) return;
    const selection = { selectedParseRunId, selectedChunkRunId: runId, selectedEmbeddingRunId: null };
    const requestId = ++selectionRequestRef.current;
    rememberSelection(document.id, selection);
    setSelectedChunkRunId(runId);
    setSelectedEmbeddingRunId(null);
    inspectionRequestRef.current += 1;
    setInspectedSelection(selection);
    setChunkRun(null);
    setEmbeddingRun(null);
    setChunkStatus("ready");
    setEmbeddingStatus("locked");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    void hydrateChunkDetail(document.id, runId, requestId, inspectionRequestRef.current);
  }, [hydrateChunkDetail, inspectChunkRun, rememberSelection, selectedParseRunId, setInspectedSelection]);

  const selectEmbeddingRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.embeddingRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary)) return;
    if (activePipelineRef.current) {
      await inspectEmbeddingRun(runId);
      return;
    }
    if (summary?.upstream.chunkRunId !== selectedChunkRunId) return;
    const selection = { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId: runId };
    const requestId = ++selectionRequestRef.current;
    rememberSelection(document.id, selection);
    setSelectedEmbeddingRunId(runId);
    inspectionRequestRef.current += 1;
    setInspectedSelection(selection);
    setEmbeddingRun(null);
    setEmbeddingStatus("ready");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    void hydrateEmbeddingDetail(document.id, runId, requestId, inspectionRequestRef.current);
  }, [hydrateEmbeddingDetail, inspectEmbeddingRun, rememberSelection, selectedChunkRunId, selectedParseRunId, setInspectedSelection]);

  const rejectPipelineSelection = useCallback((message: string) => {
    setPersistenceError(new DocumentApiError("incompatible_lineage", message));
    return false;
  }, []);

  const setPipelineParseRun = useCallback(async (runId: string): Promise<boolean> => {
    const document = activeDocumentRef.current;
    const pipeline = activePipelineRef.current;
    const summary = document?.parseRuns.find((run) => run.id === runId);
    if (!document || !pipeline || pipeline.documentId !== document.id || !completedCompatibleRun(summary)) {
      return rejectPipelineSelection("The selected parse run cannot be used by this pipeline.");
    }
    const selection = { selectedParseRunId: runId, selectedChunkRunId: null, selectedEmbeddingRunId: null };
    const requestId = ++selectionRequestRef.current;
    replacePipelineState({ ...pipeline, parseRunId: runId, chunkRunId: null, embeddingRunId: null });
    setSelectedParseRunId(runId);
    setSelectedChunkRunId(null);
    setSelectedEmbeddingRunId(null);
    inspectionRequestRef.current += 1;
    setInspectedSelection(selection);
    setParseResult(null);
    setChunkRun(null);
    setEmbeddingRun(null);
    setChunkStatus("ready");
    setEmbeddingStatus("locked");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    const persisted = await persistActivePipelineSelection(selection);
    if (!persisted || selectionRequestRef.current !== requestId || activeDocumentRef.current?.id !== document.id) return false;
    void hydrateParseDetail(document.id, runId, requestId, inspectionRequestRef.current);
    return true;
  }, [hydrateParseDetail, persistActivePipelineSelection, rejectPipelineSelection, replacePipelineState, setInspectedSelection]);

  const setPipelineChunkRun = useCallback(async (runId: string): Promise<boolean> => {
    const document = activeDocumentRef.current;
    const pipeline = activePipelineRef.current;
    const summary = document?.chunkRuns.find((run) => run.id === runId);
    if (!document || !pipeline || pipeline.documentId !== document.id || !pipeline.parseRunId || !completedCompatibleRun(summary)
      || summary?.upstream.parseRunId !== pipeline.parseRunId) {
      return rejectPipelineSelection("The selected chunk run is not a child of this pipeline's parse run.");
    }
    const selection = { selectedParseRunId: pipeline.parseRunId, selectedChunkRunId: runId, selectedEmbeddingRunId: null };
    const requestId = ++selectionRequestRef.current;
    replacePipelineState({ ...pipeline, chunkRunId: runId, embeddingRunId: null });
    setSelectedParseRunId(selection.selectedParseRunId);
    setSelectedChunkRunId(runId);
    setSelectedEmbeddingRunId(null);
    inspectionRequestRef.current += 1;
    setInspectedSelection(selection);
    setChunkRun(null);
    setEmbeddingRun(null);
    setChunkStatus("ready");
    setEmbeddingStatus("locked");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    const persisted = await persistActivePipelineSelection(selection);
    if (!persisted || selectionRequestRef.current !== requestId || activeDocumentRef.current?.id !== document.id) return false;
    void hydrateChunkDetail(document.id, runId, requestId, inspectionRequestRef.current);
    return true;
  }, [hydrateChunkDetail, persistActivePipelineSelection, rejectPipelineSelection, replacePipelineState, setInspectedSelection]);

  const setPipelineEmbeddingRun = useCallback(async (runId: string): Promise<boolean> => {
    const document = activeDocumentRef.current;
    const pipeline = activePipelineRef.current;
    const summary = document?.embeddingRuns.find((run) => run.id === runId);
    if (!document || !pipeline || pipeline.documentId !== document.id || !pipeline.parseRunId || !pipeline.chunkRunId
      || !completedCompatibleRun(summary) || summary?.upstream.chunkRunId !== pipeline.chunkRunId) {
      return rejectPipelineSelection("The selected embedding run is not a child of this pipeline's chunk run.");
    }
    const selection = { selectedParseRunId: pipeline.parseRunId, selectedChunkRunId: pipeline.chunkRunId, selectedEmbeddingRunId: runId };
    const requestId = ++selectionRequestRef.current;
    replacePipelineState({ ...pipeline, embeddingRunId: runId });
    setSelectedParseRunId(selection.selectedParseRunId);
    setSelectedChunkRunId(selection.selectedChunkRunId);
    setSelectedEmbeddingRunId(runId);
    inspectionRequestRef.current += 1;
    setInspectedSelection(selection);
    setEmbeddingRun(null);
    setEmbeddingStatus("ready");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    const persisted = await persistActivePipelineSelection(selection);
    if (!persisted || selectionRequestRef.current !== requestId || activeDocumentRef.current?.id !== document.id) return false;
    void hydrateEmbeddingDetail(document.id, runId, requestId, inspectionRequestRef.current);
    return true;
  }, [hydrateEmbeddingDetail, persistActivePipelineSelection, rejectPipelineSelection, replacePipelineState, setInspectedSelection]);

  const runChunking = useCallback(async (strategy: ChunkStrategy, config: ChunkConfig): Promise<ChunkRun | null> => {
    const documentId = activeDocumentRef.current?.id;
    const parseRunId = selectedParseRunId;
    if (!documentId || !parseRunId || chunkStatus === "processing") return null;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const controller = replaceController("chunk");
    setChunkStatus("processing");
    setChunkError(null);
    setEmbeddingRun(null);
    setExperimentRun(null);
    setEvaluationRun(null);
    try {
      const result = await createChunkRun(documentId, strategy, config, parseRunId, controller.signal);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedParseRunId !== parseRunId) return null;
      const selection = {
        selectedParseRunId: parseRunId,
        selectedChunkRunId: result.id,
        selectedEmbeddingRunId: null,
      };
      if (!await persistActivePipelineSelection(selection)) return null;
      const snapshot = await loadDocumentSnapshot(documentId, controller.signal, selection, Boolean(activePipelineRef.current));
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedParseRunId !== parseRunId) return null;
      commitDocumentSnapshot(snapshot);
      cacheArtifact("chunk", result.id, result);
      setChunkRun(result);
      setChunkStatus("completed");
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedParseRunId !== parseRunId) return null;
      setChunkError(asApiError(error, "Chunking could not be completed."));
      setChunkStatus("error");
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "chunk", controller);
    }
  }, [cacheArtifact, chunkStatus, commitDocumentSnapshot, loadDocumentSnapshot, persistActivePipelineSelection, replaceController, selectedParseRunId]);

  const runEmbedding = useCallback(async (): Promise<EmbeddingRun | null> => {
    const documentId = activeDocumentRef.current?.id;
    const chunkRunId = selectedChunkRunId;
    if (!documentId || !chunkRunId || embeddingStatus === "processing") return null;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const controller = replaceController("embedding");
    setEmbeddingStatus("processing");
    setEmbeddingError(null);
    setExperimentRun(null);
    setEvaluationRun(null);
    try {
      const result = await createEmbeddingRun(documentId, chunkRunId, controller.signal);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId) return null;
      const selection = {
        selectedParseRunId,
        selectedChunkRunId: chunkRunId,
        selectedEmbeddingRunId: result.id,
      };
      if (!await persistActivePipelineSelection(selection)) return null;
      const snapshot = await loadDocumentSnapshot(documentId, controller.signal, selection, Boolean(activePipelineRef.current));
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId) return null;
      commitDocumentSnapshot(snapshot);
      cacheArtifact("embedding", result.id, result);
      setEmbeddingRun(result);
      setEmbeddingStatus("completed");
      return result;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId) return null;
      setEmbeddingError(asApiError(error, "Embeddings could not be created."));
      setEmbeddingStatus("error");
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "embedding", controller);
    }
  }, [cacheArtifact, commitDocumentSnapshot, embeddingStatus, loadDocumentSnapshot, persistActivePipelineSelection, replaceController, selectedChunkRunId, selectedParseRunId]);

  const commitExperimentResult = useCallback((result: ExperimentRun) => {
    setExperimentRun(result);
    setExperimentHistory((current) => [result, ...current.filter((run) => run.id !== result.id)]);
    setExperimentError(result.error ? new DocumentApiError(result.error.code, result.error.message) : null);
    setExperimentStatus(result.status === "completed" ? "completed" : result.status === "running" ? "processing" : "error");
    setEvaluationStatus(evaluationDatasets.length > 0 ? "ready" : "locked");
  }, [evaluationDatasets.length]);

  const commitEvaluationResult = useCallback((result: EvaluationRun) => {
    setEvaluationRun(result);
    setEvaluationHistory((current) => [result, ...current.filter((run) => run.id !== result.id)]);
    setEvaluationError(result.error ? new DocumentApiError(result.error.code, result.error.message) : null);
    setEvaluationStatus(result.status === "completed" ? "completed" : result.status === "running" || result.status === "queued" ? "processing" : "error");
  }, []);

  const runExperiment = useCallback(async (input: Omit<ExperimentRequest, "documentId" | "chunkRunId" | "embeddingRunId">) => {
    const documentId = activeDocumentRef.current?.id;
    const chunkRunId = selectedChunkRunId;
    const embeddingRunId = input.retrieval.mode === "keyword" ? null : selectedEmbeddingRunId;
    if (!documentId || !chunkRunId || experimentStatus === "processing") return;
    if (input.retrieval.mode !== "keyword" && !embeddingRunId) return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const controller = replaceController("experiment");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await createExperimentAsync({
        ...input,
        documentId,
        chunkRunId,
        embeddingRunId,
        pipelineId: activePipelineRef.current?.id ?? null,
      }, controller.signal, (progressRun) => {
        if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
        setExperimentRun(progressRun);
        setExperimentHistory((current) => [progressRun, ...current.filter((run) => run.id !== progressRun.id)]);
        setExperimentStatus(progressRun.status === "running" ? "processing" : progressRun.status === "completed" ? "completed" : "error");
      });
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId || (input.retrieval.mode !== "keyword" && selectedEmbeddingRunId !== embeddingRunId)) return;
      commitExperimentResult(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId || selectedEmbeddingRunId !== embeddingRunId) return;
      setExperimentError(asApiError(error, "The experiment could not be completed."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment", controller);
    }
  }, [commitExperimentResult, experimentStatus, replaceController, selectedChunkRunId, selectedEmbeddingRunId]);

  const loadExperiment = useCallback(async (experimentId: string) => {
    const documentId = activeDocumentRef.current?.id;
    if (!documentId) return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const cached = readArtifact<ExperimentRun>("experiment", experimentId);
    if (cached && cached.documentId === documentId) {
      commitExperimentResult(cached);
      return;
    }
    if (controllersRef.current.has("experiment-load")) return;
    const controller = replaceController("experiment-load");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await getExperiment(experimentId, controller.signal);
      if (result.documentId !== documentId) {
        throw new DocumentApiError("incompatible_lineage", "The selected experiment belongs to a different document.");
      }
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
      cacheArtifact("experiment", experimentId, result);
      commitExperimentResult(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
      setExperimentError(asApiError(error, "The experiment could not be loaded."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment-load", controller);
    }
  }, [cacheArtifact, commitExperimentResult, readArtifact, replaceController]);

  const loadEvaluationDataset = useCallback(async (datasetId: string): Promise<EvaluationDataset | null> => {
    const activeSummary = activeDocumentRef.current;
    const documentId = activeSummary?.id;
    if (!documentId || !activeSummary.evaluationDatasets.some((dataset) => dataset.id === datasetId)) return null;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const cached = readArtifact<EvaluationDataset>("dataset", datasetId);
    if (cached && cached.documentId === documentId) return cached;
    const controllerKey = `detail:dataset:${documentId}:${datasetId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const dataset = await getEvaluationDataset(datasetId, controller.signal);
      if (dataset.documentId !== documentId) {
        throw new DocumentApiError("incompatible_lineage", "The selected evaluation dataset belongs to a different document.");
      }
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return dataset;
      cacheArtifact("dataset", datasetId, dataset);
      return dataset;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && documentEpochRef.current === epoch && selectionRequestRef.current === selectionVersion && activeDocumentRef.current?.id === documentId) {
        setEvaluationError(asApiError(error, "The selected evaluation dataset could not be loaded."));
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [cacheArtifact, readArtifact, replaceController]);

  const loadEvaluationRun = useCallback(async (runId: string) => {
    const activeSummary = activeDocumentRef.current;
    const documentId = activeSummary?.id;
    if (!documentId) return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const belongsToDocument = (run: EvaluationRun) => activeDocumentRef.current?.evaluationDatasets.some((dataset) => dataset.id === run.datasetId) ?? false;
    const cached = readArtifact<EvaluationRun>("evaluation", runId);
    if (cached && belongsToDocument(cached)) {
      commitEvaluationResult(cached);
      return;
    }
    if (controllersRef.current.has("evaluation-load")) return;
    const controller = replaceController("evaluation-load");
    setEvaluationStatus("processing");
    setEvaluationError(null);
    try {
      const result = await getEvaluationRun(runId, controller.signal);
      if (!belongsToDocument(result)) {
        throw new DocumentApiError("incompatible_lineage", "The selected evaluation run belongs to a different document.");
      }
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
      cacheArtifact("evaluation", runId, result);
      commitEvaluationResult(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
      setEvaluationError(asApiError(error, "The selected evaluation run could not be loaded."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation-load", controller);
    }
  }, [cacheArtifact, commitEvaluationResult, readArtifact, replaceController]);

  useEffect(() => {
    const documentId = activeDocumentRef.current?.id;
    if (!documentId) return;
    const expectedSelection = selectionRequestRef.current;
    const needsParseDetail = pathname === "/parse"
      || pathname === "/documents/parsed"
      || pathname === "/playground"
      || pathname === "/retrieval"
      || pathname === "/evaluation";
    if (needsParseDetail && selectedParseRunId) {
      void hydrateParseDetail(documentId, selectedParseRunId, expectedSelection);
    }
    if ((pathname === "/chunking" || pathname === "/documents/chunks") && selectedChunkRunId) {
      void hydrateChunkDetail(documentId, selectedChunkRunId, expectedSelection);
    }
    if (pathname === "/embeddings" && selectedEmbeddingRunId) {
      void hydrateEmbeddingDetail(documentId, selectedEmbeddingRunId, expectedSelection);
    }
    if ((pathname === "/playground" || pathname === "/retrieval") && !experimentRun) {
      const summary = activeDocumentRef.current?.experiments.find((run) => run.isCompatible
        && run.upstream.chunkRunId === selectedChunkRunId
        && (run.embeddingRunId === null || run.embeddingRunId === selectedEmbeddingRunId));
      if (summary) void loadExperiment(summary.id);
    }
    if (pathname === "/evaluation") {
      const dataset = activeDocumentRef.current?.evaluationDatasets[0];
      if (dataset) void loadEvaluationDataset(dataset.id);
    }
  }, [
    experimentRun,
    hydrateChunkDetail,
    hydrateEmbeddingDetail,
    hydrateParseDetail,
    loadExperiment,
    loadEvaluationDataset,
    pathname,
    selectedChunkRunId,
    selectedEmbeddingRunId,
    selectedParseRunId,
    evaluationDatasets,
  ]);

  const continueCurrentExperiment = useCallback(async () => {
    const documentId = activeDocumentRef.current?.id;
    const experimentId = experimentRun?.id;
    if (!documentId || !experimentId || experimentStatus === "processing") return;
    const epoch = documentEpochRef.current;
    const controller = replaceController("experiment-continue");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await continueExperiment(experimentId, controller.signal);
      if (documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== documentId) return;
      commitExperimentResult(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== documentId) return;
      setExperimentError(asApiError(error, "The experiment could not continue."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment-continue", controller);
    }
  }, [commitExperimentResult, experimentRun?.id, experimentStatus, replaceController]);

  const rerunCurrentGeneration = useCallback(async () => {
    const documentId = activeDocumentRef.current?.id;
    const experimentId = experimentRun?.id;
    if (!documentId || !experimentId || experimentStatus === "processing") return;
    const epoch = documentEpochRef.current;
    const controller = replaceController("experiment-rerun-generation");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await rerunGeneration(experimentId, controller.signal);
      if (documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== documentId) return;
      commitExperimentResult(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== documentId) return;
      setExperimentError(asApiError(error, "Generation could not be run again."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment-rerun-generation", controller);
    }
  }, [commitExperimentResult, experimentRun?.id, experimentStatus, replaceController]);

  const createDataset = useCallback(async (name: string, cases: EvaluationCase[], baseDatasetId?: string | null) => {
    const documentId = activeDocumentRef.current?.id;
    const parseRunId = selectedParseRunId;
    if (!documentId || !parseRunId) return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const chunkRunId = selectedChunkRunId;
    const controller = replaceController("evaluation-dataset");
    setEvaluationStatus("processing");
    setEvaluationError(null);
    try {
      const dataset = await createEvaluationDataset({ documentId, parseRunId, name, cases, baseDatasetId }, controller.signal);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedParseRunId !== parseRunId || selectedChunkRunId !== chunkRunId) return;
      const summary: EvaluationDatasetSummary = {
        id: dataset.id,
        documentId: dataset.documentId,
        parseRunId: dataset.parseRunId,
        name: dataset.name,
        version: dataset.version,
        seriesId: dataset.seriesId,
        caseCount: dataset.cases.length,
        createdAt: dataset.createdAt,
      };
      cacheArtifact("dataset", dataset.id, dataset);
      setEvaluationDatasets((current) => [summary, ...current.filter((item) => item.id !== summary.id)]);
      setEvaluationStatus(selectedChunkRunId ? "ready" : "locked");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setEvaluationError(asApiError(error, "The evaluation dataset could not be created."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation-dataset", controller);
    }
  }, [cacheArtifact, replaceController, selectedChunkRunId, selectedParseRunId]);

  const runEvaluation = useCallback(async (input: EvaluationRunInput) => {
    const chunkRunId = selectedChunkRunId;
    const embeddingRunId = input.retrieval.mode === "keyword" ? null : selectedEmbeddingRunId;
    if (!chunkRunId || (input.retrieval.mode !== "keyword" && !embeddingRunId) || evaluationStatus === "processing") return;
    const documentId = activeDocumentRef.current?.id;
    if (!documentId) return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const controller = replaceController("evaluation");
    setEvaluationStatus("processing");
    setEvaluationError(null);
    try {
      const result = await createEvaluationRunAsync({
        ...input,
        pipelineId: activePipelineRef.current?.id ?? null,
        chunkRunId,
        embeddingRunId,
      }, controller.signal, (progressRun) => {
        if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
        setEvaluationRun(progressRun);
        setEvaluationHistory((current) => [progressRun, ...current.filter((run) => run.id !== progressRun.id)]);
        setEvaluationStatus(progressRun.status === "completed" ? "completed" : progressRun.status === "failed" ? "error" : "processing");
      });
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId || (input.retrieval.mode !== "keyword" && selectedEmbeddingRunId !== embeddingRunId)) return;
      setEvaluationRun(result);
      setEvaluationHistory((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      setEvaluationStatus(result.status === "completed" ? "completed" : result.status === "running" ? "processing" : "error");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId || (input.retrieval.mode !== "keyword" && selectedEmbeddingRunId !== embeddingRunId)) return;
      setEvaluationError(asApiError(error, "Evaluation could not be completed."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation", controller);
    }
  }, [evaluationStatus, replaceController, selectedChunkRunId, selectedEmbeddingRunId]);

  const refreshEvaluationRuns = useCallback(async (datasetId: string) => {
    const document = activeDocumentRef.current;
    const documentId = document?.id;
    if (!documentId || !document.evaluationDatasets.some((dataset) => dataset.id === datasetId)) return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const controller = replaceController("evaluation-history");
    try {
      const runs = await listEvaluationRuns(datasetId, controller.signal);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
      setEvaluationHistory(runs);
      const latestRun = runs.find((run) => run.status === "queued" || run.status === "running")
        ?? runs.find((run) => run.status === "completed" || run.status === "failed");
      if (!latestRun) {
        setEvaluationRun(null);
        return;
      }
      setEvaluationRun(latestRun);
      setEvaluationStatus(latestRun.status === "queued" || latestRun.status === "running" ? "processing" : latestRun.status === "completed" ? "completed" : "error");
      const detail = latestRun.status === "queued" || latestRun.status === "running"
        ? await waitForEvaluationRun(latestRun.id, controller.signal, (progress) => {
          if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
          setEvaluationRun(progress);
          setEvaluationHistory((current) => [progress, ...current.filter((run) => run.id !== progress.id)]);
        })
        : await getEvaluationRun(latestRun.id, controller.signal);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
      cacheArtifact("evaluation", detail.id, detail);
      commitEvaluationResult(detail);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId) return;
      setEvaluationError(asApiError(error, "Evaluation history could not be loaded."));
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation-history", controller);
    }
  }, [cacheArtifact, commitEvaluationResult, replaceController]);

  const activePipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === activePipelineId) ?? null,
    [activePipelineId, pipelines],
  );

  const value = useMemo<DocumentPipelineContextValue>(() => ({
    pendingUpload, fileError, parseStatus, parseProgress, parsePhase,
    parseProgressEstimated: parseProgress > lastReportedParseProgress,
    parseResult, parseError, activity,
    persistenceStatus, persistenceError, capabilities, documents, activeDocumentId, activeDocumentMetadata, activeDocument,
    selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId,
    inspectedParseRunId, inspectedChunkRunId, inspectedEmbeddingRunId,
    chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError,
    experimentStatus, experimentRun, experimentError, experimentHistory,
    evaluationDatasets, evaluationStatus, evaluationRun, evaluationError, evaluationHistory,
    uploadNotice,
    pipelines, activePipelineId, activePipeline,
    pipelineSelectionMode: activePipeline ? "saved" : "scratch",
    selectFile, addDocument, selectPersistedDocument, selectParseRun, selectChunkRun, selectEmbeddingRun, inspectParseRun, inspectChunkRun, inspectEmbeddingRun,
    setPipelineParseRun, setPipelineChunkRun, setPipelineEmbeddingRun, removeFile, parseSelectedFile, reparseActiveDocument, parseActiveDocument, runChunking, runEmbedding,
    runExperiment, loadExperiment, loadEvaluationDataset, loadEvaluationRun, continueExperiment: continueCurrentExperiment, rerunGeneration: rerunCurrentGeneration,
    createDataset, runEvaluation, refreshPersistence, refreshEvaluationRuns,
    selectPipeline, createPipeline, renamePipeline, deletePipeline,
  }), [
    activeDocument, activeDocumentId, activeDocumentMetadata, activePipeline, activePipelineId, activity, capabilities, chunkError, chunkRun, chunkStatus, createDataset, documents,
    embeddingError, embeddingRun, embeddingStatus, evaluationDatasets, evaluationError, evaluationHistory,
    evaluationRun, evaluationStatus, experimentError, experimentHistory, experimentRun, experimentStatus,
    fileError, lastReportedParseProgress, parseError, parsePhase, parseProgress, parseResult, parseSelectedFile, parseStatus, persistenceError, persistenceStatus,
    pendingUpload, pipelines, selectedChunkRunId, selectedEmbeddingRunId, selectedParseRunId, inspectedChunkRunId, inspectedEmbeddingRunId, inspectedParseRunId, uploadNotice,
    addDocument, reparseActiveDocument, parseActiveDocument,
    continueCurrentExperiment, inspectChunkRun, inspectEmbeddingRun, inspectParseRun, loadEvaluationDataset, loadEvaluationRun, loadExperiment, refreshEvaluationRuns, refreshPersistence, removeFile, rerunCurrentGeneration,
    runChunking, runEmbedding, runEvaluation, runExperiment,
    createPipeline, deletePipeline, renamePipeline, selectChunkRun, selectEmbeddingRun, selectFile, selectParseRun, selectPersistedDocument, selectPipeline,
    setPipelineChunkRun, setPipelineEmbeddingRun, setPipelineParseRun,
  ]);

  return <DocumentPipelineContext.Provider value={value}>{children}</DocumentPipelineContext.Provider>;
}

export function useDocumentPipeline() {
  const context = useContext(DocumentPipelineContext);
  if (!context) throw new Error("useDocumentPipeline must be used within DocumentPipelineProvider");
  return context;
}
