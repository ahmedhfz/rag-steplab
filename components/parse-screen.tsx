"use client";

import Link from "next/link";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ParsedContentTab } from "@/components/documents-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState, LearningHint, MetricCard } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { Button } from "@/components/ui/button";
import { UI_COPY } from "@/lib/copy";

const PHASE_ORDER = ["queued", "worker_started", "source_loaded", "docling_starting", "docling_ready", "docling_converted", "content_normalized", "completed"] as const;

function formatElapsed(startedAt: string | null | undefined, now: number) {
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ParseScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const { activeDocument, parseResult, parseStatus, parseProgress, parseProgressEstimated, parsePhase, parseError, persistenceStatus, selectedParseRunId, selectParseRun, parseActiveDocument } = useDocumentPipeline();
  const [now, setNow] = useState(() => Date.now());
  const isProcessing = parseStatus === "queued" || parseStatus === "running";
  useEffect(() => {
    if (!isProcessing) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isProcessing]);

  const selectedRun = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? null;
  const currentRun = activeDocument?.parseRuns.find((run) => run.status === "queued" || run.status === "running") ?? selectedRun;
  const labels = preferences.locale === "tr" ? {
    title: "Parse", description: "Docling lifecycle'ını, normalized çıktıyı ve kaynak provenance'ını inceleyin.", parse: "Parse", reparse: "Reparse", running: "Çalışıyor", current: "Güncel durum", progress: "İlerleme", elapsed: "Geçen süre", estimated: "tahmini ara gösterim", authoritative: "backend checkpoint", summary: "Parse özeti", content: "Parsed content", continue: "Chunking'e devam et", history: "Parse sürüm geçmişi", selected: "Seçili", active: "Varsayılan", historical: "Geçmiş", compatible: "Uyumlu", incompatible: "Uyumsuz", failed: "Başarısız", noDocument: "Önce Documents ekranından bir doküman seçin.", noRun: "Henüz parse run yok.", noOutput: "Parse tamamlandığında gerçek normalized çıktı burada görünür.", unavailable: "Doküman servisi kullanılamıyor.", processingReason: "Devam eden parse tamamlanmadan yeni parse başlatılamaz.", phases: { queued: "Sırada", worker_started: "Worker başladı", source_loaded: "Kaynak yüklendi", docling_starting: "Docling başlatılıyor", docling_ready: "Docling hazır", docling_converted: "PDF dönüştürüldü", content_normalized: "İçerik normalize edildi", completed: "Tamamlandı" } as Record<string, string>, pages: "Sayfa", headings: "Başlık", paragraphs: "Paragraf", lists: "Liste", tables: "Tablo", elements: "Element" } : {
    title: "Parse", description: "Inspect the Docling lifecycle, normalized output, and source provenance.", parse: "Parse", reparse: "Reparse", running: "Running", current: "Current status", progress: "Progress", elapsed: "Elapsed", estimated: "estimated between checkpoints", authoritative: "backend checkpoint", summary: "Parse summary", content: "Parsed content", continue: "Continue to Chunking", history: "Parse version history", selected: "Selected", active: "Default", historical: "Historical", compatible: "Compatible", incompatible: "Incompatible", failed: "Failed", noDocument: "Select a persisted document before parsing.", noRun: "No parse runs exist yet.", noOutput: "The real normalized output appears here after parsing completes.", unavailable: "The document service is unavailable.", processingReason: "A new parse cannot start until the current run finishes.", phases: { queued: "Queued", worker_started: "Worker started", source_loaded: "Source loaded", docling_starting: "Docling starting", docling_ready: "Docling ready", docling_converted: "PDF converted", content_normalized: "Content normalized", completed: "Completed" } as Record<string, string>, pages: "Pages", headings: "Headings", paragraphs: "Paragraphs", lists: "Lists", tables: "Tables", elements: "Elements" };
  const canParse = Boolean(activeDocument?.id && persistenceStatus === "available" && !isProcessing);
  const blocker = isProcessing ? labels.processingReason : persistenceStatus !== "available" ? labels.unavailable : !activeDocument?.id ? labels.noDocument : null;
  const actionLabel = activeDocument?.activeParseRunId ? labels.reparse : labels.parse;
  const phase = parsePhase ?? currentRun?.phase ?? (parseStatus === "completed" ? "completed" : parseStatus === "queued" ? "queued" : null);
  const phaseIndex = phase ? PHASE_ORDER.indexOf(phase as typeof PHASE_ORDER[number]) : -1;
  const statusLabel = currentRun?.status === "failed" ? labels.failed : phase ? labels.phases[phase] ?? phase : parseStatus;
  const summaryFields = parseResult ? [[labels.pages, parseResult.summary.pageCount], [labels.headings, parseResult.summary.headingCount], [labels.paragraphs, parseResult.summary.paragraphCount], [labels.lists, parseResult.summary.listCount], [labels.tables, parseResult.summary.tableCount], [labels.elements, parseResult.structured.elements.length]] as const : [];
  const orderedRuns = useMemo(() => [...(activeDocument?.parseRuns ?? [])].sort((a, b) => (b.runNumber ?? 0) - (a.runNumber ?? 0) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))), [activeDocument?.parseRuns]);

  return <div>
    <PipelineContextBar />
    <header className="border-b px-4 py-6 sm:px-7"><h1 className="text-[22px] font-semibold tracking-[-0.025em]">{labels.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{labels.description}</p></header>
    <section className="border-b px-4 py-5 sm:px-7" aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{labels.current}</p><p className="mt-1 text-xs text-slate-500">{activeDocument?.fileName ?? labels.noDocument}</p></div><Button aria-busy={isProcessing} aria-describedby={blocker ? "parse-action-disabled-reason" : undefined} disabled={!canParse} onClick={() => void parseActiveDocument()}>{isProcessing ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-4" />}{isProcessing ? labels.running : actionLabel}</Button></div>
      {blocker ? <DisabledReason id="parse-action-disabled-reason">{blocker}</DisabledReason> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_130px]">
        <div className="border p-4"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium">{statusLabel}</span><span className="text-slate-500">{parseProgress}% · {parseProgressEstimated ? labels.estimated : labels.authoritative}</span></div><div aria-label={`${labels.progress} ${parseProgress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={parseProgress} className="mt-3 h-2 overflow-hidden rounded bg-slate-200" role="progressbar"><div className="h-full bg-sky-600 transition-[width] duration-300" style={{ width: `${parseProgress}%` }} /></div><ol className="mt-3 grid grid-cols-4 gap-1 sm:grid-cols-8">{PHASE_ORDER.map((item, index) => <li className={index <= phaseIndex ? "text-[9px] text-emerald-700" : "text-[9px] text-slate-400"} key={item}><span aria-hidden="true" className={index <= phaseIndex ? "mb-1 block h-1 rounded bg-emerald-500" : "mb-1 block h-1 rounded bg-slate-200"} />{labels.phases[item]}</li>)}</ol></div>
        <MetricCard label={labels.elapsed} value={formatElapsed(currentRun?.timing.startedAt, now)} />
      </div>
      {parseError ? <p className="mt-3 text-xs text-red-700" role="alert">{parseError.message}</p> : null}
    </section>
    <section className="border-b px-4 py-6 sm:px-7"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold">{labels.summary}</h2><SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} /></div>{summaryFields.length ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{summaryFields.map(([label, value]) => <MetricCard key={label} label={label} value={String(value)} />)}</div> : <EmptyPipelineState>{labels.noOutput}</EmptyPipelineState>}<LearningHint locale={preferences.locale}>{preferences.locale === "tr" ? "Tablo sayısının 0 olması, tablo içermeyen geçerli bir PDF için doğrudur; parse hatası değildir." : "A table count of 0 is truthful for a valid tableless PDF; it is not a parse failure."}</LearningHint></section>
    <section aria-labelledby="parsed-content-title" className="border-b"><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-7"><h2 className="text-sm font-semibold" id="parsed-content-title">{labels.content}</h2>{parseResult ? <Button asChild><Link href="/chunking">{labels.continue}</Link></Button> : <Button disabled>{labels.continue}</Button>}</div><ParsedContentTab copy={copy.documents} result={parseResult} /></section>
    <section className="px-4 py-6 sm:px-7"><details><summary className="cursor-pointer text-sm font-semibold">{labels.history} ({orderedRuns.length})</summary>{orderedRuns.length ? <div className="mt-4 space-y-2">{orderedRuns.map((run) => <div className="flex flex-col gap-3 border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="parse-history-row" key={run.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">P{run.runNumber ?? "—"}</span>{preferences.detailLevel === "technical" ? <span className="truncate font-mono" title={run.id}>{run.id}</span> : null}{run.id === selectedParseRunId ? <span className="rounded border px-1.5 py-0.5 text-[10px]">{labels.selected}</span> : null}{run.id === activeDocument?.activeParseRunId ? <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{labels.active}</span> : null}{run.historicalLineage ? <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{labels.historical}</span> : null}</div><p className="mt-1 text-xs text-slate-500">{run.status === "completed" ? run.isCompatible ? labels.compatible : labels.incompatible : run.status === "failed" ? labels.failed : labels.running}{run.timing.durationMs ? ` · ${run.timing.durationMs} ms` : ""}</p></div><Button disabled={run.status !== "completed" || !run.isCompatible || run.id === selectedParseRunId} onClick={() => void selectParseRun(run.id)} size="sm" variant="outline">{run.id === selectedParseRunId ? labels.selected : preferences.locale === "tr" ? "Seç" : "Select"}</Button></div>)}</div> : <EmptyPipelineState>{labels.noRun}</EmptyPipelineState>}</details></section>
  </div>;
}
