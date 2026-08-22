"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import { DocumentApiError, type DocumentApiErrorCode } from "@/lib/document-api";
import { validatePdfFile, type DocumentFileValidationError } from "@/lib/document-file";
import type { DocumentParseResponse } from "@/lib/document-parse-types";
import {
  createChunkRun,
  createEmbeddingRun,
  createEvaluationDataset,
  createEvaluationRun,
  createExperiment,
  continueExperiment,
  getCapabilities,
  getChunkRun,
  getDocument,
  getExperiment,
  getParseRun,
  getEmbeddingRun,
  listDocuments,
  listEvaluationDatasets,
  listEvaluationRuns,
  listExperiments,
  parseAndPersistDocument,
  reparsePersistedDocument,
  rerunGeneration,
  waitForParseRun,
} from "@/lib/rag-api";
import type {
  Capabilities,
  ChunkConfig,
  ChunkRun,
  ChunkStrategy,
  DocumentDetail,
  EmbeddingRun,
  EvaluationCase,
  EvaluationDataset,
  EvaluationRun,
  ExperimentRequest,
  ExperimentRun,
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
  detail: DocumentDetail;
  selection: DocumentLineageSelection;
  parseResult: DocumentParseResponse | null;
  parseStatus: DocumentParseStatus;
  inFlightParseRunId: string | null;
  parseError: DocumentApiError | null;
  chunkRun: ChunkRun | null;
  chunkStatus: PipelineOperationStatus;
  embeddingRun: EmbeddingRun | null;
  embeddingStatus: PipelineOperationStatus;
  experiments: ExperimentRun[];
  datasets: EvaluationDataset[];
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
  activeDocument: DocumentDetail | null;
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
  experimentHistory: ExperimentRun[];
  evaluationDatasets: EvaluationDataset[];
  evaluationStatus: PipelineOperationStatus;
  evaluationRun: EvaluationRun | null;
  evaluationError: DocumentApiError | null;
  evaluationHistory: EvaluationRun[];
  selectFile: (file: File | undefined) => void;
  selectPersistedDocument: (documentId: string) => Promise<void>;
  selectParseRun: (runId: string) => Promise<void>;
  selectChunkRun: (runId: string) => Promise<void>;
  selectEmbeddingRun: (runId: string) => Promise<void>;
  removeFile: () => void;
  parseSelectedFile: () => Promise<void>;
  reparseActiveDocument: () => Promise<void>;
  runChunking: (strategy: ChunkStrategy, config: ChunkConfig) => Promise<ChunkRun | null>;
  runEmbedding: () => Promise<EmbeddingRun | null>;
  runExperiment: (input: Omit<ExperimentRequest, "documentId" | "chunkRunId" | "embeddingRunId">) => Promise<void>;
  loadExperiment: (experimentId: string) => Promise<void>;
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

function lineageSelectionStorageKey(userId?: string | null) {
  return userId ? `${LINEAGE_SELECTION_STORAGE_PREFIX}${userId}` : LINEAGE_SELECTION_STORAGE_KEY;
}

function emptyLineageSelection(): DocumentLineageSelection {
  return { selectedParseRunId: null, selectedChunkRunId: null, selectedEmbeddingRunId: null };
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

function resolveLineageSelection(detail: DocumentDetail, stored?: DocumentLineageSelection): DocumentLineageSelection {
  const candidate = stored ?? emptyLineageSelection();
  const parse = detail.parseRuns.find((run) => run.id === candidate.selectedParseRunId && completedCompatibleRun(run))
    ?? detail.parseRuns.find((run) => run.id === detail.activeParseRunId && completedCompatibleRun(run));
  const parseRunId = parse?.id ?? null;
  const chunk = parseRunId
    ? detail.chunkRuns.find((run) => run.id === candidate.selectedChunkRunId && run.upstream.parseRunId === parseRunId && completedCompatibleRun(run))
      ?? detail.chunkRuns.find((run) => run.id === detail.activeChunkRunId && run.upstream.parseRunId === parseRunId && completedCompatibleRun(run))
    : undefined;
  const chunkRunId = chunk?.id ?? null;
  const embedding = chunkRunId
    ? detail.embeddingRuns.find((run) => run.id === candidate.selectedEmbeddingRunId && run.upstream.chunkRunId === chunkRunId && completedCompatibleRun(run))
      ?? detail.embeddingRuns.find((run) => run.id === detail.activeEmbeddingRunId && run.upstream.chunkRunId === chunkRunId && completedCompatibleRun(run))
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
  const [activeDocument, setActiveDocument] = useState<DocumentDetail | null>(null);
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
  const [experimentHistory, setExperimentHistory] = useState<ExperimentRun[]>([]);
  const [evaluationDatasets, setEvaluationDatasets] = useState<EvaluationDataset[]>([]);
  const [evaluationStatus, setEvaluationStatus] = useState<PipelineOperationStatus>("locked");
  const [evaluationRun, setEvaluationRun] = useState<EvaluationRun | null>(null);
  const [evaluationError, setEvaluationError] = useState<DocumentApiError | null>(null);
  const [evaluationHistory, setEvaluationHistory] = useState<EvaluationRun[]>([]);
  const runIdRef = useRef(0);
  const documentEpochRef = useRef(0);
  const documentLoadRequestRef = useRef(0);
  const selectionRequestRef = useRef(0);
  const activeDocumentRef = useRef<DocumentDetail | null>(null);
  const lineageSelectionsRef = useRef<LineageSelectionStore>({});
  const activityIdRef = useRef(0);
  const controllersRef = useRef(new Map<string, AbortController>());

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/auth/")) return;
    try {
      const supabase = getSupabaseBrowserClient();
      void supabase.auth.getUser().then(({ data }) => setAuthUserId(data.user?.id ?? null));
      const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => setAuthUserId(session?.user.id ?? null));
      return () => listener.subscription.unsubscribe();
    } catch {
      return;
    }
  }, [pathname]);

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
    setActiveDocument(snapshot.detail);
    setSelectedParseRunId(snapshot.selection.selectedParseRunId);
    setSelectedChunkRunId(snapshot.selection.selectedChunkRunId);
    setSelectedEmbeddingRunId(snapshot.selection.selectedEmbeddingRunId);
    setPersistenceError(null);
    if (persistSelection) rememberSelection(snapshot.detail.id, snapshot.selection);
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
  ): Promise<DocumentSnapshot> => {
    const detail = await getDocument(documentId, signal);
    const selection = resolveLineageSelection(detail, selectionOverride ?? lineageSelectionsRef.current[documentId]);
    const parseSummary = selection.selectedParseRunId
      ? detail.parseRuns.find((run) => run.id === selection.selectedParseRunId) ?? null
      : null;
    const inFlightParseSummary = detail.parseRuns.find((run) => run.status === "queued" || run.status === "running") ?? null;
    const latestParseSummary = detail.parseRuns[0] ?? null;
    const failedReparseSummary = latestParseSummary?.status === "failed" && latestParseSummary.id !== detail.activeParseRunId
      ? latestParseSummary
      : null;
    const visibleParseSummary = inFlightParseSummary ?? failedReparseSummary ?? parseSummary;
    const [experiments, datasets, parseResult, chunkRun, embeddingRun] = await Promise.all([
      listExperiments(documentId, signal),
      listEvaluationDatasets(documentId, signal),
      selection.selectedParseRunId === detail.activeParseRunId && detail.activeParseRun
        ? Promise.resolve(detail.activeParseRun)
        : selection.selectedParseRunId
          ? getParseRun(selection.selectedParseRunId, signal, documentId).then((run) => run.result)
          : Promise.resolve(null),
      selection.selectedChunkRunId
        ? getChunkRun(selection.selectedChunkRunId, signal)
        : Promise.resolve(null),
      selection.selectedEmbeddingRunId
        ? getEmbeddingRun(selection.selectedEmbeddingRunId, signal)
        : Promise.resolve(null),
    ]);
    const chunkMatchesLineage = Boolean(
      chunkRun
      && chunkRun.documentId === detail.id
      && chunkRun.parseRunId === selection.selectedParseRunId
      && completedCompatibleRun(detail.chunkRuns.find((run) => run.id === chunkRun.id)),
    );
    const embeddingMatchesLineage = Boolean(
      embeddingRun
      && embeddingRun.documentId === detail.id
      && embeddingRun.chunkRunId === selection.selectedChunkRunId
      && completedCompatibleRun(detail.embeddingRuns.find((run) => run.id === embeddingRun.id)),
    );
    const effectiveSelection: DocumentLineageSelection = {
      selectedParseRunId: parseResult && parseSummary && completedCompatibleRun(parseSummary) ? selection.selectedParseRunId : null,
      selectedChunkRunId: chunkMatchesLineage ? selection.selectedChunkRunId : null,
      selectedEmbeddingRunId: embeddingMatchesLineage ? selection.selectedEmbeddingRunId : null,
    };
    const filteredDatasets = datasets.filter((dataset) => dataset.parseRunId === effectiveSelection.selectedParseRunId);
    const selectedExperiment = experiments.find((run) => run.isCompatible
      && run.upstream.chunkRunId === effectiveSelection.selectedChunkRunId
      && (run.embeddingRunId === null || run.embeddingRunId === effectiveSelection.selectedEmbeddingRunId)) ?? null;
    const nextParseStatus: DocumentParseStatus = inFlightParseSummary
      ? inFlightParseSummary.status
      : failedReparseSummary
        ? "failed"
        : parseResult
          ? "completed"
          : "not-started";
    const embeddingReady = Boolean(effectiveSelection.selectedChunkRunId && embeddingMatchesLineage);
    return {
      detail,
      selection: effectiveSelection,
      parseResult: effectiveSelection.selectedParseRunId ? parseResult : null,
      parseStatus: nextParseStatus,
      inFlightParseRunId: inFlightParseSummary?.id ?? null,
      parseError: visibleParseSummary?.error
        ? new DocumentApiError(visibleParseSummary.error.code, visibleParseSummary.error.message)
        : null,
      chunkRun: chunkMatchesLineage ? chunkRun : null,
      chunkStatus: !effectiveSelection.selectedParseRunId ? "locked" : chunkMatchesLineage ? "completed" : "ready",
      embeddingRun: embeddingMatchesLineage ? embeddingRun : null,
      embeddingStatus: !effectiveSelection.selectedChunkRunId ? "locked" : embeddingReady ? "completed" : "ready",
      experiments,
      datasets: filteredDatasets,
      experimentStatus: effectiveSelection.selectedChunkRunId ? "ready" : "locked",
      experimentRun: selectedExperiment,
      evaluationStatus: effectiveSelection.selectedChunkRunId && effectiveSelection.selectedEmbeddingRunId && filteredDatasets.length > 0 ? "ready" : "locked",
    };
  }, []);

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
      await waitForParseRun(
        parseRunId,
        controller.signal,
        documentId,
        (run) => applyParseRunStatus(run, expectedRunId),
      );
      if (runIdRef.current !== expectedRunId || activeDocumentRef.current?.id !== documentId || activeParseRunIdRef.current !== parseRunId) return;
      const snapshot = await loadDocumentSnapshot(documentId, controller.signal, {
        selectedParseRunId: parseRunId,
        selectedChunkRunId: null,
        selectedEmbeddingRunId: null,
      });
      if (runIdRef.current !== expectedRunId || activeDocumentRef.current?.id !== documentId) return;
      documentEpochRef.current += 1;
      selectionRequestRef.current += 1;
      commitDocumentSnapshot(snapshot);
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

  const loadThenCommitDocument = useCallback(async (documentId: string, signal: AbortSignal) => {
    const requestId = ++documentLoadRequestRef.current;
    const snapshot = await loadDocumentSnapshot(documentId, signal);
    if (documentLoadRequestRef.current !== requestId) return null;
    documentEpochRef.current += 1;
    selectionRequestRef.current += 1;
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    commitDocumentSnapshot(snapshot);
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
        const loaded = await loadThenCommitDocument(documentId, controller.signal);
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

  const selectPersistedDocument = useCallback(async (documentId: string) => {
    const controller = replaceController("document");
    try {
      const loaded = await loadThenCommitDocument(documentId, controller.signal);
      if (!loaded) return;
      setPendingUpload(null);
      setFileError(null);
      if ((loaded.parseStatus === "queued" || loaded.parseStatus === "running") && loaded.inFlightParseRunId) {
        void resumeParseRun(documentId, loaded.inFlightParseRunId, runIdRef.current);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPersistenceError(asApiError(error, "The selected document could not be loaded."));
      setPersistenceStatus(activeDocumentRef.current ? "available" : "unavailable");
    }
  }, [loadThenCommitDocument, replaceController, resumeParseRun]);

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/auth/")) return;
    if (!authUserId && process.env.NODE_ENV !== "test") return;

    const controller = replaceController("bootstrap");
    void Promise.all([getCapabilities(controller.signal), listDocuments(controller.signal)])
      .then(async ([nextCapabilities, nextDocuments]) => {
        setCapabilities(nextCapabilities);
        setDocuments(nextDocuments);
        const storedSelections = readLineageSelections(authUserId);
        lineageSelectionsRef.current = storedSelections;
        let documentId: string | null = null;
        let legacyDocumentId: string | null = null;
        try {
          documentId = window.localStorage.getItem(activeDocumentStorageKey(authUserId));
          if (!documentId && authUserId) legacyDocumentId = window.localStorage.getItem(ACTIVE_DOCUMENT_STORAGE_KEY);
          documentId = documentId ?? legacyDocumentId;
        } catch {
          // Browser storage kapalıysa kalıcı backend verisi yine kullanılabilir.
        }
        if (documentId && nextDocuments.some((document) => document.id === documentId)) {
          if (legacyDocumentId) rememberActiveDocument(documentId, authUserId);
          const loaded = await loadThenCommitDocument(documentId, controller.signal);
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
  }, [authUserId, loadThenCommitDocument, pathname, replaceController, resumeParseRun]);

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
    setParseStatus(activeDocumentRef.current?.activeParseRun ? "completed" : "not-started");
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
      const snapshot = await loadDocumentSnapshot(documentId, controller.signal, {
        selectedParseRunId: result.parseRunId,
        selectedChunkRunId: null,
        selectedEmbeddingRunId: null,
      });
      if (runIdRef.current !== currentRunId) return;
      parseInFlightRef.current = false;
      runIdRef.current += 1;
      documentEpochRef.current += 1;
      selectionRequestRef.current += 1;
      removeControllerIfCurrent(controllersRef.current, "reparse", controller);
      commitDocumentSnapshot(snapshot);
      setParseStatus("completed");
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

  const selectParseRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.parseRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary)) return;
    const requestId = ++selectionRequestRef.current;
    const epoch = documentEpochRef.current;
    const controller = replaceController(`selection:${document.id}`);
    try {
      const snapshot = await loadDocumentSnapshot(document.id, controller.signal, {
        selectedParseRunId: runId,
        selectedChunkRunId: null,
        selectedEmbeddingRunId: null,
      });
      if (selectionRequestRef.current !== requestId || documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== document.id) return;
      commitDocumentSnapshot(snapshot);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPersistenceError(asApiError(error, "The selected parse run could not be loaded."));
    } finally {
      removeControllerIfCurrent(controllersRef.current, `selection:${document.id}`, controller);
    }
  }, [commitDocumentSnapshot, loadDocumentSnapshot, replaceController]);

  const selectChunkRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.chunkRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary) || summary?.upstream.parseRunId !== selectedParseRunId) return;
    const requestId = ++selectionRequestRef.current;
    const epoch = documentEpochRef.current;
    const controller = replaceController(`selection:${document.id}`);
    try {
      const snapshot = await loadDocumentSnapshot(document.id, controller.signal, {
        selectedParseRunId,
        selectedChunkRunId: runId,
        selectedEmbeddingRunId: null,
      });
      if (selectionRequestRef.current !== requestId || documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== document.id) return;
      commitDocumentSnapshot(snapshot);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPersistenceError(asApiError(error, "The selected chunk run could not be loaded."));
    } finally {
      removeControllerIfCurrent(controllersRef.current, `selection:${document.id}`, controller);
    }
  }, [commitDocumentSnapshot, loadDocumentSnapshot, replaceController, selectedParseRunId]);

  const selectEmbeddingRun = useCallback(async (runId: string) => {
    const document = activeDocumentRef.current;
    const summary = document?.embeddingRuns.find((run) => run.id === runId);
    if (!document || !completedCompatibleRun(summary) || summary?.upstream.chunkRunId !== selectedChunkRunId) return;
    const requestId = ++selectionRequestRef.current;
    const epoch = documentEpochRef.current;
    const controller = replaceController(`selection:${document.id}`);
    try {
      const snapshot = await loadDocumentSnapshot(document.id, controller.signal, {
        selectedParseRunId,
        selectedChunkRunId,
        selectedEmbeddingRunId: runId,
      });
      if (selectionRequestRef.current !== requestId || documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== document.id) return;
      commitDocumentSnapshot(snapshot);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPersistenceError(asApiError(error, "The selected embedding run could not be loaded."));
    } finally {
      removeControllerIfCurrent(controllersRef.current, `selection:${document.id}`, controller);
    }
  }, [commitDocumentSnapshot, loadDocumentSnapshot, replaceController, selectedChunkRunId, selectedParseRunId]);

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
      const snapshot = await loadDocumentSnapshot(documentId, controller.signal, {
        selectedParseRunId: parseRunId,
        selectedChunkRunId: result.id,
        selectedEmbeddingRunId: null,
      });
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedParseRunId !== parseRunId) return null;
      commitDocumentSnapshot(snapshot);
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
  }, [chunkStatus, commitDocumentSnapshot, loadDocumentSnapshot, replaceController, selectedParseRunId]);

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
      const snapshot = await loadDocumentSnapshot(documentId, controller.signal, {
        selectedParseRunId,
        selectedChunkRunId: chunkRunId,
        selectedEmbeddingRunId: result.id,
      });
      if (documentEpochRef.current !== epoch || selectionRequestRef.current !== selectionVersion || activeDocumentRef.current?.id !== documentId || selectedChunkRunId !== chunkRunId) return null;
      commitDocumentSnapshot(snapshot);
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
  }, [commitDocumentSnapshot, embeddingStatus, loadDocumentSnapshot, replaceController, selectedChunkRunId, selectedParseRunId]);

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
    const controller = replaceController("experiment-load");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await getExperiment(experimentId, controller.signal);
      if (documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== documentId) return;
      commitExperimentResult(result);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (documentEpochRef.current !== epoch || activeDocumentRef.current?.id !== documentId) return;
      setExperimentError(asApiError(error, "The experiment could not be loaded."));
      setExperimentStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "experiment-load", controller);
    }
  }, [commitExperimentResult, experimentStatus, replaceController]);

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
      setEvaluationDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
      setEvaluationStatus(selectedChunkRunId ? "ready" : "locked");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setEvaluationError(asApiError(error, "The evaluation dataset could not be created."));
      setEvaluationStatus("error");
    } finally {
      removeControllerIfCurrent(controllersRef.current, "evaluation-dataset", controller);
    }
  }, [replaceController, selectedChunkRunId, selectedParseRunId]);

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

  const value = useMemo<DocumentPipelineContextValue>(() => ({
    pendingUpload, fileError, parseStatus, parseProgress,
    parseProgressEstimated: parseProgress > lastReportedParseProgress,
    parseResult, parseError, activity,
    persistenceStatus, persistenceError, capabilities, documents, activeDocument,
    selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId,
    chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError,
    experimentStatus, experimentRun, experimentError, experimentHistory,
    evaluationDatasets, evaluationStatus, evaluationRun, evaluationError, evaluationHistory,
    selectFile, selectPersistedDocument, selectParseRun, selectChunkRun, selectEmbeddingRun, removeFile, parseSelectedFile, reparseActiveDocument, runChunking, runEmbedding,
    runExperiment, loadExperiment, continueExperiment: continueCurrentExperiment, rerunGeneration: rerunCurrentGeneration,
    createDataset, runEvaluation, refreshPersistence, refreshEvaluationRuns,
  }), [
    activeDocument, activity, capabilities, chunkError, chunkRun, chunkStatus, createDataset, documents,
    embeddingError, embeddingRun, embeddingStatus, evaluationDatasets, evaluationError, evaluationHistory,
    evaluationRun, evaluationStatus, experimentError, experimentHistory, experimentRun, experimentStatus,
    fileError, lastReportedParseProgress, parseError, parseProgress, parseResult, parseSelectedFile, parseStatus, persistenceError, persistenceStatus,
    pendingUpload, selectedChunkRunId, selectedEmbeddingRunId, selectedParseRunId,
    reparseActiveDocument,
    continueCurrentExperiment, loadExperiment, refreshEvaluationRuns, refreshPersistence, removeFile, rerunCurrentGeneration,
    runChunking, runEmbedding, runEvaluation, runExperiment,
    selectChunkRun, selectEmbeddingRun, selectFile, selectParseRun, selectPersistedDocument,
  ]);

  return <DocumentPipelineContext.Provider value={value}>{children}</DocumentPipelineContext.Provider>;
}

export function useDocumentPipeline() {
  const context = useContext(DocumentPipelineContext);
  if (!context) throw new Error("useDocumentPipeline must be used within DocumentPipelineProvider");
  return context;
}
