"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { useAuthBootstrap } from "@/components/auth-provider";
import { DocumentApiError } from "@/lib/document-api";
import { validatePdfFile } from "@/lib/document-file";
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
  isAbortError,
  listDocumentPipelines,
  listDocuments,
  uploadDocument,
  deleteDocument,
  listEvaluationRuns,
  reparsePersistedDocument,
  deleteDocumentPipeline,
  rerunGeneration,
  waitForParseRun,
  updateDocumentPipeline,
  waitForEvaluationRun,
  waitForExperimentRun,
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
  PersistedParseResponse,
  ParseRun,
} from "@/lib/rag-api-types";
import {
  completedCompatibleRun,
  describeReparseImpact,
  emptyLineageSelection,
  pipelineSelection,
  pipelineStatusFromRun,
  resolveLineageSelection,
  type PipelineOperationStatus,
  type ReparseImpact,
} from "@/lib/pipeline-lineage";
import {
  forgetActivePipeline,
  readActiveDocument,
  readActivePipeline,
  readLineageSelections,
  rememberActiveDocument,
  rememberActivePipeline,
  rememberLineageSelections,
  type LineageSelectionStore,
} from "@/lib/pipeline-storage";

export type DocumentParseStatus = "not-started" | "ready" | "queued" | "running" | "completed" | "failed";
export type { PipelineOperationStatus } from "@/lib/pipeline-lineage";
export type PersistenceStatus = "checking" | "available" | "unavailable";
/**
 * Whether the active workspace (documents and the active document's lineage)
 * has been resolved. Screens must not evaluate blockers while it is "loading".
 */
export type WorkspaceStatus = "loading" | "ready" | "unavailable";
export type { DocumentLineageSelection } from "@/lib/rag-api-types";

