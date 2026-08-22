"use client";

import Link from "next/link";
import { ArrowRight, RefreshCw } from "lucide-react";

import { DocumentOverviewTab, ParsedContentTab, ParseRunSelector } from "@/components/documents-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import { UI_COPY } from "@/lib/copy";

export function ParseScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const {
    activeDocument,
    pendingUpload,
    parseResult,
    parseStatus,
    parseError,
    persistenceStatus,
    selectedParseRunId,
    selectParseRun,
    reparseActiveDocument,
  } = useDocumentPipeline();
  const labels = preferences.locale === "tr"
    ? { title: "Parse", description: "Ayrıştırma çıktısını ve aynı dokümanın parse sürümlerini inceleyin.", reparse: "Yeniden ayrıştır", history: "Parse version history", selected: "Seçili", active: "Varsayılan", compatible: "Uyumlu", failed: "Başarısız", running: "Çalışıyor", incompatible: "Uyumsuz", next: "Chunking aşamasına git", nextReason: "Chunking için tamamlanmış uyumlu bir parse run seçin.", noDocument: "Parse incelemek için kalıcı bir doküman seçin.", noRun: "Henüz parse run yok.", reason: "Kalıcı doküman seçmeden reparse başlatılamaz." }
    : { title: "Parse", description: "Inspect parsed output and parse versions for the selected document.", reparse: "Reparse", history: "Parse version history", selected: "Selected", active: "Default", compatible: "Compatible", failed: "Failed", running: "Running", incompatible: "Incompatible", next: "Go to Chunking", nextReason: "Select a compatible completed parse run before chunking.", noDocument: "Select a persisted document to inspect parsing.", noRun: "No parse runs exist yet.", reason: "A persisted document is required before reparsing." };
  const isProcessing = parseStatus === "queued" || parseStatus === "running";
  const canReparse = Boolean(activeDocument?.id && persistenceStatus === "available" && !isProcessing && !pendingUpload);
  const selectedParse = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId);
  const canChunk = Boolean(selectedParse && selectedParse.status === "completed" && selectedParse.isCompatible);

  function statusLabel(run: typeof selectedParse) {
    if (!run) return labels.noRun;
    if (run.status === "running" || run.status === "queued") return labels.running;
    if (run.status !== "completed") return labels.failed;
    return run.isCompatible ? labels.compatible : labels.incompatible;
  }

  return (
    <div>
      <PipelineContextBar />
      <header className="px-4 py-6 sm:px-7"><h1 className="text-[22px] font-semibold tracking-[-0.025em]">{labels.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{labels.description}</p></header>
      <section className="border-t px-4 py-5 sm:px-7"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">{copy.overview.reparseDocument}</h2><p className="mt-1 text-xs text-slate-500">{activeDocument?.fileName ?? labels.noDocument}</p></div><Button aria-describedby={!canReparse ? "parse-reparse-disabled-reason" : undefined} aria-busy={isProcessing} disabled={!canReparse} onClick={() => void reparseActiveDocument()}><RefreshCw aria-hidden="true" className="size-4" />{labels.reparse}</Button></div>{!canReparse ? <DisabledReason id="parse-reparse-disabled-reason">{pendingUpload ? (preferences.locale === "tr" ? "Seçili yeni PDF'i Documents ekranından ayrıştırın." : "Parse the selected new PDF from Documents first.") : labels.reason}</DisabledReason> : null}{parseError ? <p className="mt-2 text-xs text-red-700" role="alert">{parseError.message}</p> : null}</section>
      <section className="border-t px-4 py-5 sm:px-7"><ParseRunSelector locale={preferences.locale} /></section>
      <section className="border-t px-4 py-6 sm:px-7"><h2 className="text-sm font-semibold">{labels.history}</h2>{activeDocument?.parseRuns.length ? <div className="mt-4 space-y-2">{activeDocument.parseRuns.map((run) => <div className="flex flex-col gap-3 border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="parse-history-row" key={run.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="break-all font-mono font-medium">{run.id}</span>{run.id === selectedParseRunId ? <span className="rounded border px-1.5 py-0.5 text-[10px]">{labels.selected}</span> : null}{run.id === activeDocument.activeParseRunId ? <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{labels.active}</span> : null}{run.historicalLineage ? <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{preferences.locale === "tr" ? "Geçmiş" : "Historical"}</span> : null}</div><p className="mt-1 text-xs text-slate-500">{statusLabel(run)}{run.error?.message ? ` · ${run.error.message}` : ""}</p>{!run.isCompatible && run.compatibilityReason ? <p className="mt-1 text-xs text-orange-700">{run.compatibilityReason}</p> : null}</div><Button disabled={run.status !== "completed" || !run.isCompatible || run.id === selectedParseRunId} onClick={() => void selectParseRun(run.id)} size="sm" variant="outline">{run.id === selectedParseRunId ? labels.selected : preferences.locale === "tr" ? "Seç" : "Select"}</Button></div>)}</div> : <EmptyPipelineState>{labels.noRun}</EmptyPipelineState>}</section>
      <section className="border-t px-4 py-5 sm:px-7"><DocumentOverviewTab copy={copy.documents} locale={preferences.locale} persistedDocument={activeDocument} result={pendingUpload ? null : parseResult} selectedFile={pendingUpload} /></section>
      <ParsedContentTab copy={copy.documents} result={parseResult} />
      <section className="border-t px-4 py-6 sm:px-7">{canChunk ? <Button asChild size="sm" variant="outline"><Link href="/chunking">{labels.next}<ArrowRight aria-hidden="true" className="ml-2 size-4" /></Link></Button> : <Button disabled size="sm" variant="outline">{labels.next}</Button>}{!canChunk ? <DisabledReason id="parse-next-disabled-reason">{labels.nextReason}</DisabledReason> : null}</section>
    </div>
  );
}
