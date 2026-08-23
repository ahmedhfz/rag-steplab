"use client";

import { RefreshCw } from "lucide-react";

import { ParsedContentTab } from "@/components/documents-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { UI_COPY } from "@/lib/copy";

export function ParseScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const { activeDocument, parseResult, parseStatus, parseError, persistenceStatus, selectedParseRunId, selectParseRun, parseActiveDocument } = useDocumentPipeline();
  const labels = preferences.locale === "tr"
    ? { title: "Parse", description: "Seçili dokümanın parse çıktısını ve sürüm tarihçesini inceleyin.", parse: "Parse", reparse: "Reparse", history: "Parse sürüm tarihçesi", selected: "Seçili", active: "Varsayılan", compatible: "Uyumlu", failed: "Başarısız", running: "Çalışıyor", incompatible: "Uyumsuz", noDocument: "Önce Documents ekranından bir doküman seçin.", noRun: "Henüz parse run yok.", reason: "Kalıcı doküman seçmeden parse başlatılamaz." }
    : { title: "Parse", description: "Inspect parsed output and version history for the selected document.", parse: "Parse", reparse: "Reparse", history: "Parse version history", selected: "Selected", active: "Default", compatible: "Compatible", failed: "Failed", running: "Running", incompatible: "Incompatible", noDocument: "Select a document from Documents first.", noRun: "No parse runs exist yet.", reason: "Select a persisted document before parsing." };
  const isProcessing = parseStatus === "queued" || parseStatus === "running";
  const canParse = Boolean(activeDocument?.id && persistenceStatus === "available" && !isProcessing);
  const actionLabel = activeDocument?.activeParseRunId ? labels.reparse : labels.parse;

  function statusLabel(run: typeof activeDocument extends null ? never : NonNullable<typeof activeDocument>["parseRuns"][number]) {
    if (run.status === "queued" || run.status === "running") return labels.running;
    if (run.status !== "completed") return labels.failed;
    return run.isCompatible ? labels.compatible : labels.incompatible;
  }

  return (
    <div>
      <PipelineContextBar />
      <header className="border-b px-4 py-6 sm:px-7"><h1 className="text-[22px] font-semibold tracking-[-0.025em]">{labels.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{labels.description}</p></header>
      <section className="border-b px-4 py-5 sm:px-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">{actionLabel}</p><p className="mt-1 text-xs text-slate-500">{activeDocument?.fileName ?? labels.noDocument}</p></div><Button aria-busy={isProcessing} disabled={!canParse} onClick={() => void parseActiveDocument()}><RefreshCw aria-hidden="true" className="size-4" />{isProcessing ? labels.running : actionLabel}</Button></div>{!canParse ? <DisabledReason id="parse-action-disabled-reason">{labels.reason}</DisabledReason> : null}{parseError ? <p className="mt-2 text-xs text-red-700" role="alert">{parseError.message}</p> : null}</section>
      <section className="border-b px-4 py-6 sm:px-7"><h2 className="text-sm font-semibold">{labels.history}</h2>{activeDocument?.parseRuns.length ? <div className="mt-4 space-y-2">{activeDocument.parseRuns.map((run) => <div className="flex flex-col gap-3 border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="parse-history-row" key={run.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="truncate font-mono font-medium" title={run.id}>P{activeDocument.parseRuns.findIndex((candidate) => candidate.id === run.id) + 1}</span>{run.id === selectedParseRunId ? <span className="rounded border px-1.5 py-0.5 text-[10px]">{labels.selected}</span> : null}{run.id === activeDocument.activeParseRunId ? <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{labels.active}</span> : null}{run.historicalLineage ? <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{preferences.locale === "tr" ? "Geçmiş" : "Historical"}</span> : null}</div><p className="mt-1 text-xs text-slate-500">{statusLabel(run)}{run.error?.message ? ` · ${run.error.message}` : ""}</p>{!run.isCompatible && run.compatibilityReason ? <p className="mt-1 text-xs text-orange-700">{run.compatibilityReason}</p> : null}</div><Button disabled={run.status !== "completed" || !run.isCompatible || run.id === selectedParseRunId} onClick={() => void selectParseRun(run.id)} size="sm" variant="outline">{run.id === selectedParseRunId ? labels.selected : preferences.locale === "tr" ? "Seç" : "Select"}</Button></div>)}</div> : <EmptyPipelineState>{labels.noRun}</EmptyPipelineState>}</section>
      <ParsedContentTab copy={copy.documents} result={parseResult} />
    </div>
  );
}
