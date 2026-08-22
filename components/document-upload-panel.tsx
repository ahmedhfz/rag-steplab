"use client";

import { useRef, useState } from "react";
import { CloudUpload, FileText, X } from "lucide-react";
import { motion } from "motion/react";

import { useDocumentPipeline, type DocumentParseStatus } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type AppCopy, UI_COPY } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import { cn } from "@/lib/utils";

function parseStatusLabel(status: DocumentParseStatus, copy: AppCopy) {
  if (status === "queued") return copy.overview.parseQueued;
  if (status === "running") return copy.overview.parseRunning;
  if (status === "completed") return copy.overview.parseCompleted;
  if (status === "failed") return copy.overview.parseFailed;
  if (status === "ready") return copy.overview.parseReady;
  return copy.overview.noDocumentSelected;
}

function parseDisabledReason(status: DocumentParseStatus, hasPendingUpload: boolean, hasActiveDocument: boolean, hasVisibleDocument: boolean, locale: "en" | "tr") {
  if (status === "queued" || status === "running") return locale === "tr" ? "Ayrıştırma devam ediyor." : "Parsing is already running.";
  if (hasPendingUpload) return locale === "tr" ? "Seçili PDF gerçek parser'a gönderilmeye hazır." : "The selected PDF is ready for the real parser.";
  if (hasActiveDocument) return locale === "tr" ? "Saklanan kaynak PDF'i yeniden ayrıştırabilirsiniz." : "Reparse the stored source PDF when you need a fresh parse.";
  if (hasVisibleDocument) return locale === "tr" ? "Doküman özeti yükleniyor." : "The document summary is loading.";
  return locale === "tr" ? "Önce bir PDF seçin veya kalıcı bir doküman açın." : "Select a PDF or open a persisted document first.";
}

export function DocumentUploadPanel() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseButtonRef = useRef<HTMLButtonElement>(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const {
    pendingUpload,
    fileError,
    parseStatus,
    parseError,
    activeDocumentMetadata,
    activeDocument,
    selectFile,
    removeFile,
    parseSelectedFile,
    reparseActiveDocument,
  } = useDocumentPipeline();
  const hasPendingUpload = Boolean(pendingUpload);
  const visibleDocument = activeDocument ?? activeDocumentMetadata;
  const hasVisibleDocument = Boolean(visibleDocument);
  const hasActiveDocument = Boolean(activeDocument);
  const isProcessing = parseStatus === "queued" || parseStatus === "running";
  const canParse = (hasPendingUpload || hasActiveDocument) && !isProcessing;

  function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function clearFile() {
    removeFile();
    chooseButtonRef.current?.focus();
  }

  return (
    <section className="border-t px-4 py-6 sm:px-7" data-testid="document-upload-panel">
      <div className="flex items-start gap-3"><FileText aria-hidden="true" className="mt-0.5 size-5 text-slate-500" /><div><h2 className="text-sm font-semibold">{copy.overview.uploadDocument}</h2><p className="mt-1 text-xs leading-5 text-slate-500">{copy.overview.fileRequirements}</p></div></div>
      <motion.div
        animate={{ opacity: 1, scale: isDragging ? 1.01 : 1 }}
        aria-describedby={fileError ? "documents-file-requirements documents-file-error" : "documents-file-requirements"}
        aria-label={copy.overview.uploadDocument}
        className={cn("mt-5 flex min-h-36 flex-col items-center justify-center rounded-md border border-dashed bg-white px-5 text-center transition-[background-color,border-color,box-shadow] duration-150", isDragging && "border-slate-950 bg-slate-50")}
        data-state={isDragging ? "drag-active" : "idle"}
        onDragEnter={(event) => { event.preventDefault(); dragDepthRef.current += 1; setIsDragging(true); }}
        onDragLeave={(event) => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (dragDepthRef.current === 0) setIsDragging(false); }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); dragDepthRef.current = 0; setIsDragging(false); selectFile(event.dataTransfer.files[0]); }}
        role="group"
        transition={{ duration: 0.14, ease: "easeOut" }}
      >
        <CloudUpload aria-hidden="true" className="size-7 stroke-[1.5] text-slate-600" />
        <p className="mt-2 text-sm text-slate-600">{copy.overview.dropPdf}</p>
        <input accept="application/pdf,.pdf" aria-describedby={fileError ? "documents-file-requirements documents-file-error" : "documents-file-requirements"} aria-invalid={fileError ? true : undefined} aria-label={copy.overview.choosePdf} className="sr-only" onChange={chooseFile} ref={fileInputRef} type="file" />
        <Button className="mt-3" onClick={() => fileInputRef.current?.click()} ref={chooseButtonRef} variant="outline">{copy.overview.choosePdf}</Button>
      </motion.div>
      <p className="mt-2 text-xs text-slate-500" id="documents-file-requirements">{copy.overview.fileRequirements}&nbsp;•&nbsp;{copy.overview.noFileSent}</p>
      {fileError ? <p className="mt-2 text-xs text-red-700" id="documents-file-error" role="alert">{fileError === "invalidPdf" ? copy.overview.invalidPdf : copy.overview.fileTooLarge}</p> : null}

      <div aria-live="polite" className="mt-5 overflow-x-auto border-y">
        {pendingUpload ? (
          <Table>
            <TableHeader><TableRow><TableHead>{copy.overview.fileName}</TableHead><TableHead>{copy.overview.size}</TableHead><TableHead>{copy.overview.status}</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody><TableRow><TableCell className="min-w-48 font-medium">{pendingUpload.name}</TableCell><TableCell>{formatDocumentFileSize(pendingUpload.size, preferences.locale)}</TableCell><TableCell className="text-xs text-slate-600">{parseStatusLabel(parseStatus, copy)}</TableCell><TableCell><Button aria-label={copy.overview.removeSelected} onClick={clearFile} size="icon-sm" variant="ghost"><X aria-hidden="true" className="size-4" /></Button></TableCell></TableRow></TableBody>
          </Table>
        ) : visibleDocument ? (
          <div className="flex items-center gap-3 px-4 py-4"><FileText aria-hidden="true" className="size-5 text-slate-500" /><div className="min-w-0"><p className="truncate text-sm font-medium">{visibleDocument.fileName}</p><p className="mt-1 text-xs text-slate-500">{formatDocumentFileSize(visibleDocument.sizeBytes, preferences.locale)} · {parseStatusLabel(parseStatus, copy)}</p></div></div>
        ) : <p className="px-4 py-5 text-sm text-slate-500">{copy.overview.noDocumentSelected}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div><p className="text-sm font-medium">{copy.overview.parse}</p><p className="mt-1 text-xs text-slate-500">{copy.overview.backendActionNotConnected}</p></div>
        <Button aria-describedby={!canParse ? "documents-parse-disabled-reason" : undefined} aria-busy={isProcessing} disabled={!canParse} onClick={() => void (hasPendingUpload ? parseSelectedFile() : reparseActiveDocument())}>{hasPendingUpload || !hasActiveDocument ? copy.overview.parseDocument : copy.overview.reparseDocument}</Button>
      </div>
      <p className="pt-3 text-xs text-slate-500" id="documents-parse-disabled-reason">{parseDisabledReason(parseStatus, hasPendingUpload, hasActiveDocument, hasVisibleDocument, preferences.locale)}</p>
      {parseError ? <p className="mt-2 text-xs text-red-700" role="alert">{parseError.message}</p> : null}
    </section>
  );
}
