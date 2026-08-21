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
  getCapabilities,
  getChunkRun,
  getDocument,
  getEmbeddingRun,
  listDocuments,
  listEvaluationDatasets,
  listEvaluationRuns,
  listExperiments,
  parseAndPersistDocument,
  reparsePersistedDocument,
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

type EvaluationRunInput = {
  datasetId: string;
  judge: boolean;
  retrieval: ExperimentRequest["retrieval"];
  reranking: ExperimentRequest["reranking"];
  context: ExperimentRequest["context"];
  generation: ExperimentRequest["generation"];
};

type DocumentPipelineContextValue = {
  selectedFile: File | null;
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
  removeFile: () => void;
  parseSelectedFile: () => Promise<void>;
  reparseActiveDocument: () => Promise<void>;
  runChunking: (strategy: ChunkStrategy, config: ChunkConfig) => Promise<void>;
  runEmbedding: () => Promise<void>;
  runExperiment: (input: Omit<ExperimentRequest, "documentId" | "chunkRunId" | "embeddingRunId">) => Promise<void>;
  createDataset: (name: string, cases: EvaluationCase[]) => Promise<void>;
  runEvaluation: (input: EvaluationRunInput) => Promise<void>;
  refreshPersistence: () => Promise<void>;
  refreshEvaluationRuns: (datasetId: string) => Promise<void>;
};

const DocumentPipelineContext = createContext<DocumentPipelineContextValue | null>(null);
const ACTIVE_DOCUMENT_STORAGE_KEY = "rag-steplab-active-document-id";
const ACTIVE_DOCUMENT_STORAGE_PREFIX = `${ACTIVE_DOCUMENT_STORAGE_KEY}:`;

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

function asApiError(error: unknown, fallback: string) {
  return error instanceof DocumentApiError ? error : new DocumentApiError("unknown", fallback);
}

function staleRun<T extends { isStale: boolean }>(run: T | null): T | null {
  return run ? { ...run, isStale: true } : null;
}