type DocumentSnapshot = {
  detail: DocumentSummary;
  summaryFetchedAt?: number;
  selection: DocumentLineageSelection;
  parseResult: PersistedParseResponse | null;
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

type LoadedDocumentWorkspace = {
  pipelines: DocumentPipeline[];
  summary: DocumentSummary;
  fetchedAt: number;
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
  parseStatus: DocumentParseStatus;
  parseProgress: number;
  parseProgressEstimated: boolean;
  parsePhase: string | null;
  /**
   * Inspect-screen artifact: the inspected run when one is being inspected,
   * otherwise the selected one. It may be historical; use screens must read
   * `selectedParseResult` instead.
   */
  parseResult: PersistedParseResponse | null;
  parseError: DocumentApiError | null;
  persistenceStatus: PersistenceStatus;
  persistenceError: DocumentApiError | null;
  workspaceStatus: WorkspaceStatus;
  capabilities: Capabilities | null;
  documents: PersistedDocument[];
  activeDocumentId: string | null;
  activeDocumentMetadata: PersistedDocument | null;
  activeDocument: DocumentSummary | null;
  selectedParseRunId: string | null;
  selectedChunkRunId: string | null;
  selectedEmbeddingRunId: string | null;
  /** Artifacts of the selected (canonical) lineage only; never an inspected historical run. */
  selectedParseResult: PersistedParseResponse | null;
  selectedChunkRun: ChunkRun | null;
  selectedEmbeddingRun: EmbeddingRun | null;
  /** Read-only artifact cursor; never changes the saved pipeline lineage. */
  inspectedParseRunId: string | null;
  inspectedChunkRunId: string | null;
  inspectedEmbeddingRunId: string | null;
  chunkStatus: PipelineOperationStatus;
  /** Inspect-screen chunk run (inspected or selected). Use screens read `selectedChunkRun`. */
  chunkRun: ChunkRun | null;
  chunkError: DocumentApiError | null;
  embeddingStatus: PipelineOperationStatus;
  /** Inspect-screen embedding run (inspected or selected). Use screens read `selectedEmbeddingRun`. */
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
  /** What a completed reparse would do to the working lineage (for a confirmation step). */
  reparseImpact: ReparseImpact;
  addDocument: (file: File) => Promise<PersistedDocument | null>;
  selectPersistedDocument: (documentId: string) => Promise<void>;
  deletePersistedDocument: (documentId: string) => Promise<void>;
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
  deletePipeline: (pipelineId: string) => Promise<boolean>;
  reparseActiveDocument: () => Promise<void>;
  runChunking: (strategy: ChunkStrategy, config: ChunkConfig) => Promise<ChunkRun | null>;
  runEmbedding: () => Promise<EmbeddingRun | null>;
  runExperiment: (input: Omit<ExperimentRequest, "documentId" | "chunkRunId" | "embeddingRunId">) => Promise<void>;
  loadExperiment: (experimentId: string) => Promise<void>;
  resumeRunTracking: (kind: "experiment" | "evaluation") => Promise<void>;
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
const SUMMARY_CACHE_MAX_AGE_MS = 60_000;

function asApiError(error: unknown, fallback: string) {
  return error instanceof DocumentApiError ? error : new DocumentApiError("unknown", fallback);
}

function removeControllerIfCurrent(controllers: Map<string, AbortController>, key: string, controller: AbortController) {
  if (controllers.get(key) === controller) controllers.delete(key);
}

function isRunInFlight(status: string) {
  return status === "queued" || status === "running";
}

export function DocumentPipelineProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { userId: authoritativeUserId, ready: authReady, error: authError, retry: retryAuth } = useAuthBootstrap();
  const [authUserId, setAuthUserId] = useState<string | null>(authoritativeUserId);
  const [parseStatus, setParseStatus] = useState<DocumentParseStatus>("not-started");
  const [parseProgress, setParseProgress] = useState(0);
  const [parsePhase, setParsePhase] = useState<string | null>(null);
  // Docling exposes coarse stage checkpoints, so the UI may interpolate between
  // them while the long-running conversion itself is still in progress.
  const [lastReportedParseProgress, setLastReportedParseProgress] = useState(0);
  const [selectedParseResult, setSelectedParseResult] = useState<PersistedParseResponse | null>(null);
  const [inspectedParseResult, setInspectedParseResult] = useState<PersistedParseResponse | null>(null);
  const [parseError, setParseError] = useState<DocumentApiError | null>(null);
  const parseInFlightRef = useRef(false);
  const activeParseRunIdRef = useRef<string | null>(null);
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>("checking");
  const [persistenceError, setPersistenceError] = useState<DocumentApiError | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [documents, setDocuments] = useState<PersistedDocument[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activeDocumentMetadata, setActiveDocumentMetadata] = useState<PersistedDocument | null>(null);
  const [activeDocument, setActiveDocument] = useState<DocumentSummary | null>(null);
  const [selectedLineage, setSelectedLineage] = useState<DocumentLineageSelection>(emptyLineageSelection);
  const [inspectedLineage, setInspectedLineage] = useState<DocumentLineageSelection>(emptyLineageSelection);
  const [chunkStatus, setChunkStatus] = useState<PipelineOperationStatus>("locked");
  const [selectedChunkRun, setSelectedChunkRun] = useState<ChunkRun | null>(null);
  const [inspectedChunkRun, setInspectedChunkRun] = useState<ChunkRun | null>(null);
  const [chunkError, setChunkError] = useState<DocumentApiError | null>(null);
  const [embeddingStatus, setEmbeddingStatus] = useState<PipelineOperationStatus>("locked");
  const [selectedEmbeddingRun, setSelectedEmbeddingRun] = useState<EmbeddingRun | null>(null);
  const [inspectedEmbeddingRun, setInspectedEmbeddingRun] = useState<EmbeddingRun | null>(null);
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
  const selectedLineageRef = useRef<DocumentLineageSelection>(emptyLineageSelection());
  const inspectedLineageRef = useRef<DocumentLineageSelection>(emptyLineageSelection());
  const activeDocumentRef = useRef<DocumentSummary | null>(null);
  const activeDocumentSummaryLoadedAtRef = useRef(0);
  const activePipelineRef = useRef<DocumentPipeline | null>(null);
  const authUserIdRef = useRef<string | null>(authUserId);
  const lineageSelectionsRef = useRef<LineageSelectionStore>({});
  const controllersRef = useRef(new Map<string, AbortController>());
  const artifactCacheRef = useRef(new Map<string, ParseRun | ChunkRun | EmbeddingRun | ExperimentRun | EvaluationDataset | EvaluationRun>());
  const pipelineRevisionRef = useRef(new Map<string, number>());
  const pipelineMutationQueueRef = useRef(new Map<string, Promise<boolean>>());
  const persistActivePipelineSelectionRef = useRef<(selection: DocumentLineageSelection, expectedPipelineId?: string | null) => Promise<boolean>>(async () => false);

  const applySelectedLineage = useCallback((selection: DocumentLineageSelection) => {
    selectedLineageRef.current = selection;
    setSelectedLineage(selection);
  }, []);

  /** Resets the inspection cursor to the selected lineage. */
  const resetInspection = useCallback((selection: DocumentLineageSelection) => {
    inspectedLineageRef.current = selection;
    setInspectedLineage(selection);
    setInspectedParseResult(null);
    setInspectedChunkRun(null);
    setInspectedEmbeddingRun(null);
  }, []);

  const beginArtifactInspection = useCallback((kind: "parse" | "chunk" | "embedding", runId: string) => {
    const key = kind === "parse" ? "selectedParseRunId" : kind === "chunk" ? "selectedChunkRunId" : "selectedEmbeddingRunId";
    const next = { ...inspectedLineageRef.current, [key]: runId };
    inspectedLineageRef.current = next;
    setInspectedLineage(next);
  }, []);

  /**
   * Captures the document/selection scope of an async action. Results must be
   * dropped when the user switched document, pipeline or lineage meanwhile.
   */
  const captureScope = useCallback(() => {
    const epoch = documentEpochRef.current;
    const selection = selectionRequestRef.current;
    const documentId = activeDocumentRef.current?.id ?? null;
    return {
      documentId,
      isCurrent: () => documentEpochRef.current === epoch
        && selectionRequestRef.current === selection
        && activeDocumentRef.current?.id === documentId,
    };
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

  /** Clears every lineage-bound value; callers decide document-level state. */
  const resetLineageState = useCallback(() => {
    parseInFlightRef.current = false;
    activeParseRunIdRef.current = null;
    applySelectedLineage(emptyLineageSelection());
    resetInspection(emptyLineageSelection());
    setParseStatus("not-started");
    setParseProgress(0);
    setLastReportedParseProgress(0);
    setParsePhase(null);
    setSelectedParseResult(null);
    setParseError(null);
    setChunkStatus("locked");
    setSelectedChunkRun(null);
    setChunkError(null);
    setEmbeddingStatus("locked");
    setSelectedEmbeddingRun(null);
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
  }, [applySelectedLineage, resetInspection]);

  const handleAuthUserChange = useCallback((nextUserId: string | null) => {
    if (authUserIdRef.current === nextUserId) return;
    controllersRef.current.forEach((controller) => controller.abort());
    controllersRef.current.clear();
    documentLoadRequestRef.current += 1;
    documentEpochRef.current += 1;
    selectionRequestRef.current += 1;
    runIdRef.current += 1;
    activeDocumentRef.current = null;
    activeDocumentSummaryLoadedAtRef.current = 0;
    activePipelineRef.current = null;
    pipelineRevisionRef.current.clear();
    pipelineMutationQueueRef.current.clear();
    lineageSelectionsRef.current = {};
    artifactCacheRef.current.clear();
    resetLineageState();
    setActiveDocument(null);
    setActiveDocumentId(null);
    setActiveDocumentMetadata(null);
    setCapabilities(null);
    setDocuments([]);
    setPersistenceStatus("checking");
    setPersistenceError(null);
    setUploadNotice(null);
    setPipelines([]);
    setActivePipelineId(null);
    authUserIdRef.current = nextUserId;
    setAuthUserId(nextUserId);
  }, [resetLineageState]);

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
    applySelectedLineage(snapshot.selection);
    resetInspection(snapshot.selection);
    setPersistenceError(null);
    if (persistSelection && !activePipelineRef.current) rememberSelection(snapshot.detail.id, snapshot.selection);
    activeParseRunIdRef.current = snapshot.inFlightParseRunId ?? snapshot.selection.selectedParseRunId;
    setSelectedParseResult(snapshot.parseResult);
    setParseStatus(snapshot.parseStatus);
    setSelectedChunkRun(snapshot.chunkRun);
    setChunkStatus(snapshot.chunkStatus);
    setChunkError(null);
    setSelectedEmbeddingRun(snapshot.embeddingRun);
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
  }, [applySelectedLineage, rememberSelection, resetInspection]);

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
    const inFlightParseSummary = detail.parseRuns.find((run) => isRunInFlight(run.status)) ?? null;
    const latestParseSummary = detail.parseRuns[0] ?? null;
    const failedReparseSummary = latestParseSummary?.status === "failed" && latestParseSummary.id !== detail.activeParseRunId
      ? latestParseSummary
      : null;
    const visibleParseSummary = inFlightParseSummary ?? failedReparseSummary ?? parseSummary;
    const parseRun = selection.selectedParseRunId ? readArtifact<ParseRun>("parse", selection.selectedParseRunId) : undefined;
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
      ? inFlightParseSummary.status as DocumentParseStatus
      : failedReparseSummary
        ? "failed"
        : parseRun?.result || parseSummary?.status === "completed"
          ? "completed"
          : "not-started";
    const embeddingReady = Boolean(effectiveSelection.selectedChunkRunId && embeddingMatchesLineage && embeddingRun);
    return {
      detail,
      selection: effectiveSelection,
      parseResult: effectiveSelection.selectedParseRunId ? parseRun?.result ?? null : null,
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

  // Artifact details are applied by run ID to every slot that currently wants
  // that run: the selected lineage slot and/or the inspection slot. A late
  // response for a run no slot wants anymore is cached but never shown.
  const applyParseRun = useCallback((documentId: string, run: ParseRun) => {
    if (activeDocumentRef.current?.id !== documentId) return;
    const selectedId = selectedLineageRef.current.selectedParseRunId;
    if (selectedId === run.id) {
      setSelectedParseResult(run.result);
      if (activeParseRunIdRef.current === run.id) {
        setParseStatus(run.status);
        setParseError(run.error ? new DocumentApiError(run.error.code, run.error.message) : null);
      }
    }
    if (inspectedLineageRef.current.selectedParseRunId === run.id && selectedId !== run.id) {
      setInspectedParseResult(run.result);
    }
  }, []);

  const applyChunkRun = useCallback((documentId: string, run: ChunkRun) => {
    if (activeDocumentRef.current?.id !== documentId) return;
    const selectedId = selectedLineageRef.current.selectedChunkRunId;
    if (selectedId === run.id) {
      setSelectedChunkRun(run);
      if (!controllersRef.current.has("chunk")) setChunkStatus(pipelineStatusFromRun(run));
    }
    if (inspectedLineageRef.current.selectedChunkRunId === run.id && selectedId !== run.id) setInspectedChunkRun(run);
  }, []);

  const applyEmbeddingRun = useCallback((documentId: string, run: EmbeddingRun) => {
    if (activeDocumentRef.current?.id !== documentId) return;
    const selectedId = selectedLineageRef.current.selectedEmbeddingRunId;
    if (selectedId === run.id) {
      setSelectedEmbeddingRun(run);
      if (!controllersRef.current.has("embedding")) setEmbeddingStatus(pipelineStatusFromRun(run));
    }
    if (inspectedLineageRef.current.selectedEmbeddingRunId === run.id && selectedId !== run.id) setInspectedEmbeddingRun(run);
  }, []);

  const hydrateParseDetail = useCallback(async (documentId: string, runId: string) => {
    const cached = readArtifact<ParseRun>("parse", runId);
    if (cached && cached.documentId !== documentId) return null;
    if (cached) {
      applyParseRun(documentId, cached);
      return cached;
    }
    const controllerKey = `detail:parse:${documentId}:${runId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const run = await getParseRun(runId, controller.signal, documentId);
      if (run.documentId !== documentId) return null;
      cacheArtifact("parse", runId, run);
      applyParseRun(documentId, run);
      return run;
    } catch (error) {
      const wanted = selectedLineageRef.current.selectedParseRunId === runId || inspectedLineageRef.current.selectedParseRunId === runId;
      if (!isAbortError(error) && wanted && activeDocumentRef.current?.id === documentId) {
        setParseError(asApiError(error, "The selected parse run could not be loaded."));
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [applyParseRun, cacheArtifact, readArtifact, replaceController]);

  const hydrateChunkDetail = useCallback(async (documentId: string, runId: string) => {
    const cached = readArtifact<ChunkRun>("chunk", runId);
    if (cached && cached.documentId !== documentId) return null;
    if (cached) {
      applyChunkRun(documentId, cached);
      return cached;
    }
    const controllerKey = `detail:chunk:${documentId}:${runId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const run = await getChunkRun(runId, controller.signal);
      if (run.documentId !== documentId) return null;
      cacheArtifact("chunk", runId, run);
      applyChunkRun(documentId, run);
      return run;
    } catch (error) {
      if (!isAbortError(error) && activeDocumentRef.current?.id === documentId) {
        if (selectedLineageRef.current.selectedChunkRunId === runId) {
          setChunkError(asApiError(error, "The selected chunk run could not be loaded."));
          setChunkStatus("error");
        } else if (inspectedLineageRef.current.selectedChunkRunId === runId) {
          setChunkError(asApiError(error, "The selected chunk run could not be loaded."));
        }
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [applyChunkRun, cacheArtifact, readArtifact, replaceController]);

  const hydrateEmbeddingDetail = useCallback(async (documentId: string, runId: string) => {
    const cached = readArtifact<EmbeddingRun>("embedding", runId);
    if (cached && cached.documentId !== documentId) return null;
    if (cached) {
      applyEmbeddingRun(documentId, cached);
      return cached;
    }
    const controllerKey = `detail:embedding:${documentId}:${runId}`;
    if (controllersRef.current.has(controllerKey)) return null;
    const controller = replaceController(controllerKey);
    try {
      const run = await getEmbeddingRun(runId, controller.signal);
      if (run.documentId !== documentId) return null;
      cacheArtifact("embedding", runId, run);
      applyEmbeddingRun(documentId, run);
      return run;
    } catch (error) {
      if (!isAbortError(error) && activeDocumentRef.current?.id === documentId) {
        if (selectedLineageRef.current.selectedEmbeddingRunId === runId) {
          setEmbeddingError(asApiError(error, "The selected embedding run could not be loaded."));
          setEmbeddingStatus("error");
        } else if (inspectedLineageRef.current.selectedEmbeddingRunId === runId) {
          setEmbeddingError(asApiError(error, "The selected embedding run could not be loaded."));
        }
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [applyEmbeddingRun, cacheArtifact, readArtifact, replaceController]);

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

  /**
   * A parse result belongs to the lineage that was active when the parse
   * started. If the user switched pipeline or selection meanwhile, the new
   * run only appears in history: nothing is PATCHed and the current lineage
   * is refreshed as-is. Returns a snapshot only when the caller should commit
   * the new parse as the working lineage.
   */
  const commitCompletedParse = useCallback(async (
    documentId: string,
    parseRunId: string,
    startScope: { pipelineId: string | null; selectionRequest: number },
    signal: AbortSignal,
    isCurrentRun: () => boolean,
  ): Promise<DocumentSnapshot | null> => {
    const lineageUnchanged = (activePipelineRef.current?.id ?? null) === startScope.pipelineId
      && selectionRequestRef.current === startScope.selectionRequest
      && activeDocumentRef.current?.id === documentId;
    if (lineageUnchanged) {
      const selection = { selectedParseRunId: parseRunId, selectedChunkRunId: null, selectedEmbeddingRunId: null };
      if (!await persistActivePipelineSelectionRef.current(selection, startScope.pipelineId)) return null;
      const snapshot = await loadDocumentSnapshot(documentId, signal, selection, Boolean(activePipelineRef.current));
      if (!isCurrentRun() || activeDocumentRef.current?.id !== documentId) return null;
      return snapshot;
    }
    const pipeline = activePipelineRef.current;
    const currentSelection = pipeline ? pipelineSelection(pipeline) : lineageSelectionsRef.current[documentId];
    const refreshScope = captureScope();
    const snapshot = await loadDocumentSnapshot(documentId, signal, currentSelection, Boolean(pipeline));
    if (!isCurrentRun() || !refreshScope.isCurrent()) return null;
    parseInFlightRef.current = false;
    commitDocumentSnapshot(snapshot, false);
    return null;
  }, [captureScope, commitDocumentSnapshot, loadDocumentSnapshot]);

  const resumeParseRun = useCallback(async (documentId: string, parseRunId: string, expectedRunId: number) => {
    const startScope = { pipelineId: activePipelineRef.current?.id ?? null, selectionRequest: selectionRequestRef.current };
    const controller = replaceController(`parse-resume:${documentId}`);
    const isCurrentRun = () => runIdRef.current === expectedRunId;
    try {
      const completedResult = await waitForParseRun(
        parseRunId,
        controller.signal,
        documentId,
        (run) => applyParseRunStatus(run, expectedRunId),
      );
      if (!isCurrentRun() || activeDocumentRef.current?.id !== documentId || activeParseRunIdRef.current !== parseRunId) return;
      const snapshot = await commitCompletedParse(documentId, parseRunId, startScope, controller.signal, isCurrentRun);
      if (!snapshot) return;
      documentEpochRef.current += 1;
      selectionRequestRef.current += 1;
      commitDocumentSnapshot(snapshot);
      setSelectedParseResult(completedResult);
      setParseStatus("completed");
    } catch (error) {
      if (!isCurrentRun() || activeDocumentRef.current?.id !== documentId || isAbortError(error)) return;
      const apiError = asApiError(error, "The persisted document could not be parsed.");
      setParseError(apiError);
      if (apiError.code !== "parse_poll_timeout") setParseStatus("failed");
    } finally {
      if (isCurrentRun()) removeControllerIfCurrent(controllersRef.current, `parse-resume:${documentId}`, controller);
    }
  }, [applyParseRunStatus, commitCompletedParse, commitDocumentSnapshot, replaceController]);

  const fetchDocumentWorkspace = useCallback(async (documentId: string, signal: AbortSignal): Promise<LoadedDocumentWorkspace> => {
    const [nextPipelines, summary] = await Promise.all([
      listDocumentPipelines(documentId, signal),
      getDocumentSummary(documentId, signal),
    ]);
    return { pipelines: nextPipelines, summary, fetchedAt: Date.now() };
  }, []);

  const loadThenCommitDocument = useCallback(async (
    documentId: string,
    signal: AbortSignal,
    pipelineId: string | null | undefined,
    prefetched?: Promise<LoadedDocumentWorkspace>,
  ) => {
    const requestId = ++documentLoadRequestRef.current;
    const loaded = await (prefetched ?? fetchDocumentWorkspace(documentId, signal));
    const scopedPipelines = loaded.pipelines.filter((item) => item.documentId === documentId);
    const pipeline = pipelineId === null
      ? null
      : scopedPipelines.find((item) => item.id === pipelineId)
        ?? scopedPipelines.find((item) => item.isDefault || item.name === "Default Pipeline")
        ?? scopedPipelines[0]
        ?? null;
    const snapshot = buildDocumentSnapshot(
      loaded.summary,
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
    commitDocumentSnapshot({ ...snapshot, summaryFetchedAt: loaded.fetchedAt }, !pipeline);
    rememberActiveDocument(documentId, authUserId);
    setPersistenceError(null);
    setPersistenceStatus("available");
    return snapshot;
  }, [authUserId, buildDocumentSnapshot, commitDocumentSnapshot, fetchDocumentWorkspace]);

  /**
   * Loads capabilities and the document list while the remembered document's
   * workspace is fetched in parallel; it is committed only if the document is
   * still in the authoritative list.
   */
  const fetchBootstrap = useCallback(async (controller: AbortController, documentId: string | null) => {
    const prefetched = documentId ? fetchDocumentWorkspace(documentId, controller.signal) : undefined;
    // A discarded prefetch (e.g. a deleted document) must not surface as an unhandled rejection.
    prefetched?.catch(() => undefined);
    const [nextCapabilities, nextDocuments] = await Promise.all([
      getCapabilities(controller.signal),
      listDocuments(controller.signal),
    ]);
    return { nextCapabilities, nextDocuments, prefetched };
  }, [fetchDocumentWorkspace]);

  const applyBootstrap = useCallback(async (
    controller: AbortController,
    documentId: string | null,
    pipelineId: string | null | undefined,
    { nextCapabilities, nextDocuments, prefetched }: Awaited<ReturnType<typeof fetchBootstrap>>,
  ) => {
    setCapabilities(nextCapabilities);
    setDocuments(nextDocuments);
    if (documentId && nextDocuments.some((document) => document.id === documentId)) {
      const loaded = await loadThenCommitDocument(documentId, controller.signal, pipelineId, prefetched);
      if (loaded && !parseInFlightRef.current && isRunInFlight(loaded.parseStatus) && loaded.inFlightParseRunId) {
        void resumeParseRun(documentId, loaded.inFlightParseRunId, runIdRef.current);
      }
    } else if (documentId) {
      rememberActiveDocument(null, authUserId);
    }
    setPersistenceStatus("available");
  }, [authUserId, loadThenCommitDocument, resumeParseRun]);

  const refreshPersistence = useCallback(async () => {
    if (!authUserIdRef.current) {
      retryAuth();
      return;
    }
    const controller = replaceController("bootstrap");
    setPersistenceStatus("checking");
    setPersistenceError(null);
    try {
      const documentId = activeDocumentRef.current?.id ?? null;
      const pipelineId = documentId ? activePipelineRef.current?.id ?? readActivePipeline(documentId, authUserId) : undefined;
      await applyBootstrap(controller, documentId, pipelineId, await fetchBootstrap(controller, documentId));
    } catch (error) {
      if (isAbortError(error)) return;
      setCapabilities(null);
      setPersistenceError(asApiError(error, "Persistent pipeline data could not be loaded."));
      setPersistenceStatus("unavailable");
    }
  }, [applyBootstrap, authUserId, fetchBootstrap, replaceController, retryAuth]);

  const selectPersistedDocument = useCallback(async (documentId: string, metadataOverride?: PersistedDocument) => {
    const metadata = metadataOverride ?? documents.find((document) => document.id === documentId);
    if (!metadata) return;
    const previousDocument = activeDocumentRef.current;
    const previousMetadata = previousDocument ? activeDocumentMetadata : null;
    const previousDocumentId = previousDocument?.id ?? null;
    const previousSummaryFetchedAt = activeDocumentSummaryLoadedAtRef.current;
    const previousPipeline = activePipelineRef.current;
    const previousPipelines = pipelines;
    const previousPipelineId = activePipelineId;
    const previousSnapshot = previousDocument
      ? buildDocumentSnapshot(previousDocument, selectedLineageRef.current, Boolean(previousPipeline))
      : null;
    const storedPipelineId = readActivePipeline(documentId, authUserId);
    const controller = replaceController("document");
    documentLoadRequestRef.current += 1;
    documentEpochRef.current += 1;
    selectionRequestRef.current += 1;
    runIdRef.current += 1;
    activeDocumentRef.current = null;
    activeDocumentSummaryLoadedAtRef.current = 0;
    activePipelineRef.current = null;
    resetLineageState();
    setActiveDocument(null);
    setActiveDocumentId(documentId);
    setActiveDocumentMetadata(metadata);
    setActivePipelineId(null);
    setPipelines([]);
    setPersistenceError(null);
    // The document list is already authoritative. Detail hydration must not
    // replace it with a global loading state or hide the instant selection.
    setPersistenceStatus("available");
    rememberActiveDocument(documentId, authUserId);
    const selectionToken = selectionRequestRef.current;
    try {
      const loaded = await loadThenCommitDocument(documentId, controller.signal, storedPipelineId);
      if (!loaded) return;
      if (isRunInFlight(loaded.parseStatus) && loaded.inFlightParseRunId) {
        void resumeParseRun(documentId, loaded.inFlightParseRunId, runIdRef.current);
      }
    } catch (error) {
      if (isAbortError(error)) return;
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
  }, [activeDocumentMetadata, activePipelineId, authUserId, buildDocumentSnapshot, commitDocumentSnapshot, documents, loadThenCommitDocument, pipelines, replaceController, resetLineageState, resumeParseRun]);

  const deletePersistedDocument = useCallback(async (documentId: string) => {
    const metadata = documents.find((document) => document.id === documentId);
    if (!metadata) return;
    const isActive = activeDocumentRef.current?.id === documentId || activeDocumentId === documentId;
    const controller = replaceController("document-delete");

    if (isActive) {
      controllersRef.current.forEach((current, key) => {
        if (key !== "document-delete") current.abort();
      });
      documentLoadRequestRef.current += 1;
      documentEpochRef.current += 1;
      selectionRequestRef.current += 1;
      runIdRef.current += 1;
      parseInFlightRef.current = false;
      activeParseRunIdRef.current = null;
    }

    try {
      await deleteDocument(documentId, controller.signal);
      const remainingDocuments = documents.filter((document) => document.id !== documentId);
      setDocuments(remainingDocuments);
      setPersistenceError(null);
      forgetActivePipeline(authUserId, documentId);
      const nextSelections = { ...lineageSelectionsRef.current };
      delete nextSelections[documentId];
      lineageSelectionsRef.current = nextSelections;
      rememberLineageSelections(nextSelections, authUserId);
      if (!isActive) return;

      activeDocumentRef.current = null;
      activeDocumentSummaryLoadedAtRef.current = 0;
      activePipelineRef.current = null;
      pipelineRevisionRef.current.clear();
      resetLineageState();
      setActiveDocument(null);
      setActiveDocumentId(null);
      setActiveDocumentMetadata(null);
      setPipelines([]);
      setActivePipelineId(null);
      setUploadNotice(null);
      rememberActiveDocument(null, authUserId);
      setPersistenceStatus("available");

      const nextDocument = remainingDocuments[0];
      if (nextDocument) await selectPersistedDocument(nextDocument.id, nextDocument);
    } catch (error) {
      if (!isAbortError(error)) {
        setPersistenceError(asApiError(error, "The document could not be deleted."));
      }
      throw error;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "document-delete", controller);
    }
  }, [activeDocumentId, authUserId, documents, replaceController, resetLineageState, selectPersistedDocument]);

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
    if (!authUserId) return;

    const controller = replaceController("bootstrap");
    lineageSelectionsRef.current = readLineageSelections(authUserId);
    const documentId = readActiveDocument(authUserId);
    const pipelineId = documentId ? readActivePipeline(documentId, authUserId) : undefined;
    void fetchBootstrap(controller, documentId)
      .then((loaded) => applyBootstrap(controller, documentId, pipelineId, loaded))
      .catch((error: unknown) => {
        if (isAbortError(error)) return;
        setCapabilities(null);
        setPersistenceError(asApiError(error, "Persistent pipeline data could not be loaded."));
        setPersistenceStatus("unavailable");
      });
    return () => controller.abort();
  }, [applyBootstrap, authUserId, fetchBootstrap, replaceController]);

  const reparseActiveDocument = useCallback(async () => {
    const documentId = activeDocumentRef.current?.id;
    if (!documentId || parseInFlightRef.current || parseStatus === "queued" || parseStatus === "running") return;
    const currentRunId = runIdRef.current;
    const startScope = { pipelineId: activePipelineRef.current?.id ?? null, selectionRequest: selectionRequestRef.current };
    const isCurrentRun = () => runIdRef.current === currentRunId;
    const controller = replaceController("reparse");
    parseInFlightRef.current = true;
    activeParseRunIdRef.current = null;
    setParseStatus("queued");
    setLastReportedParseProgress(0);
    setParseProgress(0);
    setParsePhase("queued");
    setParseError(null);
    try {
      const result = await reparsePersistedDocument(
        documentId,
        controller.signal,
        (run) => applyParseRunStatus(run, currentRunId),
      );
      if (!isCurrentRun() || !result.parseRunId) return;
      activeParseRunIdRef.current = result.parseRunId;
      const snapshot = await commitCompletedParse(documentId, result.parseRunId, startScope, controller.signal, isCurrentRun);
      if (!snapshot) return;
      parseInFlightRef.current = false;
      runIdRef.current += 1;
      documentEpochRef.current += 1;
      selectionRequestRef.current += 1;
      removeControllerIfCurrent(controllersRef.current, "reparse", controller);
      commitDocumentSnapshot(snapshot);
      setParseStatus("completed");
      setSelectedParseResult(result);
      setLastReportedParseProgress(100);
      setParseProgress(100);
      setParsePhase("completed");
      setEvaluationRun(null);
      setDocuments((current) => current.map((document) => document.id === documentId ? {
        ...document,
        pageCount: snapshot.detail.pageCount,
        activeParseRunId: snapshot.detail.activeParseRunId,
        activeChunkRunId: snapshot.detail.activeChunkRunId,
        activeEmbeddingRunId: snapshot.detail.activeEmbeddingRunId,
      } : document));
    } catch (error) {
      if (!isCurrentRun() || isAbortError(error)) return;
      const apiError = asApiError(error, "The persisted document could not be reparsed.");
      setParseError(apiError);
      if (apiError.code !== "parse_poll_timeout") setParseStatus("failed");
    } finally {
      if (isCurrentRun()) {
        parseInFlightRef.current = false;
        removeControllerIfCurrent(controllersRef.current, "reparse", controller);
      }
    }
  }, [applyParseRunStatus, commitCompletedParse, commitDocumentSnapshot, parseStatus, replaceController]);

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

  /**
   * Persists the working lineage to the active saved pipeline (or the scratch
   * selection). With `expectedPipelineId`, nothing is written unless that
   * pipeline (or scratch, for `null`) is still the active one.
   */
  const persistActivePipelineSelection = useCallback(async (
    selection: DocumentLineageSelection,
    expectedPipelineId?: string | null,
  ): Promise<boolean> => {
    const current = activePipelineRef.current;
    if (expectedPipelineId !== undefined && (current?.id ?? null) !== expectedPipelineId) return false;
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
          if (!isAbortError(reconcileError) && pipelineMutationIsCurrent(context)) {
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
      if (!isAbortError(error)) {
        setPersistenceError(asApiError(error, "Pipeline could not be selected."));
      }
    } finally {
      removeControllerIfCurrent(controllersRef.current, "pipeline-select", controller);
    }
  }, [authUserId, buildDocumentSnapshot, commitDocumentSnapshot, loadDocumentSnapshot, pipelines, replaceController]);

  const createPipeline = useCallback(async (name: string) => {
    const document = activeDocumentRef.current;
    if (!document) return null;
    const scope = captureScope();
    const controller = replaceController("pipeline-create");
    try {
      const pipeline = await createDocumentPipeline(document.id, {
        name,
        parseRunId: null,
        chunkRunId: null,
        embeddingRunId: null,
      }, controller.signal);
      if (pipeline.documentId !== document.id) {
        throw new DocumentApiError("incompatible_lineage", "The created pipeline belongs to a different document.");
      }
      if (!scope.isCurrent()) return null;
      setPipelines((current) => [...current, pipeline]);
      pipelineRevisionRef.current.set(pipeline.id, pipeline.revision);
      activePipelineRef.current = pipeline;
      setActivePipelineId(pipeline.id);
      rememberActivePipeline(pipeline.id, authUserId, document.id);
      commitDocumentSnapshot(buildDocumentSnapshot(document, pipelineSelection(pipeline), true), false);
      setPersistenceError(null);
      return pipeline;
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return null;
      setPersistenceError(asApiError(error, "Pipeline could not be created."));
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "pipeline-create", controller);
    }
  }, [authUserId, buildDocumentSnapshot, captureScope, commitDocumentSnapshot, replaceController]);

  const renamePipeline = useCallback(async (pipelineId: string, name: string) => {
    const current = pipelines.find((item) => item.id === pipelineId);
    if (!current) return null;
    const documentEpoch = documentEpochRef.current;
    // Rename does not change lineage, so only a document or session switch makes the result stale.
    const documentIsCurrent = () => documentEpochRef.current === documentEpoch && activeDocumentRef.current?.id === current.documentId;
    const mutationContext: PipelineMutationContext | null = activePipelineRef.current?.id === pipelineId
      ? {
          documentId: current.documentId,
          pipelineId,
          requestId: selectionRequestRef.current,
          documentEpoch,
        }
      : null;
    const controller = replaceController(`pipeline-rename:${pipelineId}`);
    const applyRenamed = (updated: DocumentPipeline) => {
      setPipelines((items) => items.map((item) => item.id === updated.id ? updated : item));
      if (activePipelineRef.current?.id === updated.id) replacePipelineState(updated);
    };
    try {
      const updated = await updateDocumentPipeline(pipelineId, { expectedRevision: current.revision, name }, controller.signal);
      if (!documentIsCurrent()) return null;
      applyRenamed(updated);
      setPersistenceError(null);
      return updated;
    } catch (error) {
      if (isAbortError(error) || !documentIsCurrent()) return null;
      if (error instanceof DocumentApiError && error.code === "pipeline_conflict") {
        try {
          const refreshed = await listDocumentPipelines(current.documentId, controller.signal);
          if (!documentIsCurrent()) return null;
          setPipelines(refreshed);
          const latest = refreshed.find((item) => item.id === pipelineId);
          refreshed.forEach((item) => pipelineRevisionRef.current.set(item.id, item.revision));
          if (latest && mutationContext && pipelineMutationIsCurrent(mutationContext)) {
            replacePipelineState(latest);
            const snapshot = await loadDocumentSnapshot(latest.documentId, controller.signal, pipelineSelection(latest), true);
            if (!pipelineMutationIsCurrent(mutationContext)) return null;
            commitDocumentSnapshot(snapshot, false);
          }
          if (latest?.name === name) return latest;
          if (latest) {
            if (mutationContext && !pipelineMutationIsCurrent(mutationContext)) return null;
            const updated = await updateDocumentPipeline(pipelineId, { expectedRevision: latest.revision, name }, controller.signal);
            if (!documentIsCurrent()) return null;
            applyRenamed(updated);
            return updated;
          }
        } catch (reconcileError) {
          if (isAbortError(reconcileError) || !documentIsCurrent()) return null;
          setPersistenceError(asApiError(reconcileError, "Pipeline rename conflict could not be reconciled."));
          return null;
        }
      }
      setPersistenceError(asApiError(error, "Pipeline could not be renamed."));
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, `pipeline-rename:${pipelineId}`, controller);
    }
  }, [commitDocumentSnapshot, loadDocumentSnapshot, pipelineMutationIsCurrent, pipelines, replaceController, replacePipelineState]);

  const deletePipeline = useCallback(async (pipelineId: string) => {
    const current = pipelines.find((item) => item.id === pipelineId);
    if (!current) return false;
    const documentEpoch = documentEpochRef.current;
    const documentIsCurrent = () => documentEpochRef.current === documentEpoch && activeDocumentRef.current?.id === current.documentId;
    const controller = replaceController(`pipeline-delete:${pipelineId}`);
    try {
      await deleteDocumentPipeline(pipelineId, controller.signal);
      if (!documentIsCurrent()) return true;
      setPersistenceError(null);
      setPipelines((items) => items.filter((item) => item.id !== pipelineId));
      const activePipeline = activePipelineRef.current;
      if (activePipeline?.id === pipelineId) {
        rememberSelection(current.documentId, selectedLineageRef.current);
        activePipelineRef.current = null;
        setActivePipelineId(null);
        rememberActivePipeline(null, authUserId, activePipeline.documentId);
      }
      return true;
    } catch (error) {
      if (isAbortError(error) || !documentIsCurrent()) return false;
      setPersistenceError(asApiError(error, "Pipeline could not be deleted."));
      return false;
    } finally {
      removeControllerIfCurrent(controllersRef.current, `pipeline-delete:${pipelineId}`, controller);
    }
  }, [authUserId, pipelines, rememberSelection, replaceController]);

  const inspectParseRun = useCallback(async (runId: string): Promise<ParseRun | null> => {
    const document = activeDocumentRef.current;
    const summary = document?.parseRuns.find((run) => run.id === runId);
    if (!document || !summary || summary.status !== "completed") return null;
    beginArtifactInspection("parse", runId);
    setInspectedParseResult(null);
    return hydrateParseDetail(document.id, runId);
  }, [beginArtifactInspection, hydrateParseDetail]);

  const inspectChunkRun = useCallback(async (runId: string): Promise<ChunkRun | null> => {
    const document = activeDocumentRef.current;
    const summary = document?.chunkRuns.find((run) => run.id === runId);
    if (!document || !summary || summary.status !== "completed") return null;
    beginArtifactInspection("chunk", runId);
    setInspectedChunkRun(null);
    return hydrateChunkDetail(document.id, runId);
  }, [beginArtifactInspection, hydrateChunkDetail]);

  const inspectEmbeddingRun = useCallback(async (runId: string): Promise<EmbeddingRun | null> => {
    const document = activeDocumentRef.current;
    const summary = document?.embeddingRuns.find((run) => run.id === runId);
    if (!document || !summary || summary.status !== "completed") return null;
    beginArtifactInspection("embedding", runId);
    setInspectedEmbeddingRun(null);
    return hydrateEmbeddingDetail(document.id, runId);
  }, [beginArtifactInspection, hydrateEmbeddingDetail]);

  /** Applies a new working lineage locally and clears artifacts that no longer belong to it. */
  const applyWorkingSelection = useCallback((selection: DocumentLineageSelection, changed: "parse" | "chunk" | "embedding") => {
    applySelectedLineage(selection);
    resetInspection(selection);
    if (changed === "parse") setSelectedParseResult(null);
    if (changed === "parse" || changed === "chunk") {
      setSelectedChunkRun(null);
      setChunkStatus("ready");
    }
    setSelectedEmbeddingRun(null);
    setEmbeddingStatus(changed === "embedding" ? "ready" : "locked");
    setExperimentRun(null);
    setExperimentStatus("ready");
    setEvaluationRun(null);
  }, [applySelectedLineage, resetInspection]);

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
    selectionRequestRef.current += 1;
    rememberSelection(document.id, selection);
    applyWorkingSelection(selection, "parse");
    void hydrateParseDetail(document.id, runId);
  }, [applyWorkingSelection, hydrateParseDetail, inspectParseRun, rememberSelection]);

  const selectChunkRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.chunkRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary)) return;
    if (activePipelineRef.current) {
      await inspectChunkRun(runId);
      return;
    }
    const { selectedParseRunId: parseRunId } = selectedLineageRef.current;
    if (summary?.upstream.parseRunId !== parseRunId) return;
    const selection = { selectedParseRunId: parseRunId, selectedChunkRunId: runId, selectedEmbeddingRunId: null };
    selectionRequestRef.current += 1;
    rememberSelection(document.id, selection);
    applyWorkingSelection(selection, "chunk");
    void hydrateChunkDetail(document.id, runId);
  }, [applyWorkingSelection, hydrateChunkDetail, inspectChunkRun, rememberSelection]);

  const selectEmbeddingRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.embeddingRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary)) return;
    if (activePipelineRef.current) {
      await inspectEmbeddingRun(runId);
      return;
    }
    const { selectedParseRunId: parseRunId, selectedChunkRunId: chunkRunId } = selectedLineageRef.current;
    if (summary?.upstream.chunkRunId !== chunkRunId) return;
    const selection = { selectedParseRunId: parseRunId, selectedChunkRunId: chunkRunId, selectedEmbeddingRunId: runId };
    selectionRequestRef.current += 1;
    rememberSelection(document.id, selection);
    applyWorkingSelection(selection, "embedding");
    void hydrateEmbeddingDetail(document.id, runId);
  }, [applyWorkingSelection, hydrateEmbeddingDetail, inspectEmbeddingRun, rememberSelection]);

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
    applyWorkingSelection(selection, "parse");
    const persisted = await persistActivePipelineSelection(selection);
    if (!persisted || selectionRequestRef.current !== requestId || activeDocumentRef.current?.id !== document.id) return false;
    void hydrateParseDetail(document.id, runId);
    return true;
  }, [applyWorkingSelection, hydrateParseDetail, persistActivePipelineSelection, rejectPipelineSelection, replacePipelineState]);

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
    applyWorkingSelection(selection, "chunk");
    const persisted = await persistActivePipelineSelection(selection);
    if (!persisted || selectionRequestRef.current !== requestId || activeDocumentRef.current?.id !== document.id) return false;
    void hydrateChunkDetail(document.id, runId);
    return true;
  }, [applyWorkingSelection, hydrateChunkDetail, persistActivePipelineSelection, rejectPipelineSelection, replacePipelineState]);

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
    applyWorkingSelection(selection, "embedding");
    const persisted = await persistActivePipelineSelection(selection);
    if (!persisted || selectionRequestRef.current !== requestId || activeDocumentRef.current?.id !== document.id) return false;
    void hydrateEmbeddingDetail(document.id, runId);
    return true;
  }, [applyWorkingSelection, hydrateEmbeddingDetail, persistActivePipelineSelection, rejectPipelineSelection, replacePipelineState]);

  const runChunking = useCallback(async (strategy: ChunkStrategy, config: ChunkConfig): Promise<ChunkRun | null> => {
    const documentId = activeDocumentRef.current?.id;
    const parseRunId = selectedLineageRef.current.selectedParseRunId;
    if (!documentId || !parseRunId || chunkStatus === "processing") return null;
    const scope = captureScope();
    const controller = replaceController("chunk");
    setChunkStatus("processing");
    setChunkError(null);
    setSelectedEmbeddingRun(null);
    setExperimentRun(null);
    setEvaluationRun(null);
    try {
      const result = await createChunkRun(documentId, strategy, config, parseRunId, controller.signal);
      if (!scope.isCurrent()) return null;
      const selection = {
        selectedParseRunId: parseRunId,
        selectedChunkRunId: result.id,
        selectedEmbeddingRunId: null,
      };
      if (!await persistActivePipelineSelection(selection)) return null;
      const snapshot = await loadDocumentSnapshot(documentId, controller.signal, selection, Boolean(activePipelineRef.current));
      if (!scope.isCurrent()) return null;
      commitDocumentSnapshot(snapshot);
      cacheArtifact("chunk", result.id, result);
      setSelectedChunkRun(result);
      setChunkStatus("completed");
      return result;
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return null;
      setChunkError(asApiError(error, "Chunking could not be completed."));
      setChunkStatus("error");
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "chunk", controller);
    }
  }, [cacheArtifact, captureScope, chunkStatus, commitDocumentSnapshot, loadDocumentSnapshot, persistActivePipelineSelection, replaceController]);

  const runEmbedding = useCallback(async (): Promise<EmbeddingRun | null> => {
    const documentId = activeDocumentRef.current?.id;
    const { selectedParseRunId: parseRunId, selectedChunkRunId: chunkRunId } = selectedLineageRef.current;
    if (!documentId || !chunkRunId || embeddingStatus === "processing") return null;
    const scope = captureScope();
    const controller = replaceController("embedding");
    setEmbeddingStatus("processing");
    setEmbeddingError(null);
    setExperimentRun(null);
    setEvaluationRun(null);
    try {
      const result = await createEmbeddingRun(documentId, chunkRunId, controller.signal);
      if (!scope.isCurrent()) return null;
      const selection = {
        selectedParseRunId: parseRunId,
        selectedChunkRunId: chunkRunId,
        selectedEmbeddingRunId: result.id,
      };
      if (!await persistActivePipelineSelection(selection)) return null;
      const snapshot = await loadDocumentSnapshot(documentId, controller.signal, selection, Boolean(activePipelineRef.current));
      if (!scope.isCurrent()) return null;
      commitDocumentSnapshot(snapshot);
      cacheArtifact("embedding", result.id, result);
      setSelectedEmbeddingRun(result);
      setEmbeddingStatus("completed");
      return result;
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return null;
      setEmbeddingError(asApiError(error, "Embeddings could not be created."));
      setEmbeddingStatus("error");
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, "embedding", controller);
    }
  }, [cacheArtifact, captureScope, commitDocumentSnapshot, embeddingStatus, loadDocumentSnapshot, persistActivePipelineSelection, replaceController]);

  const commitExperimentResult = useCallback((result: ExperimentRun) => {
    setExperimentRun(result);
    setExperimentHistory((current) => [result, ...current.filter((run) => run.id !== result.id)]);
    setExperimentError(result.error ? new DocumentApiError(result.error.code, result.error.message) : null);
    setExperimentStatus(pipelineStatusFromRun(result));
    setEvaluationStatus(evaluationDatasets.length > 0 ? "ready" : "locked");
  }, [evaluationDatasets.length]);

  const commitEvaluationResult = useCallback((result: EvaluationRun) => {
    setEvaluationRun(result);
    setEvaluationHistory((current) => [result, ...current.filter((run) => run.id !== result.id)]);
    setEvaluationError(result.error ? new DocumentApiError(result.error.code, result.error.message) : null);
    setEvaluationStatus(pipelineStatusFromRun(result));
  }, []);

  const runExperiment = useCallback(async (input: Omit<ExperimentRequest, "documentId" | "chunkRunId" | "embeddingRunId">) => {
    const documentId = activeDocumentRef.current?.id;
    const chunkRunId = selectedLineageRef.current.selectedChunkRunId;
    const embeddingRunId = input.retrieval.mode === "keyword" ? null : selectedLineageRef.current.selectedEmbeddingRunId;
    if (!documentId || !chunkRunId || experimentStatus === "processing") return;
    if (input.retrieval.mode !== "keyword" && !embeddingRunId) return;
    const scope = captureScope();
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
        if (!scope.isCurrent()) return;
        setExperimentRun(progressRun);
        setExperimentHistory((current) => [progressRun, ...current.filter((run) => run.id !== progressRun.id)]);
        setExperimentStatus(pipelineStatusFromRun(progressRun));
      });
      if (!scope.isCurrent()) return;
      commitExperimentResult(result);
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return;
      setExperimentError(asApiError(error, "The experiment could not be completed."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment", controller);
    }
  }, [captureScope, commitExperimentResult, experimentStatus, replaceController]);

  const loadExperiment = useCallback(async (experimentId: string) => {
    const documentId = activeDocumentRef.current?.id;
    if (!documentId) return;
    controllersRef.current.get("experiment")?.abort();
    const scope = captureScope();
    const cached = readArtifact<ExperimentRun>("experiment", experimentId);
    if (cached && cached.documentId === documentId) {
      commitExperimentResult(cached);
      if (isRunInFlight(cached.status)) setExperimentStatus("ready");
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
      if (!scope.isCurrent()) return;
      cacheArtifact("experiment", experimentId, result);
      commitExperimentResult(result);
      if (isRunInFlight(result.status)) setExperimentStatus("ready");
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return;
      setExperimentError(asApiError(error, "The experiment could not be loaded."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment-load", controller);
    }
  }, [cacheArtifact, captureScope, commitExperimentResult, readArtifact, replaceController]);

  const loadEvaluationDataset = useCallback(async (datasetId: string): Promise<EvaluationDataset | null> => {
    const activeSummary = activeDocumentRef.current;
    const documentId = activeSummary?.id;
    if (!documentId || !activeSummary.evaluationDatasets.some((dataset) => dataset.id === datasetId)) return null;
    const scope = captureScope();
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
      if (!scope.isCurrent()) return dataset;
      cacheArtifact("dataset", datasetId, dataset);
      return dataset;
    } catch (error) {
      if (!isAbortError(error) && scope.isCurrent()) {
        setEvaluationError(asApiError(error, "The selected evaluation dataset could not be loaded."));
      }
      return null;
    } finally {
      removeControllerIfCurrent(controllersRef.current, controllerKey, controller);
    }
  }, [cacheArtifact, captureScope, readArtifact, replaceController]);

  const loadEvaluationRun = useCallback(async (runId: string) => {
    const documentId = activeDocumentRef.current?.id;
    if (!documentId) return;
    controllersRef.current.get("evaluation")?.abort();
    controllersRef.current.get("evaluation-history")?.abort();
    const scope = captureScope();
    const belongsToDocument = (run: EvaluationRun) => activeDocumentRef.current?.evaluationDatasets.some((dataset) => dataset.id === run.datasetId) ?? false;
    const cached = readArtifact<EvaluationRun>("evaluation", runId);
    if (cached && belongsToDocument(cached)) {
      commitEvaluationResult(cached);
      if (isRunInFlight(cached.status)) setEvaluationStatus("ready");
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
      if (!scope.isCurrent()) return;
      cacheArtifact("evaluation", runId, result);
      commitEvaluationResult(result);
      if (isRunInFlight(result.status)) setEvaluationStatus("ready");
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return;
      setEvaluationError(asApiError(error, "The selected evaluation run could not be loaded."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation-load", controller);
    }
  }, [cacheArtifact, captureScope, commitEvaluationResult, readArtifact, replaceController]);

  const { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId } = selectedLineage;

  useEffect(() => {
    const documentId = activeDocumentRef.current?.id;
    if (!documentId) return;
    // Use screens always hydrate the selected lineage; an inspection cursor never leaks into them.
    const needsParseDetail = pathname === "/parse" || pathname === "/playground" || pathname === "/evaluation";
    if (needsParseDetail && selectedParseRunId) void hydrateParseDetail(documentId, selectedParseRunId);
    if (pathname === "/chunking" && selectedChunkRunId) void hydrateChunkDetail(documentId, selectedChunkRunId);
    if (pathname === "/embeddings" && selectedEmbeddingRunId) void hydrateEmbeddingDetail(documentId, selectedEmbeddingRunId);
    if (pathname === "/playground" && !experimentRun) {
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
    const scope = captureScope();
    const controller = replaceController("experiment-continue");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await continueExperiment(experimentId, controller.signal);
      if (!scope.isCurrent()) return;
      commitExperimentResult(result);
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return;
      setExperimentError(asApiError(error, "The experiment could not continue."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment-continue", controller);
    }
  }, [captureScope, commitExperimentResult, experimentRun?.id, experimentStatus, replaceController]);

  const rerunCurrentGeneration = useCallback(async () => {
    const documentId = activeDocumentRef.current?.id;
    const experimentId = experimentRun?.id;
    if (!documentId || !experimentId || experimentStatus === "processing") return;
    const scope = captureScope();
    const controller = replaceController("experiment-rerun-generation");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await rerunGeneration(experimentId, controller.signal);
      if (!scope.isCurrent()) return;
      commitExperimentResult(result);
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return;
      setExperimentError(asApiError(error, "Generation could not be run again."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment-rerun-generation", controller);
    }
  }, [captureScope, commitExperimentResult, experimentRun?.id, experimentStatus, replaceController]);

  const createDataset = useCallback(async (name: string, cases: EvaluationCase[], baseDatasetId?: string | null) => {
    const documentId = activeDocumentRef.current?.id;
    const { selectedParseRunId: parseRunId, selectedChunkRunId: chunkRunId } = selectedLineageRef.current;
    if (!documentId || !parseRunId) return;
    const scope = captureScope();
    const controller = replaceController("evaluation-dataset");
    setEvaluationStatus("processing");
    setEvaluationError(null);
    try {
      const dataset = await createEvaluationDataset({ documentId, parseRunId, name, cases, baseDatasetId }, controller.signal);
      if (!scope.isCurrent()) return;
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
      setEvaluationStatus(chunkRunId ? "ready" : "locked");
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return;
      setEvaluationError(asApiError(error, "The evaluation dataset could not be created."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation-dataset", controller);
    }
  }, [cacheArtifact, captureScope, replaceController]);

  const runEvaluation = useCallback(async (input: EvaluationRunInput) => {
    const chunkRunId = selectedLineageRef.current.selectedChunkRunId;
    const embeddingRunId = input.retrieval.mode === "keyword" ? null : selectedLineageRef.current.selectedEmbeddingRunId;
    if (!chunkRunId || (input.retrieval.mode !== "keyword" && !embeddingRunId) || evaluationStatus === "processing") return;
    if (!activeDocumentRef.current?.id) return;
    const scope = captureScope();
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
        if (!scope.isCurrent()) return;
        setEvaluationRun(progressRun);
        setEvaluationHistory((current) => [progressRun, ...current.filter((run) => run.id !== progressRun.id)]);
        setEvaluationStatus(pipelineStatusFromRun(progressRun));
      });
      if (!scope.isCurrent()) return;
      commitEvaluationResult(result);
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return;
      setEvaluationError(asApiError(error, "Evaluation could not be completed."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation", controller);
    }
  }, [captureScope, commitEvaluationResult, evaluationStatus, replaceController]);

  const refreshEvaluationRuns = useCallback(async (datasetId: string) => {
    const document = activeDocumentRef.current;
    if (!document?.id || !document.evaluationDatasets.some((dataset) => dataset.id === datasetId)) return;
    const scope = captureScope();
    const controller = replaceController("evaluation-history");
    try {
      const runs = await listEvaluationRuns(datasetId, controller.signal);
      if (!scope.isCurrent()) return;
      setEvaluationHistory(runs);
      const latestRun = runs.find((run) => isRunInFlight(run.status))
        ?? runs.find((run) => run.status === "completed" || run.status === "failed");
      if (!latestRun) {
        setEvaluationRun(null);
        return;
      }
      setEvaluationRun(latestRun);
      setEvaluationStatus(pipelineStatusFromRun(latestRun));
      const detail = isRunInFlight(latestRun.status)
        ? await waitForEvaluationRun(latestRun.id, controller.signal, (progress) => {
          if (!scope.isCurrent()) return;
          setEvaluationRun(progress);
          setEvaluationHistory((current) => [progress, ...current.filter((run) => run.id !== progress.id)]);
        })
        : await getEvaluationRun(latestRun.id, controller.signal);
      if (!scope.isCurrent()) return;
      cacheArtifact("evaluation", detail.id, detail);
      commitEvaluationResult(detail);
    } catch (error) {
      if (isAbortError(error) || !scope.isCurrent()) return;
      setEvaluationError(asApiError(error, "Evaluation history could not be loaded."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation-history", controller);
    }
  }, [cacheArtifact, captureScope, commitEvaluationResult, replaceController]);

  const resumeRunTracking = useCallback(async (kind: "experiment" | "evaluation") => {
    const runId = kind === "experiment" ? experimentRun?.id : evaluationRun?.id;
    const documentId = activeDocumentRef.current?.id;
    if (!runId || !documentId) return;
    const scope = captureScope();
    controllersRef.current.get(`${kind}-load`)?.abort();
    if (kind === "evaluation") controllersRef.current.get("evaluation-history")?.abort();
    const controller = replaceController(kind);
    const isCurrent = () => !controller.signal.aborted && scope.isCurrent();
    const setStatus = kind === "experiment" ? setExperimentStatus : setEvaluationStatus;
    const setError = kind === "experiment" ? setExperimentError : setEvaluationError;
    setStatus("processing");
    setError(null);
    try {
      // No initial/cached run: resuming always begins with a fresh GET.
      if (kind === "experiment") {
        const accept = (run: ExperimentRun) => {
          if (isCurrent() && run.documentId === documentId) {
            setExperimentRun(run);
            setExperimentHistory((current) => [run, ...current.filter((item) => item.id !== run.id)]);
          }
        };
        const result = await waitForExperimentRun(runId, controller.signal, accept);
        if (isCurrent() && result.documentId === documentId) {
          cacheArtifact("experiment", runId, result);
          setExperimentRun(result);
          setExperimentHistory((current) => [result, ...current.filter((item) => item.id !== result.id)]);
          setExperimentError(result.error ? new DocumentApiError(result.error.code, result.error.message) : null);
          setExperimentStatus(result.status === "completed" ? "completed" : "error");
        }
      } else {
        const result = await waitForEvaluationRun(runId, controller.signal, (run) => {
          if (isCurrent()) setEvaluationRun(run);
        });
        if (isCurrent()) {
          cacheArtifact("evaluation", runId, result);
          commitEvaluationResult(result);
        }
      }
    } catch (error) {
      if (!isCurrent()) return;
      setError(asApiError(error, "Run tracking could not be completed."));
      setStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, kind, controller);
    }
  }, [experimentRun?.id, evaluationRun?.id, captureScope, replaceController, cacheArtifact, commitEvaluationResult]);

  const activePipeline = useMemo(
    () => pipelines.find((pipeline) => pipeline.id === activePipelineId) ?? null,
    [activePipelineId, pipelines],
  );

  const inspectingParse = inspectedLineage.selectedParseRunId !== null && inspectedLineage.selectedParseRunId !== selectedParseRunId;
  const inspectingChunk = inspectedLineage.selectedChunkRunId !== null && inspectedLineage.selectedChunkRunId !== selectedChunkRunId;
  const inspectingEmbedding = inspectedLineage.selectedEmbeddingRunId !== null && inspectedLineage.selectedEmbeddingRunId !== selectedEmbeddingRunId;
  const parseResult = inspectingParse ? inspectedParseResult : selectedParseResult;
  const chunkRun = inspectingChunk ? inspectedChunkRun : selectedChunkRun;
  const embeddingRun = inspectingEmbedding ? inspectedEmbeddingRun : selectedEmbeddingRun;
  // A resolved auth check without a user must not leave the workspace in
  // "checking" forever: surface it so the screen can offer a retry.
  const authBlocked = authReady && !authoritativeUserId;
  const effectivePersistenceStatus: PersistenceStatus = authBlocked ? "unavailable" : persistenceStatus;
  const effectivePersistenceError = useMemo(() => {
    if (!authBlocked) return persistenceError;
    return authError
      ? new DocumentApiError("auth_unavailable", "Your session could not be verified. Retry or sign in again.")
      : new DocumentApiError("auth_required", "Sign in to load your documents.");
  }, [authBlocked, authError, persistenceError]);
  const workspaceStatus: WorkspaceStatus = effectivePersistenceStatus === "unavailable"
    ? "unavailable"
    : !authReady || effectivePersistenceStatus === "checking" || (activeDocumentId !== null && activeDocument?.id !== activeDocumentId)
      ? "loading"
      : "ready";
  const reparseImpact = useMemo(() => describeReparseImpact(activePipeline, selectedLineage), [activePipeline, selectedLineage]);

  const value = useMemo<DocumentPipelineContextValue>(() => ({
    parseStatus, parseProgress, parsePhase,
    parseProgressEstimated: parseProgress > lastReportedParseProgress,
    parseResult, parseError,
    persistenceStatus: effectivePersistenceStatus, persistenceError: effectivePersistenceError, workspaceStatus, capabilities, documents, activeDocumentId, activeDocumentMetadata, activeDocument,
    selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId,
    selectedParseResult, selectedChunkRun, selectedEmbeddingRun,
    inspectedParseRunId: inspectedLineage.selectedParseRunId,
    inspectedChunkRunId: inspectedLineage.selectedChunkRunId,
    inspectedEmbeddingRunId: inspectedLineage.selectedEmbeddingRunId,
    chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError,
    experimentStatus, experimentRun, experimentError, experimentHistory,
    evaluationDatasets, evaluationStatus, evaluationRun, evaluationError, evaluationHistory,
    uploadNotice,
    pipelines, activePipelineId, activePipeline,
    pipelineSelectionMode: activePipeline ? "saved" : "scratch",
    reparseImpact,
    addDocument, selectPersistedDocument, deletePersistedDocument, selectParseRun, selectChunkRun, selectEmbeddingRun, inspectParseRun, inspectChunkRun, inspectEmbeddingRun,
    setPipelineParseRun, setPipelineChunkRun, setPipelineEmbeddingRun, reparseActiveDocument, runChunking, runEmbedding,
    runExperiment, loadExperiment, loadEvaluationDataset, loadEvaluationRun, resumeRunTracking, continueExperiment: continueCurrentExperiment, rerunGeneration: rerunCurrentGeneration,
    createDataset, runEvaluation, refreshPersistence, refreshEvaluationRuns,
    selectPipeline, createPipeline, renamePipeline, deletePipeline,
  }), [
    activeDocument, activeDocumentId, activeDocumentMetadata, activePipeline, activePipelineId, capabilities, chunkError, chunkRun, chunkStatus, createDataset, documents,
    embeddingError, embeddingRun, embeddingStatus, evaluationDatasets, evaluationError, evaluationHistory,
    evaluationRun, evaluationStatus, experimentError, experimentHistory, experimentRun, experimentStatus,
    inspectedLineage, lastReportedParseProgress, parseError, parsePhase, parseProgress, parseResult, parseStatus, effectivePersistenceError, effectivePersistenceStatus,
    pipelines, reparseImpact, selectedChunkRun, selectedChunkRunId, selectedEmbeddingRun, selectedEmbeddingRunId, selectedParseResult, selectedParseRunId, uploadNotice, workspaceStatus,
    addDocument, deletePersistedDocument, reparseActiveDocument,
    continueCurrentExperiment, inspectChunkRun, inspectEmbeddingRun, inspectParseRun, loadEvaluationDataset, loadEvaluationRun, loadExperiment, refreshEvaluationRuns, refreshPersistence, rerunCurrentGeneration,
    runChunking, runEmbedding, runEvaluation, runExperiment, resumeRunTracking,
    createPipeline, deletePipeline, renamePipeline, selectChunkRun, selectEmbeddingRun, selectParseRun, selectPersistedDocument, selectPipeline,
    setPipelineChunkRun, setPipelineEmbeddingRun, setPipelineParseRun,
  ]);

  return <DocumentPipelineContext.Provider value={value}>{children}</DocumentPipelineContext.Provider>;
}

export function useDocumentPipeline() {
  const context = useContext(DocumentPipelineContext);
  if (!context) throw new Error("useDocumentPipeline must be used within DocumentPipelineProvider");
  return context;
}
