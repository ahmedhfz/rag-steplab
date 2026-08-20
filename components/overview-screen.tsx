"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertCircle,
  ArrowRight,
  ArrowUpDown,
  BarChart3,
  Blocks,
  Braces,
  CheckCircle2,
  CircleEllipsis,
  CloudUpload,
  Database,
  FileCheck2,
  FileText,
  Grid2X2,
  LoaderCircle,
  ListFilter,
  Search,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";

import { StatusIndicator } from "@/components/status-indicator";
import { useDocumentPipeline, type DocumentParseStatus, type DocumentActivityEvent, type PipelineOperationStatus } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type AppCopy, UI_COPY } from "@/lib/copy";
import type { DocumentApiErrorCode } from "@/lib/document-api";
import {
  formatDocumentFileSize,
} from "@/lib/document-file";
import type { PipelineStepDefinition, PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";
import { cn } from "@/lib/utils";

const pipelineSteps: PipelineStepDefinition[] = [
  { key: "document", icon: "document" },
  { key: "parse", icon: "parse" },
  { key: "chunk", icon: "chunk" },
  { key: "embed", icon: "embed" },
  { key: "index", icon: "index" },
  { key: "retrieve", icon: "retrieve" },
  { key: "rerank", icon: "rerank" },
  { key: "context", icon: "context" },
  { key: "generate", icon: "generate" },
  { key: "evaluate", icon: "evaluate" },
];

const pipelineIcons: Record<PipelineStepKey, LucideIcon> = {
  document: FileText,
  parse: ListFilter,
  chunk: Grid2X2,
  embed: Braces,
  index: Database,
  retrieve: Search,
  rerank: ArrowUpDown,
  context: Blocks,
  generate: CircleEllipsis,
  evaluate: BarChart3,
};

const activityIcons: Record<DocumentActivityEvent["type"], LucideIcon> = {
  documentSelected: FileCheck2,
  parseRequested: Send,
  parsing: LoaderCircle,
  parseCompleted: CheckCircle2,
  parseFailed: AlertCircle,
};

function operationState(status: PipelineOperationStatus): PipelineStepState {
  if (status === "ready") return "Ready";
  if (status === "processing") return "Processing";
  if (status === "completed") return "Completed";
  if (status === "error") return "Error";
  if (status === "stale") return "Stale";
  return "Locked";
}

function getPipelineState(
  hasDocument: boolean,
  parseStatus: DocumentParseStatus,
  chunkStatus: PipelineOperationStatus,
  embeddingStatus: PipelineOperationStatus,
  experimentStatus: PipelineOperationStatus,
  evaluationStatus: PipelineOperationStatus,
  stageResults: { reranking: unknown; context: unknown; generation: unknown } | null,
): Record<PipelineStepKey, PipelineStepState> {
  const parseState: PipelineStepState = !hasDocument
    ? "Locked"
    : parseStatus === "ready" ? "Ready"
      : parseStatus === "queued" || parseStatus === "running" ? "Processing"
        : parseStatus === "completed" ? "Completed"
          : parseStatus === "failed" ? "Error"
            : "Locked";

  return {
    document: hasDocument ? "Completed" : "Not started",
    parse: parseState,
    chunk: operationState(chunkStatus),
    embed: operationState(embeddingStatus),
    index: embeddingStatus === "completed" ? "Completed" : operationState(embeddingStatus),
    retrieve: operationState(experimentStatus),
    rerank: stageResults?.reranking ? "Completed" : experimentStatus === "processing" ? "Processing" : "Locked",
    context: stageResults?.context ? "Completed" : experimentStatus === "processing" ? "Processing" : "Locked",
    generate: stageResults?.generation ? "Completed" : experimentStatus === "processing" ? "Processing" : "Locked",
    evaluate: operationState(evaluationStatus),
  };
}

function getPipelineStatus(hasFile: boolean, parseStatus: DocumentParseStatus): PipelineStepState {
  if (!hasFile) return "Not started";
  if (parseStatus === "queued" || parseStatus === "running") return "Processing";
  if (parseStatus === "completed") return "Completed";
  if (parseStatus === "failed") return "Error";
  return "Ready";
}

function getParseErrorMessage(copy: AppCopy, code: DocumentApiErrorCode | undefined) {
  if (code === "empty_file") return copy.overview.emptyFile;
  if (code === "invalid_file_type") return copy.overview.invalidPdf;
  if (code === "file_too_large") return copy.overview.fileTooLarge;
  if (code === "backend_unavailable") return copy.overview.backendUnavailable;
  if (code === "invalid_response") return copy.overview.invalidResponse;
  if (code === "docling_error") return copy.overview.doclingError;
  if (code === "parse_interrupted") return copy.overview.parseInterrupted;
  if (code === "parse_poll_timeout") return copy.overview.parsePollTimeout;
  return copy.overview.unknownParseError;
}

function getParseReason(copy: AppCopy, hasFile: boolean, hasPersistedDocument: boolean, parseStatus: DocumentParseStatus) {
  if (parseStatus === "queued") return copy.overview.parseReasonQueued;
  if (parseStatus === "running") return copy.overview.parseReasonRunning;
  if (parseStatus === "failed") return copy.overview.parseReasonError;
  if (hasFile && parseStatus === "completed") return copy.overview.parseReasonCompleted;
  if (hasPersistedDocument) return copy.overview.parseReasonPersisted;
  if (!hasFile) return copy.overview.parseReasonEmpty;
  return copy.overview.parseReasonReady;
}

function getPipelineStatusMessage(copy: AppCopy, hasFile: boolean, parseStatus: DocumentParseStatus) {
  if (!hasFile) return copy.overview.noPipelineRun;
  if (parseStatus === "queued") return copy.overview.parseQueued;
  if (parseStatus === "running") return copy.overview.parseRunning;
  if (parseStatus === "completed") return copy.overview.parseCompleted;
  if (parseStatus === "failed") return copy.overview.parseFailed;
  return copy.overview.parseReady;
}

function ActivityItem({
  event,
  copy,
  parseErrorCode,
  index,
  total,
}: {
  event: DocumentActivityEvent;
  copy: AppCopy;
  parseErrorCode?: DocumentApiErrorCode;
  index: number;
  total: number;
}) {
  const Icon = activityIcons[event.type];
  const isProcessing = event.type === "parsing";
  const isCompleted = event.type === "parseCompleted";
  const isFailed = event.type === "parseFailed";

  return (
    <motion.li
      animate={{ opacity: 1, x: 0 }}
      className={cn(
        "relative flex items-start gap-3 border-b px-4 py-3 last:border-b-0 transition-colors",
        isProcessing && "bg-amber-50/60",
        isCompleted && "bg-emerald-50/65",
        isFailed && "bg-red-50/60",
      )}
      data-activity-status={isProcessing ? "processing" : isCompleted ? "completed" : isFailed ? "error" : "done"}
      data-activity-type={event.type}
      exit={{ opacity: 0, x: 8 }}
      initial={{ opacity: 0, x: 8 }}
      layout
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <div className="relative flex w-5 shrink-0 justify-center">
        {index < total - 1 && <span aria-hidden="true" className="absolute top-5 -bottom-3 w-px bg-slate-200" />}
        <motion.span
          animate={{ opacity: 1, scale: 1 }}
          className={cn(
            "relative z-10 grid size-5 place-items-center rounded-full border bg-white",
            isProcessing && "border-amber-300 text-amber-700",
            isCompleted && "border-emerald-300 bg-emerald-100 text-emerald-700",
            isFailed && "border-red-300 bg-red-100 text-red-700",
            !isProcessing && !isCompleted && !isFailed && "border-slate-200 text-slate-500",
          )}
          initial={{ opacity: 0, scale: 0.7 }}
          transition={isCompleted ? { type: "spring", stiffness: 480, damping: 22 } : { duration: 0.16, ease: "easeOut" }}
        >
          {isProcessing ? (
            <motion.span
              animate={{ opacity: [0.6, 1, 0.6], rotate: [0, 360], scale: [0.9, 1.08, 0.9] }}
              transition={{ duration: 1.1, ease: "linear", repeat: Infinity }}
            >
              <Icon aria-hidden="true" className="size-3.5" />
            </motion.span>
          ) : (
            <Icon aria-hidden="true" className={cn("size-3.5", isProcessing && "animate-spin")} />
          )}
        </motion.span>
      </div>
      <div className="min-w-0 pt-0.5">
        <div className={cn("text-sm font-medium", isCompleted && "text-emerald-800", isFailed && "text-red-800")}>{copy.overview.activityEvents[event.type]}</div>
        {event.type === "parseFailed" && <div className="mt-1 text-xs text-red-700">{getParseErrorMessage(copy, event.errorCode ?? parseErrorCode)}</div>}
      </div>
    </motion.li>
  );
}

export function OverviewScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const choosePdfButtonRef = useRef<HTMLButtonElement>(null);
  const dragDepthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const {
    selectedFile,
    fileError,
    parseStatus,
    parseResult,
    parseError,
    activity,
    selectFile,
    removeFile: clearSelectedFile,
    parseSelectedFile,
    reparseActiveDocument,
    activeDocument,
    chunkStatus,
    embeddingStatus,
    experimentStatus,
    experimentRun,
    evaluationStatus,
  } = useDocumentPipeline();
  const hasDocument = Boolean(selectedFile || activeDocument);
  const pipelineState = getPipelineState(
    hasDocument,
    parseStatus,
    chunkStatus,
    embeddingStatus,
    experimentStatus,
    evaluationStatus,
    experimentRun?.stageResults ?? null,
  );
  const pipelineStatus = getPipelineStatus(hasDocument, parseStatus);

  function handleFileInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function removeFile() {
    clearSelectedFile();
    choosePdfButtonRef.current?.focus();
  }

  return (
    <div>
      <section className="px-4 py-7 sm:px-8 sm:py-9">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{copy.overview.title}</h1>

        <div className="mt-7 grid gap-7 xl:grid-cols-[minmax(0,1fr)_220px]">
          <div className="technical-scrollbar overflow-x-auto pb-3">
            <div className="flex min-w-[1180px] items-start">
              {pipelineSteps.map((step, index) => {
                const Icon = pipelineIcons[step.icon];
                const state = pipelineState[step.key];

                return (
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-1 items-center"
                    initial={{ opacity: 0, y: 5 }}
                    key={step.key}
                    transition={{ duration: 0.18, delay: index * 0.025, ease: "easeOut" }}
                  >
                    <div className="flex min-w-[96px] flex-col items-center text-center">
                      <span className="grid size-8 place-items-center rounded-full border bg-white text-xs font-semibold">{index + 1}</span>
                      <Icon aria-hidden="true" className="mt-5 size-8 stroke-[1.5] text-slate-700" />
                      <span className="mt-3 text-sm font-medium">{copy.overview.steps[step.key]}</span>
                      <span className="mt-4"><StatusIndicator state={state} /></span>
                    </div>
                    {index < pipelineSteps.length - 1 && <ArrowRight aria-hidden="true" className="mx-1 mt-[68px] size-4 shrink-0 text-slate-400" />}
                  </motion.div>
                );
              })}
            </div>
          </div>

          <aside className="border-t pt-5 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0">
            <h2 className="text-sm font-semibold">{copy.overview.pipelineStatus}</h2>
            <div className="mt-5"><StatusIndicator state={pipelineStatus} /></div>
            <p className="mt-2 text-xs text-slate-500">{getPipelineStatusMessage(copy, hasDocument, parseStatus)}</p>
            {preferences.showLearningHints && (
              <>
                <Separator className="my-5" />
                <p className="text-xs leading-5 text-slate-500"><span className="font-medium text-slate-700">{copy.common.learningHint}:</span> {copy.overview.pipelineHint[preferences.detailLevel]}</p>
              </>
            )}
          </aside>
        </div>
      </section>

      <section className="grid min-w-0 border-t lg:grid-cols-[minmax(320px,40%)_minmax(0,60%)]">
        <div className="min-w-0 p-4 sm:p-8 lg:border-r">
          <h2 className="text-sm font-semibold">{copy.overview.uploadDocument}</h2>
          <motion.div
            animate={{ opacity: 1, scale: isDragging ? 1.01 : 1 }}
            className={cn(
              "mt-5 flex min-h-44 flex-col items-center justify-center rounded-md border border-dashed bg-white px-5 text-center transition-[background-color,border-color,box-shadow] duration-150",
              isDragging && "border-slate-950 bg-slate-50",
            )}
            aria-describedby={fileError ? "file-requirements file-selection-error" : "file-requirements"}
            aria-label={copy.overview.uploadDocument}
            data-invalid={fileError ? "true" : undefined}
            data-state={isDragging ? "drag-active" : "idle"}
            onDragEnter={(event) => {
              event.preventDefault();
              dragDepthRef.current += 1;
              setIsDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
              if (dragDepthRef.current === 0) setIsDragging(false);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragEnd={() => {
              dragDepthRef.current = 0;
              setIsDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dragDepthRef.current = 0;
              setIsDragging(false);
              selectFile(event.dataTransfer.files[0]);
            }}
            transition={{ duration: 0.14, ease: "easeOut" }}
            role="group"
          >
            <CloudUpload aria-hidden="true" className="size-8 stroke-[1.5] text-slate-600" />
            <p className="mt-3 text-sm text-slate-600">{copy.overview.dropPdf}</p>
            <input
              accept="application/pdf,.pdf"
              aria-describedby={fileError ? "file-requirements file-selection-error" : "file-requirements"}
              aria-invalid={fileError ? true : undefined}
              aria-label={copy.overview.choosePdf}
              className="sr-only"
              onChange={handleFileInputChange}
              ref={fileInputRef}
              type="file"
            />
            <Button className="mt-4" onClick={() => fileInputRef.current?.click()} ref={choosePdfButtonRef} variant="outline">{copy.overview.choosePdf}</Button>
          </motion.div>
          <p className="mt-3 text-xs text-slate-500" id="file-requirements">{copy.overview.fileRequirements}&nbsp;&nbsp;•&nbsp;&nbsp;{copy.overview.noFileSent}</p>
          <AnimatePresence initial={false} mode="wait">
            {fileError && (
              <motion.p
                animate={{ opacity: 1, y: 0 }}
                className="mt-2 text-xs text-red-700"
                exit={{ opacity: 0, y: -2 }}
                id="file-selection-error"
                initial={{ opacity: 0, y: -2 }}
                role="alert"
                transition={{ duration: 0.14, ease: "easeOut" }}
              >
                {copy.overview[fileError]}
              </motion.p>
            )}
          </AnimatePresence>

          <h3 className="mt-8 text-sm font-semibold">{copy.overview.selectedDocument}</h3>
          <div aria-live="polite" className="mt-3 min-h-16">
            <AnimatePresence initial={false} mode="wait">
              {selectedFile ? (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="overflow-x-auto border-y"
                  exit={{ opacity: 0, y: -3 }}
                  initial={{ opacity: 0, y: 4 }}
                  key="selected-document"
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{copy.overview.fileName}</TableHead>
                        <TableHead>{copy.overview.size}</TableHead>
                        <TableHead>{copy.overview.status}</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="min-w-48 font-medium"><span className="mr-2 rounded border px-1 py-0.5 text-[10px] font-bold text-red-600">PDF</span>{selectedFile.name}</TableCell>
                        <TableCell>{formatDocumentFileSize(selectedFile.size, preferences.locale)}</TableCell>
                        <TableCell className="text-xs text-slate-600">
                          {parseStatus === "queued" ? copy.overview.parseQueued : parseStatus === "running" ? copy.overview.parseRunning : parseStatus === "completed" ? copy.overview.parseCompleted : parseStatus === "failed" ? copy.overview.parseFailed : copy.overview.documentSelected}
                        </TableCell>
                        <TableCell><Button aria-label={copy.overview.removeSelected} onClick={removeFile} size="icon-sm" variant="ghost"><X aria-hidden="true" className="size-4" /></Button></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </motion.div>
              ) : (
                <motion.div
                  animate={{ opacity: 1, y: 0 }}
                  className="border-y px-4 py-6 text-sm text-slate-500"
                  exit={{ opacity: 0, y: -3 }}
                  initial={{ opacity: 0, y: 4 }}
                  key="empty-document"
                  transition={{ duration: 0.16, ease: "easeOut" }}
                >
                  {copy.overview.noDocumentSelected}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
            <div>
              <div className="text-sm font-medium">{copy.overview.parse}</div>
              <div className="mt-1 text-xs text-slate-500">{copy.overview.backendActionNotConnected}</div>
            </div>
            <Button
              aria-describedby="parse-disabled-reason"
              aria-busy={parseStatus === "queued" || parseStatus === "running"}
              disabled={(!selectedFile && !activeDocument) || parseStatus === "queued" || parseStatus === "running"}
              onClick={() => void (selectedFile ? parseSelectedFile() : reparseActiveDocument())}
            >
              {selectedFile ? copy.overview.parseDocument : copy.overview.reparseDocument}
            </Button>
          </div>
          <p className="border-b py-3 text-xs text-slate-500" id="parse-disabled-reason">
            {getParseReason(copy, Boolean(selectedFile), Boolean(activeDocument), parseStatus)}
          </p>
          {parseError && (
            <p className="border-b px-1 py-3 text-xs text-red-700" role="alert">
              {getParseErrorMessage(copy, parseError.code)}
            </p>
          )}

          <div className="border-b py-5">
            <div className="flex items-center justify-between gap-4">
                <h3 className="text-sm font-semibold">{copy.overview.parseSummary}</h3>
                <Button asChild size="sm" variant="outline">
                  <Link href="/documents/parsed">{copy.overview.openParsedContent} <FileText className="size-4" /></Link>
                </Button>
              </div>
            {parseResult ? (
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {[
                  [copy.documents.summaryFields.pageCount, parseResult.summary.pageCount],
                  [copy.documents.summaryFields.headingCount, parseResult.summary.headingCount],
                  [copy.documents.summaryFields.paragraphCount, parseResult.summary.paragraphCount],
                  [copy.documents.summaryFields.listCount, parseResult.summary.listCount],
                  [copy.documents.summaryFields.tableCount, parseResult.summary.tableCount],
                ].map(([label, value]) => (
                  <div className="border px-3 py-2" key={label}>
                    <dt className="text-[11px] text-slate-500">{label}</dt>
                    <dd className="mt-1 text-lg font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-slate-500">{copy.overview.noParseSummary}</p>
            )}
          </div>
        </div>

        <div className="min-w-0 p-4 sm:p-8">
          <h2 className="text-sm font-semibold">{copy.overview.activity}</h2>
          <div aria-live="polite" className="mt-4 overflow-hidden border-t" data-state={parseStatus === "failed" ? "error" : parseStatus} data-testid="activity-timeline">
            {activity.length === 0 ? (
              <div className="flex min-h-28 items-center justify-center px-4 text-center text-sm text-slate-500">
                {copy.overview.noActivity}
              </div>
            ) : (
              <ol>
                <AnimatePresence initial={false}>
                  {activity.map((event, index) => (
                    <ActivityItem
                      copy={copy}
                      event={event}
                      index={index}
                      key={event.id}
                      parseErrorCode={parseError?.code}
                      total={activity.length}
                    />
                  ))}
                </AnimatePresence>
              </ol>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