export function DocumentPipelineProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const [authUserId, setAuthUserId] = useState<string | null>(process.env.NODE_ENV === "test" ? "test-user" : null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
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

  const resetDownstream = useCallback(() => {
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
  }, []);

  const loadDocumentRelatedData = useCallback(async (documentId: string, signal: AbortSignal) => {
    const detail = await getDocument(documentId, signal);
    const [experiments, datasets, activeChunk, activeEmbedding] = await Promise.all([
      listExperiments(documentId, signal),
      listEvaluationDatasets(documentId, signal),
      detail.activeChunkRunId ? getChunkRun(detail.activeChunkRunId, signal) : Promise.resolve(null),
      detail.activeEmbeddingRunId ? getEmbeddingRun(detail.activeEmbeddingRunId, signal) : Promise.resolve(null),
    ]);
    const chunkMatchesLineage = Boolean(activeChunk && activeChunk.documentId === detail.id && activeChunk.parseRunId === detail.activeParseRunId);
    const embeddingMatchesLineage = Boolean(activeEmbedding && chunkMatchesLineage && activeEmbedding.documentId === detail.id && activeEmbedding.chunkRunId === activeChunk?.id);
    const currentExperiments = experiments.map((run) => ({
      ...run,
      isStale: run.chunkRunId !== detail.activeChunkRunId || (run.embeddingRunId !== null && run.embeddingRunId !== detail.activeEmbeddingRunId),
    }));
    const activeParseSummary = detail.activeParseRunId
      ? detail.parseRuns.find((run) => run.id === detail.activeParseRunId) ?? null
      : null;
    const inFlightParseSummary = detail.parseRuns.find((run) => run.status === "queued" || run.status === "running") ?? null;
    const latestParseSummary = detail.parseRuns[0] ?? null;
    const failedReparseSummary = latestParseSummary?.status === "failed" && latestParseSummary.id !== detail.activeParseRunId
      ? latestParseSummary
      : null;
    const visibleParseSummary = inFlightParseSummary ?? failedReparseSummary ?? activeParseSummary;
    const nextParseStatus: DocumentParseStatus = inFlightParseSummary
      ? inFlightParseSummary.status
      : failedReparseSummary
        ? "failed"
        : detail.activeParseRun
          ? "completed"
          : detail.activeParseRunId
            ? "failed"
            : "not-started";
    setActiveDocument(detail);
    activeParseRunIdRef.current = inFlightParseSummary?.id ?? detail.activeParseRunId;
    setParseResult(detail.activeParseRun);
    setParseStatus(nextParseStatus);
    const loadedParseProgress = inFlightParseSummary?.progress
      ?? activeParseSummary?.progress
      ?? (detail.activeParseRun ? 100 : 0);
    setLastReportedParseProgress(loadedParseProgress);
    setParseProgress(loadedParseProgress);
    setParseError(visibleParseSummary?.error
      ? new DocumentApiError(visibleParseSummary.error.code, visibleParseSummary.error.message)
      : null);
    setChunkRun(activeChunk ? { ...activeChunk, isStale: !chunkMatchesLineage } : null);
    setEmbeddingRun(activeEmbedding ? { ...activeEmbedding, isStale: !embeddingMatchesLineage } : null);
    setExperimentHistory(currentExperiments);
    setExperimentRun(currentExperiments.find((run) => !run.isStale) ?? null);
    setEvaluationDatasets(datasets);
    setChunkStatus(!detail.activeParseRunId ? "locked" : !activeChunk ? "ready" : chunkMatchesLineage ? "completed" : "stale");
    setEmbeddingStatus(!activeChunk ? "locked" : !activeEmbedding ? "ready" : embeddingMatchesLineage ? "completed" : "stale");
    setExperimentStatus(embeddingMatchesLineage ? "ready" : "locked");
    setEvaluationStatus(embeddingMatchesLineage && datasets.length > 0 ? "ready" : "locked");
    return { parseStatus: nextParseStatus, parseRunId: inFlightParseSummary?.id ?? null };
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
    const controller = replaceController("parse-resume");
    try {
      const result = await waitForParseRun(
        parseRunId,
        controller.signal,
        documentId,
        (run) => applyParseRunStatus(run, expectedRunId),
      );
      if (runIdRef.current !== expectedRunId || activeParseRunIdRef.current !== parseRunId) return;
      setParseResult(result);
      setParseStatus("completed");
      await loadDocumentRelatedData(documentId, controller.signal);
      if (runIdRef.current !== expectedRunId) return;
      addActivity("parseCompleted");
    } catch (error) {
      if (runIdRef.current !== expectedRunId || (error instanceof DOMException && error.name === "AbortError")) return;
      const apiError = asApiError(error, "The persisted document could not be parsed.");
      setParseError(apiError);
      if (apiError.code !== "parse_poll_timeout") {
        setParseStatus("failed");
        addActivity("parseFailed", apiError.code);
      }
    } finally {
      if (runIdRef.current === expectedRunId) controllersRef.current.delete("parse-resume");
    }
  }, [addActivity, applyParseRunStatus, loadDocumentRelatedData, replaceController]);

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

      const documentId = activeDocument?.id;
      if (documentId && nextDocuments.some((document) => document.id === documentId)) {
        const loaded = await loadDocumentRelatedData(documentId, controller.signal);
        if (!parseInFlightRef.current && (loaded.parseStatus === "queued" || loaded.parseStatus === "running") && loaded.parseRunId) {
          void resumeParseRun(documentId, loaded.parseRunId, runIdRef.current);
        }
      }
      setPersistenceStatus("available");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCapabilities(null);
      setPersistenceError(asApiError(error, "Persistent pipeline data could not be loaded."));
      setPersistenceStatus("unavailable");
    }
  }, [activeDocument, loadDocumentRelatedData, replaceController, resumeParseRun]);

  const selectPersistedDocument = useCallback(async (documentId: string) => {
    const controller = replaceController("document");
    controllersRef.current.get("parse")?.abort();
    controllersRef.current.get("parse-resume")?.abort();
    parseInFlightRef.current = false;
    runIdRef.current += 1;
    setSelectedFile(null);
    setFileError(null);
    setParseResult(null);
    setParseError(null);
    setParseStatus("not-started");
    setLastReportedParseProgress(0);
    setParseProgress(0);
    resetDownstream();
    try {
      const loaded = await loadDocumentRelatedData(documentId, controller.signal);
      rememberActiveDocument(documentId, authUserId);
      setPersistenceStatus("available");
      if ((loaded.parseStatus === "queued" || loaded.parseStatus === "running") && loaded.parseRunId) {
        void resumeParseRun(documentId, loaded.parseRunId, runIdRef.current);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setPersistenceError(asApiError(error, "The selected document could not be loaded."));
      setPersistenceStatus("unavailable");
    }
  }, [authUserId, loadDocumentRelatedData, replaceController, resetDownstream, resumeParseRun]);

  useEffect(() => {
    if (pathname === "/login" || pathname.startsWith("/auth/")) return;
    if (!authUserId && process.env.NODE_ENV !== "test") return;

    const controller = replaceController("bootstrap");
    void Promise.all([getCapabilities(controller.signal), listDocuments(controller.signal)])
      .then(async ([nextCapabilities, nextDocuments]) => {
        setCapabilities(nextCapabilities);
        setDocuments(nextDocuments);
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
          const loaded = await loadDocumentRelatedData(documentId, controller.signal);
          if ((loaded.parseStatus === "queued" || loaded.parseStatus === "running") && loaded.parseRunId) {
            void resumeParseRun(documentId, loaded.parseRunId, runIdRef.current);
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
  }, [authUserId, loadDocumentRelatedData, pathname, replaceController, resumeParseRun]);

  const selectFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const validationError = validatePdfFile(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }
    controllersRef.current.forEach((controller, key) => {
      if (key !== "bootstrap") controller.abort();
    });
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    activeParseRunIdRef.current = null;
    setSelectedFile(file);
    setActiveDocument(null);
    rememberActiveDocument(null, authUserId);
    setFileError(null);
    setParseStatus("ready");
    setLastReportedParseProgress(0);
    setParseProgress(0);
    setParseResult(null);
    setParseError(null);
    setActivity([]);
    resetDownstream();
    addActivity("documentSelected");
  }, [addActivity, authUserId, resetDownstream]);

  const removeFile = useCallback(() => {
    controllersRef.current.forEach((controller, key) => {
      if (key !== "bootstrap") controller.abort();
    });
    runIdRef.current += 1;
    parseInFlightRef.current = false;
    activeParseRunIdRef.current = null;
    setSelectedFile(null);
    setActiveDocument(null);
    rememberActiveDocument(null, authUserId);
    setFileError(null);
    setParseStatus("not-started");
    setLastReportedParseProgress(0);
    setParseProgress(0);
    setParseResult(null);
    setParseError(null);
    setActivity([]);
    resetDownstream();
  }, [authUserId, resetDownstream]);

  const parseSelectedFile = useCallback(async () => {
    if (!selectedFile || parseInFlightRef.current || parseStatus === "queued" || parseStatus === "running") return;
    const currentRunId = runIdRef.current;
    const controller = replaceController("parse");
    parseInFlightRef.current = true;
    activeParseRunIdRef.current = null;
    setParseStatus("queued");
    setLastReportedParseProgress(0);
    setParseProgress(0);
    setParseError(null);
    setChunkRun((run) => staleRun(run));
    setEmbeddingRun((run) => staleRun(run));
    setExperimentRun((run) => staleRun(run));
    setEvaluationRun((run) => staleRun(run));
    addActivity("parseRequested");
    addActivity("parsing");
    try {
      const result = await parseAndPersistDocument(
        selectedFile,
        controller.signal,
        (run) => applyParseRunStatus(run, currentRunId),
      );
      if (runIdRef.current !== currentRunId) return;
      setParseResult(result);
      setParseStatus("completed");
      setLastReportedParseProgress(100);
      setParseProgress(100);
      activeParseRunIdRef.current = result.parseRunId;
      setChunkStatus(result.documentId && result.parseRunId ? "ready" : "locked");
      addActivity("parseCompleted");
      if (result.documentId && result.parseRunId) {
        const document: PersistedDocument = {
          id: result.documentId,
          fileName: result.document.fileName,
          mediaType: result.document.mediaType,
          sizeBytes: result.document.sizeBytes,
          pageCount: result.document.pageCount,
          sha256: null,
          activeParseRunId: result.parseRunId,
          activeChunkRunId: null,
          activeEmbeddingRunId: null,
          createdAt: null,
          updatedAt: null,
        };
        setDocuments((current) => [document, ...current.filter((item) => item.id !== document.id)]);
        setActiveDocument({ ...document, parseRuns: [], chunkRuns: [], embeddingRuns: [], experiments: [], activeParseRun: result });
        rememberActiveDocument(document.id, authUserId);
        setPersistenceStatus("available");
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
        controllersRef.current.delete("parse");
      }
    }
  }, [addActivity, applyParseRunStatus, authUserId, parseStatus, replaceController, selectedFile]);

  const reparseActiveDocument = useCallback(async () => {
    const documentId = activeDocument?.id;
    if (!documentId || parseInFlightRef.current || parseStatus === "queued" || parseStatus === "running") return;
    const currentRunId = runIdRef.current;
    controllersRef.current.forEach((controller, key) => {
      if (key !== "bootstrap") controller.abort();
    });
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
      setParseResult(result);
      activeParseRunIdRef.current = result.parseRunId;
      await loadDocumentRelatedData(documentId, controller.signal);
      if (runIdRef.current !== currentRunId) return;
      setParseStatus("completed");
      setLastReportedParseProgress(100);
      setParseProgress(100);
      setExperimentHistory((current) => current.map((run) => ({ ...run, isStale: true })));
      setEvaluationRun((run) => staleRun(run));
      addActivity("parseCompleted");
      setDocuments((current) => current.map((document) => document.id === documentId ? {
        ...document,
        pageCount: result.document.pageCount,
        activeParseRunId: result.parseRunId,
        activeChunkRunId: null,
        activeEmbeddingRunId: null,
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
        controllersRef.current.delete("reparse");
      }
    }
  }, [activeDocument, addActivity, applyParseRunStatus, loadDocumentRelatedData, parseStatus, replaceController]);

  const runChunking = useCallback(async (strategy: ChunkStrategy, config: ChunkConfig) => {
    const documentId = activeDocument?.id;
    const parseRunId = activeDocument?.activeParseRunId;
    if (!documentId || !parseRunId || chunkStatus === "processing") return;
    const controller = replaceController("chunk");
    setChunkStatus("processing");
    setChunkError(null);
    setEmbeddingRun((run) => staleRun(run));
    setExperimentRun((run) => staleRun(run));
    setEvaluationRun((run) => staleRun(run));
    try {
      const result = await createChunkRun(documentId, strategy, config, parseRunId, controller.signal);
      setChunkRun(result);
      setChunkStatus(result.status === "completed" ? "completed" : result.status === "running" ? "processing" : "error");
      setEmbeddingStatus(result.status === "completed" ? "ready" : "locked");
      setExperimentStatus("locked");
      setEvaluationStatus("locked");
      setActiveDocument((current) => current ? { ...current, activeChunkRunId: result.id, activeEmbeddingRunId: null } : current);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setChunkError(asApiError(error, "Chunking could not be completed."));
      setChunkStatus("error");
    } finally {
      controllersRef.current.delete("chunk");
    }
  }, [activeDocument, chunkStatus, replaceController]);

  const runEmbedding = useCallback(async () => {
    const documentId = activeDocument?.id;
    const chunkRunId = chunkRun?.id ?? activeDocument?.activeChunkRunId;
    if (!documentId || !chunkRunId || embeddingStatus === "processing") return;
    const controller = replaceController("embedding");
    setEmbeddingStatus("processing");
    setEmbeddingError(null);
    setExperimentRun((run) => staleRun(run));
    setEvaluationRun((run) => staleRun(run));
    try {
      const result = await createEmbeddingRun(documentId, chunkRunId, controller.signal);
      setEmbeddingRun(result);
      setEmbeddingStatus(result.status === "completed" ? "completed" : result.status === "running" ? "processing" : "error");
      setExperimentStatus(result.status === "completed" ? "ready" : "locked");
      setEvaluationStatus(result.status === "completed" && evaluationDatasets.length > 0 ? "ready" : "locked");
      setActiveDocument((current) => current ? { ...current, activeEmbeddingRunId: result.id } : current);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setEmbeddingError(asApiError(error, "Embeddings could not be created."));
      setEmbeddingStatus("error");
    } finally {
      controllersRef.current.delete("embedding");
    }
  }, [activeDocument, chunkRun, embeddingStatus, evaluationDatasets.length, replaceController]);

  const runExperiment = useCallback(async (input: Omit<ExperimentRequest, "documentId" | "chunkRunId" | "embeddingRunId">) => {
    const documentId = activeDocument?.id;
    const chunkRunId = chunkRun?.id ?? activeDocument?.activeChunkRunId ?? null;
    const embeddingRunId = embeddingRun?.id ?? activeDocument?.activeEmbeddingRunId ?? null;
    if (!documentId || !chunkRunId || experimentStatus === "processing") return;
    if (input.retrieval.mode !== "keyword" && !embeddingRunId) return;
    const controller = replaceController("experiment");
    setExperimentStatus("processing");
    setExperimentError(null);
    try {
      const result = await createExperiment({ ...input, documentId, chunkRunId, embeddingRunId }, controller.signal);
      setExperimentRun(result);
      setExperimentHistory((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      setExperimentStatus(result.status === "completed" ? "completed" : result.status === "running" ? "processing" : "error");
      setEvaluationStatus(evaluationDatasets.length > 0 ? "ready" : "locked");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setExperimentError(asApiError(error, "The experiment could not be completed."));
      setExperimentStatus("error");
    } finally {
      controllersRef.current.delete("experiment");
    }
  }, [activeDocument, chunkRun, embeddingRun, evaluationDatasets.length, experimentStatus, replaceController]);

  const createDataset = useCallback(async (name: string, cases: EvaluationCase[]) => {
    const documentId = activeDocument?.id;
    const parseRunId = activeDocument?.activeParseRunId;
    if (!documentId || !parseRunId) return;
    const controller = replaceController("evaluation-dataset");
    setEvaluationStatus("processing");
    setEvaluationError(null);
    try {
      const dataset = await createEvaluationDataset({ documentId, parseRunId, name, cases }, controller.signal);
      setEvaluationDatasets((current) => [dataset, ...current.filter((item) => item.id !== dataset.id)]);
      setEvaluationStatus(activeDocument.activeChunkRunId ? "ready" : "locked");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setEvaluationError(asApiError(error, "The evaluation dataset could not be created."));
      setEvaluationStatus("error");
    } finally {
      controllersRef.current.delete("evaluation-dataset");
    }
  }, [activeDocument, replaceController]);

  const runEvaluation = useCallback(async (input: EvaluationRunInput) => {
    const chunkRunId = chunkRun?.id ?? activeDocument?.activeChunkRunId;
    const embeddingRunId = embeddingRun?.id ?? activeDocument?.activeEmbeddingRunId;
    if (!chunkRunId || !embeddingRunId || evaluationStatus === "processing") return;
    const controller = replaceController("evaluation");
    setEvaluationStatus("processing");
    setEvaluationError(null);
    try {
      const result = await createEvaluationRun({ ...input, chunkRunId, embeddingRunId }, controller.signal);
      setEvaluationRun(result);
      setEvaluationHistory((current) => [result, ...current.filter((run) => run.id !== result.id)]);
      setEvaluationStatus(result.status === "completed" ? "completed" : result.status === "running" ? "processing" : "error");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setEvaluationError(asApiError(error, "Evaluation could not be completed."));
      setEvaluationStatus("error");
    } finally {
      controllersRef.current.delete("evaluation");
    }
  }, [activeDocument, chunkRun, embeddingRun, evaluationStatus, replaceController]);

  const refreshEvaluationRuns = useCallback(async (datasetId: string) => {
    const controller = replaceController("evaluation-history");
    try {
      setEvaluationHistory(await listEvaluationRuns(datasetId, controller.signal));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setEvaluationError(asApiError(error, "Evaluation history could not be loaded."));
    } finally {
      controllersRef.current.delete("evaluation-history");
    }
  }, [replaceController]);

  const value = useMemo<DocumentPipelineContextValue>(() => ({
    selectedFile, fileError, parseStatus, parseProgress,
    parseProgressEstimated: parseProgress > lastReportedParseProgress,
    parseResult, parseError, activity,
    persistenceStatus, persistenceError, capabilities, documents, activeDocument,
    chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError,
    experimentStatus, experimentRun, experimentError, experimentHistory,
    evaluationDatasets, evaluationStatus, evaluationRun, evaluationError, evaluationHistory,
    selectFile, selectPersistedDocument, removeFile, parseSelectedFile, reparseActiveDocument, runChunking, runEmbedding,
    runExperiment, createDataset, runEvaluation, refreshPersistence, refreshEvaluationRuns,
  }), [
    activeDocument, activity, capabilities, chunkError, chunkRun, chunkStatus, createDataset, documents,
    embeddingError, embeddingRun, embeddingStatus, evaluationDatasets, evaluationError, evaluationHistory,
    evaluationRun, evaluationStatus, experimentError, experimentHistory, experimentRun, experimentStatus,
    fileError, lastReportedParseProgress, parseError, parseProgress, parseResult, parseSelectedFile, parseStatus, persistenceError, persistenceStatus,
    reparseActiveDocument,
    refreshEvaluationRuns, refreshPersistence, removeFile, runChunking, runEmbedding, runEvaluation, runExperiment,
    selectFile, selectedFile, selectPersistedDocument,
  ]);

  return <DocumentPipelineContext.Provider value={value}>{children}</DocumentPipelineContext.Provider>;
}

export function useDocumentPipeline() {
  const context = useContext(DocumentPipelineContext);
  if (!context) throw new Error("useDocumentPipeline must be used within DocumentPipelineProvider");
  return context;
}
