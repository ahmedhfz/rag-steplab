"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

import { parseDocument, DocumentApiError, type DocumentApiErrorCode } from "@/lib/document-api";
import { validatePdfFile, type DocumentFileValidationError } from "@/lib/document-file";
import type { DocumentParseResponse } from "@/lib/document-parse-types";
import type { DocumentActivityEventType } from "@/lib/rag-ui-types";

export type DocumentParseStatus = "not-started" | "ready" | "processing" | "completed" | "error";

export type DocumentActivityEvent = {
  id: number;
  type: DocumentActivityEventType;
  errorCode?: DocumentApiErrorCode;
};

type DocumentPipelineContextValue = {
  selectedFile: File | null;
  fileError: DocumentFileValidationError | null;
  parseStatus: DocumentParseStatus;
  parseResult: DocumentParseResponse | null;
  parseError: DocumentApiError | null;
  activity: DocumentActivityEvent[];
  selectFile: (file: File | undefined) => void;
  removeFile: () => void;
  parseSelectedFile: () => Promise<void>;
};

const DocumentPipelineContext = createContext<DocumentPipelineContextValue | null>(null);

export function DocumentPipelineProvider({ children }: { children: React.ReactNode }) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<DocumentFileValidationError | null>(null);
  const [parseStatus, setParseStatus] = useState<DocumentParseStatus>("not-started");
  const [parseResult, setParseResult] = useState<DocumentParseResponse | null>(null);
  const [parseError, setParseError] = useState<DocumentApiError | null>(null);
  const [activity, setActivity] = useState<DocumentActivityEvent[]>([]);
  const runIdRef = useRef(0);
  const activityIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addActivity = useCallback((type: DocumentActivityEventType, errorCode?: DocumentApiErrorCode) => {
    const id = ++activityIdRef.current;
    setActivity((current) => [...current, { id, type, errorCode }]);
  }, []);

  const selectFile = useCallback((file: File | undefined) => {
    if (!file) return;

    const validationError = validatePdfFile(file);
    if (validationError) {
      setFileError(validationError);
      return;
    }

    abortControllerRef.current?.abort();
    runIdRef.current += 1;
    setSelectedFile(file);
    setFileError(null);
    setParseStatus("ready");
    setParseResult(null);
    setParseError(null);
    setActivity([]);
    addActivity("documentSelected");
  }, [addActivity]);

  const removeFile = useCallback(() => {
    abortControllerRef.current?.abort();
    runIdRef.current += 1;
    setSelectedFile(null);
    setFileError(null);
    setParseStatus("not-started");
    setParseResult(null);
    setParseError(null);
    setActivity([]);
  }, []);

  const parseSelectedFile = useCallback(async () => {
    if (!selectedFile || parseStatus === "processing") return;

    const currentRunId = runIdRef.current;
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    setParseStatus("processing");
    setParseError(null);
    addActivity("parseRequested");
    addActivity("parsing");

    try {
      const result = await parseDocument(selectedFile, controller.signal);
      if (runIdRef.current !== currentRunId) return;

      setParseResult(result);
      setParseStatus("completed");
      addActivity("parseCompleted");
    } catch (error) {
      if (runIdRef.current !== currentRunId || (error instanceof DOMException && error.name === "AbortError")) return;

      const apiError = error instanceof DocumentApiError
        ? error
        : new DocumentApiError("unknown", "The document could not be parsed.");
      setParseError(apiError);
      setParseStatus("error");
      addActivity("parseFailed", apiError.code);
    } finally {
      if (runIdRef.current === currentRunId) abortControllerRef.current = null;
    }
  }, [addActivity, parseStatus, selectedFile]);

  return (
    <DocumentPipelineContext.Provider value={{
      selectedFile,
      fileError,
      parseStatus,
      parseResult,
      parseError,
      activity,
      selectFile,
      removeFile,
      parseSelectedFile,
    }}>
      {children}
    </DocumentPipelineContext.Provider>
  );
}

export function useDocumentPipeline() {
  const context = useContext(DocumentPipelineContext);
  if (!context) throw new Error("useDocumentPipeline must be used within DocumentPipelineProvider");
  return context;
}
