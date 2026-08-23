"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { DocumentApiError, type DocumentApiErrorCode } from "@/lib/document-api";
import { validatePdfFile, type DocumentFileValidationError } from "@/lib/document-file";
import type { DocumentParseResponse } from "@/lib/document-parse-types";
import {
  createChunkRun,
  createEmbeddingRun,
  createDocumentPipeline,
  createEvaluationDataset,
  createEvaluationRun,
  createExperiment,
  continueExperiment,
  getCapabilities,
  getChunkRun,
  getDocumentSummary,
  getEvaluationDataset,
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
} from "@/lib/rag-api";
import type {
  Capabilities,
  ChunkConfig,
  ChunkRun,
  ChunkStrategy,
  DocumentSummary,
  DocumentPipeline,
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
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type DocumentParseStatus = "not-started" | "ready" | "queued" | "running" | "completed" | "failed";
export type PipelineOperationStatus = "locked" | "ready" | "processing" | "completed" | "error" | "stale";
export type PersistenceStatus = "checking" | "available" | "unavailable";

export type DocumentActivityEvent = {
  id: number;
  type: DocumentActivityEventType;
  errorCode?: DocumentApiErrorCode;
};

export type DocumentLineageSelection = {
  selectedParseRunId: string | null;
  selectedChunkRunId: string | null;
  selectedEmbeddingRunId: string | null;
};

type LineageSelectionStore = Record<string, DocumentLineageSelection>;

type DocumentSnapshot = {
  detail: DocumentSummary;
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

type EvaluationRunInput = {
  datasetId: string;
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
  pipelines: DocumentPipeline[];
  activePipelineId: string | null;
  activePipeline: DocumentPipeline | null;
  selectFile: (file: File | undefined) => void;
  addDocument: (file: File) => Promise<PersistedDocument | null>;
  selectPersistedDocument: (documentId: string) => Promise<void>;
  selectParseRun: (runId: string) => Promise<void>;
  selectChunkRun: (runId: string) => Promise<void>;
  selectEmbeddingRun: (runId: string) => Promise<void>;
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
  continueExperiment: () => Promise<void>;
  rerunGeneration: () => Promise<void>;
  createDataset: (name: string, cases: EvaluationCase[]) => Promise<void>;
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

function activePipelineStorageKey(userId?: string | null) {
  return userId ? `${ACTIVE_PIPELINE_STORAGE_PREFIX}${userId}` : ACTIVE_PIPELINE_STORAGE_KEY;
}

function rememberActivePipeline(pipelineId: string | null, userId?: string | null) {
  try {
    const key = activePipelineStorageKey(userId);
    if (pipelineId) window.localStorage.setItem(key, pipelineId);
    else window.localStorage.removeItem(key);
  } catch {
    // Pipeline kimliği yalnız oturum kolaylığıdır; asıl seçim server state'idir.
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
  const [authUserId, setAuthUserId] = useState<string | null>(process.env.NODE_ENV === "test" ? "test-user" : null);
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [fileError, setFileError] = useState<DocumentFileValidationError | null>(null);
  const [parseStatus, setParseStatus] = useState<DocumentParseStatus>("not-started");
  const [parseProgress, setParseProgress] = useState(0);
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
  const [pipelines, setPipelines] = useState<DocumentPipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<string | null>(null);
  const runIdRef = useRef(0);
  const documentEpochRef = useRef(0);
  const documentLoadRequestRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const activeDocumentRef = useRef<DocumentSummary | null>(null);
  const activePipelineRef = useRef<DocumentPipeline | null>(null);
  const authUserIdRef = useRef<string | null>(authUserId);
  const lineageSelectionsRef = useRef<LineageSelectionStore>({});
  const activityIdRef = useRef(0);
  const controllersRef = useRef(new Map<string, AbortController>());
  const artifactCacheRef = useRef(new Map<string, ParseRun | ChunkRun | EmbeddingRun | ExperimentRun | EvaluationDataset>());
  const persistActivePipelineSelectionRef = useRef<(selection: DocumentLineageSelection) => Promise<boolean>>(async () => false);

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
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    activeParseRunIdRef.current = null;
    activeDocumentRef.current = null;
    activePipelineRef.current = null;
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
    try {
      const supabase = getSupabaseBrowserClient();
      void supabase.auth.getUser().then(({ data }) => handleAuthUserChange(data.user?.id ?? null));
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => handleAuthUserChange(session?.user.id ?? null));
      return () => listener.subscription.unsubscribe();
    } catch {
      return;
    }
  }, [handleAuthUserChange]);

  const cacheArtifact = useCallback((kind: string, id: string, value: ParseRun | ChunkRun | EmbeddingRun | ExperimentRun | EvaluationDataset) => {
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

  const readArtifact = useCallback(<T extends ParseRun | ChunkRun | EmbeddingRun | ExperimentRun | EvaluationDataset,>(kind: string, id: string) => {
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

  const commitDocumentSnapshot = useCallback((snapshot: DocumentSnapshot, persistSelection = true) => {
    activeDocumentRef.current = snapshot.detail;
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
  }, [rememberSelection]);

  const loadDocumentSnapshot = useCallback(async (
    documentId: string,
    signal: AbortSignal,
    selectionOverride?: DocumentLineageSelection,
    strictSelection = false,
  ): Promise<DocumentSnapshot> => {
    const detail = await getDocumentSummary(documentId, signal);
    const selection = resolveLineageSelection(
      detail,
      selectionOverride ?? lineageSelectionsRef.current[documentId],
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

  const hydrateParseDetail = useCallback(async (documentId: string, runId: string, expectedSelection = selectionRequestRef.current) => {
    const epoch = documentEpochRef.current;
    const cached = readArtifact<ParseRun>("parse", runId);
    if (cached) {
      if (activeDocumentRef.current?.id === documentId && selectionRequestRef.current === expectedSelection) {
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
      cacheArtifact("parse", runId, run);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== expectedSelection || activeDocumentRef.current?.id !== documentId) return run;
      setParseResult(run.result);
      setParseStatus(run.status);
      setParseError(run.error ? new DocumentApiError(run.error.code, run.error.message) : null);
      return run;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && documentEpochRef.current === epoch && selectionRequestRef.current === expectedSelection && activeDocumentRef.current?.id === documentId) {
        setParseError(asApiError(error, "The selected parse run could not be loaded."));
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [cacheArtifact, readArtifact, replaceController]);

  const hydrateChunkDetail = useCallback(async (documentId: string, runId: string, expectedSelection = selectionRequestRef.current) => {
    const epoch = documentEpochRef.current;
    const cached = readArtifact<ChunkRun>("chunk", runId);
    if (cached) {
      if (activeDocumentRef.current?.id === documentId && selectionRequestRef.current === expectedSelection) {
        setChunkRun(cached);
        setChunkStatus("completed");
      }
      return cached;
    }
    const controllerKey = `detail:chunk:${documentId}:${runId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const run = await getChunkRun(runId, controller.signal);
      cacheArtifact("chunk", runId, run);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== expectedSelection || activeDocumentRef.current?.id !== documentId) return run;
      setChunkRun(run);
      setChunkStatus("completed");
      return run;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && documentEpochRef.current === epoch && selectionRequestRef.current === expectedSelection && activeDocumentRef.current?.id === documentId) {
        setChunkError(asApiError(error, "The selected chunk run could not be loaded."));
        setChunkStatus("error");
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [cacheArtifact, readArtifact, replaceController]);

  const hydrateEmbeddingDetail = useCallback(async (documentId: string, runId: string, expectedSelection = selectionRequestRef.current) => {
    const epoch = documentEpochRef.current;
    const cached = readArtifact<EmbeddingRun>("embedding", runId);
    if (cached) {
      if (activeDocumentRef.current?.id === documentId && selectionRequestRef.current === expectedSelection) {
        setEmbeddingRun(cached);
        setEmbeddingStatus("completed");
      }
      return cached;
    }
    const controllerKey = `detail:embedding:${documentId}:${runId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const run = await getEmbeddingRun(runId, controller.signal);
      cacheArtifact("embedding", runId, run);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== expectedSelection || activeDocumentRef.current?.id !== documentId) return run;
      setEmbeddingRun(run);
      setEmbeddingStatus("completed");
      return run;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") && documentEpochRef.current === epoch && selectionRequestRef.current === expectedSelection && activeDocumentRef.current?.id === documentId) {
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
    pipelineId: string | null = activePipelineRef.current?.documentId === documentId
      ? activePipelineRef.current.id
      : null,
  ) => {
    const requestId = ++documentLoadRequestRef.current;
    let nextPipelines: DocumentPipeline[] = [];
    try {
      nextPipelines = await listDocumentPipelines(documentId, signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // Yalnız additive endpoint'in henüz bulunmadığı preview'larda legacy
      // workspace'e dön; gerçek network/auth hatalarını görünür bırak.
      if (!(error instanceof DocumentApiError)
        || (error.status !== 404 && error.code !== "invalid_response")) throw error;
    }
    const pipeline = nextPipelines.find((item) => item.id === pipelineId) ?? null;
    const snapshot = await loadDocumentSnapshot(
      documentId,
      signal,
      pipeline ? pipelineSelection(pipeline) : undefined,
      Boolean(pipeline),
    );
    if (documentLoadRequestRef.current !== requestId) return null;
    documentEpochRef.current += 1;
    selectionRequestRef.current += 1;
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    setPipelines(nextPipelines);
    activePipelineRef.current = pipeline;
    setActivePipelineId(pipeline?.id ?? null);
    rememberActivePipeline(pipeline?.id ?? null, authUserId);
    commitDocumentSnapshot(snapshot, !pipeline);
    rememberActiveDocument(documentId, authUserId);
    setPersistenceError(null);
    setPersistenceStatus("available");
    return snapshot;
  }, [authUserId, commitDocumentSnapshot, loadDocumentSnapshot]);

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
        const loaded = await loadThenCommitDocument(documentId, controller.signal, activePipelineRef.current?.id ?? null);
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
  }, [loadThenCommitDocument, replaceController, resumeParseRun]);

  const selectPersistedDocument = useCallback(async (documentId: string, metadataOverride?: PersistedDocument) => {
    const metadata = metadataOverride ?? documents.find((document) => document.id === documentId);
    if (!metadata) return;
    const previousDocument = activeDocumentRef.current;
    const previousMetadata = activeDocumentMetadata;
    const previousDocumentId = activeDocumentId;
    const controller = replaceController("document");
    documentLoadRequestRef.current += 1;
    documentEpochRef.current += 1;
    selectionRequestRef.current += 1;
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    activeDocumentRef.current = null;
    setActiveDocument(null);
    setActiveDocumentId(documentId);
    setActiveDocumentMetadata(metadata);
    setSelectedParseRunId(null);
    setSelectedChunkRunId(null);
    setSelectedEmbeddingRunId(null);
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
      rememberActivePipeline(null, authUserId);
      const loaded = await loadThenCommitDocument(documentId, controller.signal, null);
      if (!loaded) return;
      setPendingUpload(null);
      setFileError(null);
      if ((loaded.parseStatus === "queued" || loaded.parseStatus === "running") && loaded.inFlightParseRunId) {
        void resumeParseRun(documentId, loaded.inFlightParseRunId, runIdRef.current);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (selectionToken === selectionRequestRef.current) {
        activeDocumentRef.current = previousDocument;
        setActiveDocument(previousDocument);
        setActiveDocumentMetadata(previousMetadata);
        setActiveDocumentId(previousDocumentId);
      }
      setPersistenceError(asApiError(error, "The selected document could not be loaded."));
      setPersistenceStatus(documents.length > 0 ? "available" : "unavailable");
    }
  }, [activeDocumentId, activeDocumentMetadata, authUserId, documents, loadThenCommitDocument, replaceController, resumeParseRun]);

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
        let pipelineId: string | null = null;
        let legacyDocumentId: string | null = null;
        try {
          documentId = window.localStorage.getItem(activeDocumentStorageKey(authUserId));
          if (!documentId && authUserId) legacyDocumentId = window.localStorage.getItem(ACTIVE_DOCUMENT_STORAGE_KEY);
          documentId = documentId ?? legacyDocumentId;
          pipelineId = window.localStorage.getItem(activePipelineStorageKey(authUserId));
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
    activePipelineRef.current = pipeline;
    setActivePipelineId(pipeline.id);
    setPipelines((current) => current.map((item) => item.id === pipeline.id ? pipeline : item));
    setPersistenceError(null);
  }, []);

  const persistActivePipelineSelection = useCallback(async (
    selection: DocumentLineageSelection,
  ): Promise<boolean> => {
    const current = activePipelineRef.current;
    if (!current) {
      if (activeDocumentRef.current) rememberSelection(activeDocumentRef.current.id, selection);
      return true;
    }
    const input = {
      expectedRevision: current.revision,
      parseRunId: selection.selectedParseRunId,
      chunkRunId: selection.selectedChunkRunId,
      embeddingRunId: selection.selectedEmbeddingRunId,
    };
    try {
      replacePipelineState(await updateDocumentPipeline(current.id, input));
      return true;
    } catch (error) {
      if (!(error instanceof DocumentApiError) || error.code !== "pipeline_conflict") {
        setPersistenceError(asApiError(error, "Pipeline selection could not be saved."));
        return false;
      }
      const controller = replaceController(`pipeline-conflict:${current.id}`);
      try {
        // Conflict sonrası önce server state yüklenir ve UI onunla reconcile edilir.
        const nextPipelines = await listDocumentPipelines(current.documentId, controller.signal);
        setPipelines(nextPipelines);
        const refreshed = nextPipelines.find((item) => item.id === current.id) ?? null;
        if (!refreshed || activePipelineRef.current?.id !== current.id) return false;
        activePipelineRef.current = refreshed;
        setActivePipelineId(refreshed.id);
        const snapshot = await loadDocumentSnapshot(
          refreshed.documentId,
          controller.signal,
          pipelineSelection(refreshed),
          true,
        );
        commitDocumentSnapshot(snapshot, false);
        const desiredAlreadyPersisted = refreshed.parseRunId === selection.selectedParseRunId
          && refreshed.chunkRunId === selection.selectedChunkRunId
          && refreshed.embeddingRunId === selection.selectedEmbeddingRunId;
        if (desiredAlreadyPersisted) return true;
        if (activePipelineRef.current?.id !== refreshed.id) return false;
        const retried = await updateDocumentPipeline(refreshed.id, {
          ...input,
          expectedRevision: refreshed.revision,
        }, controller.signal);
        replacePipelineState(retried);
        return true;
      } catch (reconcileError) {
        if (!(reconcileError instanceof DOMException && reconcileError.name === "AbortError")) {
          setPersistenceError(asApiError(reconcileError, "Pipeline conflict could not be reconciled."));
        }
        return false;
      } finally {
        removeControllerIfCurrent(controllersRef.current, `pipeline-conflict:${current.id}`, controller);
      }
    }
  }, [commitDocumentSnapshot, loadDocumentSnapshot, rememberSelection, replaceController, replacePipelineState]);
  useEffect(() => {
    persistActivePipelineSelectionRef.current = persistActivePipelineSelection;
  }, [persistActivePipelineSelection]);

  const selectPipeline = useCallback(async (pipelineId: string | null) => {
    const document = activeDocumentRef.current;
    if (!document) return;
    const pipeline = pipelineId ? pipelines.find((item) => item.id === pipelineId) ?? null : null;
    if (pipelineId && !pipeline) return;
    const controller = replaceController("pipeline-select");
    const requestId = ++selectionRequestRef.current;
    try {
      const snapshot = await loadDocumentSnapshot(
        document.id,
        controller.signal,
        pipeline ? pipelineSelection(pipeline) : lineageSelectionsRef.current[document.id],
        Boolean(pipeline),
      );
      if (selectionRequestRef.current !== requestId || activeDocumentRef.current?.id !== document.id) return;
      activePipelineRef.current = pipeline;
      setActivePipelineId(pipeline?.id ?? null);
      rememberActivePipeline(pipeline?.id ?? null, authUserId);
      commitDocumentSnapshot(snapshot, !pipeline);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setPersistenceError(asApiError(error, "Pipeline could not be selected."));
      }
    } finally {
      removeControllerIfCurrent(controllersRef.current, "pipeline-select", controller);
    }
  }, [authUserId, commitDocumentSnapshot, loadDocumentSnapshot, pipelines, replaceController]);

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
      setPipelines((current) => [...current, pipeline]);
      activePipelineRef.current = pipeline;
      setActivePipelineId(pipeline.id);
      rememberActivePipeline(pipeline.id, authUserId);
      setPersistenceError(null);
      return pipeline;
    } catch (error) {
      setPersistenceError(asApiError(error, "Pipeline could not be created."));
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "pipeline-create", controller);
    }
  }, [authUserId, replaceController, selectedChunkRunId, selectedEmbeddingRunId, selectedParseRunId]);

  const renamePipeline = useCallback(async (pipelineId: string, name: string) => {
    const current = pipelines.find((item) => item.id === pipelineId);
    if (!current) return null;
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
          if (latest && activePipelineRef.current?.id === pipelineId) {
            replacePipelineState(latest);
            const controller = replaceController(`pipeline-rename-conflict:${pipelineId}`);
            try {
              const snapshot = await loadDocumentSnapshot(latest.documentId, controller.signal, pipelineSelection(latest), true);
              commitDocumentSnapshot(snapshot, false);
            } finally {
              removeControllerIfCurrent(controllersRef.current, `pipeline-rename-conflict:${pipelineId}`, controller);
            }
          }
          if (latest?.name === name) return latest;
          if (latest) {
            const updated = await updateDocumentPipeline(pipelineId, { expectedRevision: latest.revision, name });
            setPipelines((items) => items.map((item) => item.id === updated.id ? updated : item));
            if (activePipelineRef.current?.id === updated.id) replacePipelineState(updated);
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
  }, [commitDocumentSnapshot, loadDocumentSnapshot, pipelines, replaceController, replacePipelineState]);

  const deletePipeline = useCallback(async (pipelineId: string) => {
    const current = pipelines.find((item) => item.id === pipelineId);
    if (!current) return;
    try {
      await deleteDocumentPipeline(pipelineId);
      setPersistenceError(null);
      setPipelines((items) => items.filter((item) => item.id !== pipelineId));
      if (activePipelineRef.current?.id === pipelineId) {
        const document = activeDocumentRef.current;
        if (document) rememberSelection(document.id, { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId });
        activePipelineRef.current = null;
        setActivePipelineId(null);
        rememberActivePipeline(null, authUserId);
      }
    } catch (error) {
      setPersistenceError(asApiError(error, "Pipeline could not be deleted."));
    }
  }, [authUserId, pipelines, rememberSelection, selectedChunkRunId, selectedEmbeddingRunId, selectedParseRunId]);

  const selectParseRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.parseRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary)) return;
    const selection = { selectedParseRunId: runId, selectedChunkRunId: null, selectedEmbeddingRunId: null };
    if (!await persistActivePipelineSelection(selection)) return;
    const requestId = ++selectionRequestRef.current;
    setSelectedParseRunId(runId);
    setSelectedChunkRunId(null);
    setSelectedEmbeddingRunId(null);
    setParseResult(null);
    setChunkRun(null);
    setEmbeddingRun(null);
    setChunkStatus("ready");
    setEmbeddingStatus("locked");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    await hydrateParseDetail(document.id, runId, requestId);
  }, [hydrateParseDetail, persistActivePipelineSelection]);

  const selectChunkRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.chunkRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary) || summary?.upstream.parseRunId !== selectedParseRunId) return;
    const selection = { selectedParseRunId, selectedChunkRunId: runId, selectedEmbeddingRunId: null };
    if (!await persistActivePipelineSelection(selection)) return;
    const requestId = ++selectionRequestRef.current;
    setSelectedChunkRunId(runId);
    setSelectedEmbeddingRunId(null);
    setChunkRun(null);
    setEmbeddingRun(null);
    setChunkStatus("ready");
    setEmbeddingStatus("locked");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    await hydrateChunkDetail(document.id, runId, requestId);
  }, [hydrateChunkDetail, persistActivePipelineSelection, selectedParseRunId]);

  const selectEmbeddingRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.embeddingRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary) || summary?.upstream.chunkRunId !== selectedChunkRunId) return;
    const selection = { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId: runId };
    if (!await persistActivePipelineSelection(selection)) return;
    const requestId = ++selectionRequestRef.current;
    setSelectedEmbeddingRunId(runId);
    setEmbeddingRun(null);
    setEmbeddingStatus("ready");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
    await hydrateEmbeddingDetail(document.id, runId, requestId);
  }, [hydrateEmbeddingDetail, persistActivePipelineSelection, selectedChunkRunId, selectedParseRunId]);

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

  const runExperiment = useCallback(async (input: Omit<ExperimentRequest, "documentId" | "chunkRunId" | "embeddingRunId">) => {
    const documentId = activeDocumentRef.current?.id;
    const chunkRunId = selectedChunkRunId;
    const embeddingRunId = selectedEmbeddingRunId;
    if (!documentId || !chunkRunId || experimentStatus === "processing") return;
    if (input.retrieval.mode !== "keyword" && !embeddingRunId) return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const controller = replaceController("experiment");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await createExperiment({ ...input, documentId, chunkRunId, embeddingRunId }, controller.signal);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId || selectedEmbeddingRunId !== embeddingRunId) return;
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
    if (!documentId || experimentStatus === "processing") return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const cached = readArtifact<ExperimentRun>("experiment", experimentId);
    if (cached) {
      commitExperimentResult(cached);
      return;
    }
    if (controllersRef.current.has("experiment-load")) return;
    const controller = replaceController("experiment-load");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await getExperiment(experimentId, controller.signal);
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
  }, [cacheArtifact, commitExperimentResult, experimentStatus, readArtifact, replaceController]);

  const loadEvaluationDataset = useCallback(async (datasetId: string): Promise<EvaluationDataset | null> => {
    const activeSummary = activeDocumentRef.current;
    const documentId = activeSummary?.id;
    if (!documentId || !activeSummary.evaluationDatasets.some((dataset) => dataset.id === datasetId)) return null;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const cached = readArtifact<EvaluationDataset>("dataset", datasetId);
    if (cached) return cached;
    const controllerKey = `detail:dataset:${documentId}:${datasetId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const dataset = await getEvaluationDataset(datasetId, controller.signal);
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

  useEffect(() => {
    const documentId = activeDocumentRef.current?.id;
    if (!documentId) return;
    const expectedSelection = selectionRequestRef.current;
    if ((pathname === "/parse" || pathname === "/documents/parsed") && selectedParseRunId) {
      void hydrateParseDetail(documentId, selectedParseRunId, expectedSelection);
    } else if ((pathname === "/chunking" || pathname === "/documents/chunks") && selectedChunkRunId) {
      void hydrateChunkDetail(documentId, selectedChunkRunId, expectedSelection);
    } else if (pathname === "/embeddings" && selectedEmbeddingRunId) {
      void hydrateEmbeddingDetail(documentId, selectedEmbeddingRunId, expectedSelection);
    } else if ((pathname === "/playground" || pathname === "/retrieval") && !experimentRun) {
      const summary = activeDocumentRef.current?.experiments.find((run) => run.isCompatible
        && run.upstream.chunkRunId === selectedChunkRunId
        && (run.embeddingRunId === null || run.embeddingRunId === selectedEmbeddingRunId));
      if (summary) void loadExperiment(summary.id);
    } else if (pathname === "/evaluation") {
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

  const createDataset = useCallback(async (name: string, cases: EvaluationCase[]) => {
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
      const dataset = await createEvaluationDataset({ documentId, parseRunId, name, cases }, controller.signal);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedParseRunId !== parseRunId || selectedChunkRunId !== chunkRunId) return;
      const summary: EvaluationDatasetSummary = {
        id: dataset.id,
        documentId: dataset.documentId,
        parseRunId: dataset.parseRunId,
        name: dataset.name,
        version: dataset.version,
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
    const embeddingRunId = selectedEmbeddingRunId;
    if (!chunkRunId || !embeddingRunId || evaluationStatus === "processing") return;
    const documentId = activeDocumentRef.current?.id;
    if (!documentId) return;
    const epoch = documentEpochRef.current;
    const selectionVersion = selectionRequestRef.current;
    const controller = replaceController("evaluation");
    setEvaluationStatus("processing");
    setEvaluationError(null);
    try {
      const result = await createEvaluationRun({ ...input, chunkRunId, embeddingRunId }, controller.signal);
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId || selectedEmbeddingRunId !== embeddingRunId) return;
      setEvaluationRun(result);
      setEvaluationHistory((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      setEvaluationStatus(result.status === "completed" ? "completed" : result.status === "running" ? "processing" : "error");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId || selectedEmbeddingRunId !== embeddingRunId) return;
      setEvaluationError(asApiError(error, "Evaluation could not be completed."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation", controller);
    }
  }, [evaluationStatus, replaceController, selectedChunkRunId, selectedEmbeddingRunId]);

  const refreshEvaluationRuns = useCallback(async (datasetId: string) => {
    const documentId = activeDocumentRef.current?.id;
    const epoch = documentEpochRef.current;
    const controller = replaceController("evaluation-history");
    try {
      const runs = await listEvaluationRuns(datasetId, controller.signal);
      if (documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== documentId) return;
      setEvaluationHistory(runs);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setEvaluationError(asApiError(error, "Evaluation history could not be loaded."));
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation-history", controller);
    }
  }, [replaceController]);

  const activePipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === activePipelineId) ?? null,
    [activePipelineId, pipelines],
  );

  const value = useMemo<DocumentPipelineContextValue>(() => ({
    pendingUpload, fileError, parseStatus, parseProgress,
    parseProgressEstimated: parseProgress > lastReportedParseProgress,
    parseResult, parseError, activity,
    persistenceStatus, persistenceError, capabilities, documents, activeDocumentId, activeDocumentMetadata, activeDocument,
    selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId,
    chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError,
    experimentStatus, experimentRun, experimentError, experimentHistory,
    evaluationDatasets, evaluationStatus, evaluationRun, evaluationError, evaluationHistory,
    pipelines, activePipelineId, activePipeline,
    selectFile, addDocument, selectPersistedDocument, selectParseRun, selectChunkRun, selectEmbeddingRun, removeFile, parseSelectedFile, reparseActiveDocument, parseActiveDocument, runChunking, runEmbedding,
    runExperiment, loadExperiment, loadEvaluationDataset, continueExperiment: continueCurrentExperiment, rerunGeneration: rerunCurrentGeneration,
    createDataset, runEvaluation, refreshPersistence, refreshEvaluationRuns,
    selectPipeline, createPipeline, renamePipeline, deletePipeline,
  }), [
    activeDocument, activeDocumentId, activeDocumentMetadata, activePipeline, activePipelineId, activity, capabilities, chunkError, chunkRun, chunkStatus, createDataset, documents,
    embeddingError, embeddingRun, embeddingStatus, evaluationDatasets, evaluationError, evaluationHistory,
    evaluationRun, evaluationStatus, experimentError, experimentHistory, experimentRun, experimentStatus,
    fileError, lastReportedParseProgress, parseError, parseProgress, parseResult, parseSelectedFile, parseStatus, persistenceError, persistenceStatus,
    pendingUpload, pipelines, selectedChunkRunId, selectedEmbeddingRunId, selectedParseRunId,
    addDocument, reparseActiveDocument, parseActiveDocument,
    continueCurrentExperiment, loadEvaluationDataset, loadExperiment, refreshEvaluationRuns, refreshPersistence, removeFile, rerunCurrentGeneration,
    runChunking, runEmbedding, runEvaluation, runExperiment,
    createPipeline, deletePipeline, renamePipeline, selectChunkRun, selectEmbeddingRun, selectFile, selectParseRun, selectPersistedDocument, selectPipeline,
  ]);

  return <DocumentPipelineContext.Provider value={value}>{children}</DocumentPipelineContext.Provider>;
}

export function useDocumentPipeline() {
  const context = useContext(DocumentPipelineContext);
  if (!context) throw new Error("useDocumentPipeline must be used within DocumentPipelineProvider");
  return context;
}
