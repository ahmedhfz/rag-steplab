"use client";

import { FileText, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DeveloperOutput, ParsedContentTab } from "@/components/documents-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { StageNextAction } from "@/components/pipeline-stage-screens";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { Button } from "@/components/ui/button";
import { UI_COPY } from "@/lib/copy";
import { cn } from "@/lib/utils";

const PHASE_ORDER = ["queued", "worker_started", "source_loaded", "docling_starting", "docling_ready", "docling_converted", "content_normalized", "completed"] as const;

function formatElapsed(startedAt: string | null | undefined, now: number, durationMs?: number | null) {
  if (durationMs !== null && durationMs !== undefined) {
    const seconds = Math.max(0, Math.floor(durationMs / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
  if (!startedAt) return "—";
  const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ParseScreen() {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const { activeDocument, activePipeline, parseResult, parseStatus, parseProgress, parseProgressEstimated, parsePhase, parseError, persistenceStatus, selectedParseRunId, inspectedParseRunId, selectParseRun, setPipelineParseRun, parseActiveDocument } = useDocumentPipeline();
  const [now, setNow] = useState(() => Date.now());
  const [showLifecycle, setShowLifecycle] = useState(false);
  const isProcessing = parseStatus === "queued" || parseStatus === "running";
  useEffect(() => {
    if (!isProcessing) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isProcessing]);

  const selectedRun = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? null;
  const currentRun = activeDocument?.parseRuns.find((run) => run.status === "queued" || run.status === "running") ?? selectedRun;
  const labels = preferences.locale === "tr" ? {
    title: "Parse", description: "Seçili dokümanı normalized yapılandırılmış içeriğe dönüştürün.", parse: "Parse", reparse: "Reparse", running: "Çalışıyor", current: "Güncel durum", progress: "İlerleme", elapsed: "Geçen süre", estimated: "tahmini ara gösterim", authoritative: "doğrulanmış ilerleme", summary: "Parse özeti", content: "Parsed content", continue: "Chunking'e devam et", nextReason: "Önce parse işlemini tamamlayın.", history: "Parse sürüm geçmişi", selected: "Seçili", active: "Varsayılan", historical: "Geçmiş", compatible: "Uyumlu", incompatible: "Uyumsuz", failed: "Başarısız", noDocument: "Önce Documents ekranından bir doküman seçin.", noRun: "Henüz parse run yok.", noOutput: "Parse tamamlandığında gerçek normalized çıktı burada görünür.", unavailable: "Doküman servisi kullanılamıyor.", processingReason: "Devam eden parse tamamlanmadan yeni parse başlatılamaz.", phases: { queued: "Sırada", worker_started: "Worker başladı", source_loaded: "Kaynak yüklendi", docling_starting: "Docling başlatılıyor", docling_ready: "Docling hazır", docling_converted: "PDF dönüştürüldü", content_normalized: "İçerik normalize edildi", completed: "Tamamlandı" } as Record<string, string>, pages: "Sayfa", headings: "Başlık", paragraphs: "Paragraf", lists: "Liste", tables: "Tablo", elements: "Element" } : {
    title: "Parse", description: "Turn the selected document into normalized structured content.", parse: "Parse", reparse: "Reparse", running: "Running", current: "Current status", progress: "Progress", elapsed: "Elapsed", estimated: "estimated between checkpoints", authoritative: "confirmed progress", summary: "Parse summary", content: "Parsed content", continue: "Continue to Chunking", nextReason: "Complete parsing before continuing to Chunking.", history: "Parse version history", selected: "Selected", active: "Default", historical: "Historical", compatible: "Compatible", incompatible: "Incompatible", failed: "Failed", noDocument: "Select a persisted document before parsing.", noRun: "No parse runs exist yet.", noOutput: "The real normalized output appears here after parsing completes.", unavailable: "The document service is unavailable.", processingReason: "A new parse cannot start until the current run finishes.", phases: { queued: "Queued", worker_started: "Worker started", source_loaded: "Source loaded", docling_starting: "Docling starting", docling_ready: "Docling ready", docling_converted: "PDF converted", content_normalized: "Content normalized", completed: "Completed" } as Record<string, string>, pages: "Pages", headings: "Headings", paragraphs: "Paragraphs", lists: "Lists", tables: "Tables", elements: "Elements" };
  const canParse = Boolean(activeDocument?.id && persistenceStatus === "available" && !isProcessing);
  const blocker = isProcessing ? labels.processingReason : persistenceStatus !== "available" ? labels.unavailable : !activeDocument?.id ? labels.noDocument : null;
  const actionLabel = activeDocument?.activeParseRunId ? labels.reparse : labels.parse;
  const phase = parsePhase ?? currentRun?.phase ?? (parseStatus === "completed" ? "completed" : parseStatus === "queued" ? "queued" : null);
  const phaseIndex = phase ? PHASE_ORDER.indexOf(phase as typeof PHASE_ORDER[number]) : -1;
  const statusLabel = currentRun?.status === "failed" ? labels.failed : phase ? labels.phases[phase] ?? phase : parseStatus;
  const summaryFields = parseResult ? [[labels.pages, parseResult.summary.pageCount], [labels.headings, parseResult.summary.headingCount], [labels.paragraphs, parseResult.summary.paragraphCount], [labels.lists, parseResult.summary.listCount], [labels.tables, parseResult.summary.tableCount], [labels.elements, parseResult.structured.elements.length]] as const : [];
  const orderedRuns = useMemo(() => [...(activeDocument?.parseRuns ?? [])].sort((a, b) => (b.runNumber ?? 0) - (a.runNumber ?? 0) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))), [activeDocument?.parseRuns]);
  const lifecycleVisible = showLifecycle || isProcessing;
  const parseAction = () => { setShowLifecycle(true); void parseActiveDocument(); };

  const statusTone = currentRun?.status === "failed" ? "border-[#edcfcf] bg-[#fbefef] text-[#a23b3b]" : currentRun?.status === "queued" || currentRun?.status === "running" ? "border-[#eadfc9] bg-[#fbf5e9] text-[#8d651e]" : "border-[#d6e5da] bg-[#eef4ef] text-[#3f7a55]";

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="parse-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <header className="flex min-h-[92px] items-start justify-between gap-6 max-md:flex-col" data-testid="parse-page-header">
          <div className="max-w-[720px]">
            <p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-[#711f3a]">{copy.nav.pipeline}</p>
            <h1 className="mt-2 text-[30px] font-semibold leading-9 tracking-[-0.6px] text-[#171416]">{labels.title === "Parse" ? (preferences.locale === "tr" ? "Ayrıştırma" : "Parsing") : labels.title}</h1>
            <p className="mt-2 text-sm leading-[21px] text-[#6e676a]">{labels.description}</p>
          </div>
          <StageNextAction disabled={!parseResult} href="/chunking" label={labels.continue} reason={blocker ?? labels.nextReason} testId="parse-next-action" />
        </header>

        <PipelineContextBar showLineage={false} />

        <section aria-live="polite" className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white px-4 py-3" data-testid="parse-document-status">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[#fbf4f6] text-[#711f3a]"><FileText aria-hidden="true" className="size-[18px]" /></span>
            <div className="min-w-0"><p className="text-xs leading-[18px] text-[#969093]">{preferences.locale === "tr" ? "Doküman" : "Document"}</p><p className="truncate text-sm font-medium leading-[21px] text-[#171416]">{activeDocument?.fileName ?? labels.noDocument}</p></div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className={cn("rounded-full border px-3 py-1 text-[11px] font-medium", statusTone)}><span aria-hidden="true" className="mr-1.5 inline-block size-1.5 rounded-full bg-current" />{statusLabel || (parseResult ? (preferences.locale === "tr" ? "Ayrıştırıldı" : "Parsed") : labels.noRun)}</span>
            <Button aria-busy={isProcessing} aria-describedby={blocker ? "parse-action-disabled-reason" : undefined} className="h-[42px] rounded-[10px] border-[#d8d2d5] bg-white px-4 text-sm text-[#171416] shadow-none hover:bg-[#fbf4f6]" data-testid="parse-run-action" disabled={!canParse} onClick={parseAction} variant="outline">
              {isProcessing ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="size-4" />}{isProcessing ? labels.running : actionLabel}
            </Button>
          </div>
        </section>
        {blocker ? <p className="mt-3 rounded-[10px] border border-[#eadfc9] bg-[#fffaf1] px-3 py-2 text-xs leading-5 text-[#8d651e]" id="parse-action-disabled-reason" role="status">{blocker}</p> : null}

        {lifecycleVisible ? <section aria-live="polite" className="mt-6 grid gap-4 rounded-[12px] border border-[#e7e2e4] bg-white p-4 md:grid-cols-[minmax(0,1fr)_120px]"><div><div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-[#171416]">{statusLabel}</span><span className="text-[#6e676a]">{parseProgress}% · {parseProgressEstimated ? labels.estimated : labels.authoritative}</span></div><div aria-label={`${labels.progress} ${parseProgress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={parseProgress} className="mt-3 h-2 overflow-hidden rounded-full bg-[#e7e2e4]" role="progressbar"><div className="h-full bg-[#711f3a] transition-[width] duration-300" style={{ width: `${parseProgress}%` }} /></div><ol className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">{PHASE_ORDER.map((item, index) => <li className={index <= phaseIndex ? "text-[9px] text-[#711f3a]" : "text-[9px] text-[#969093]"} key={item}><span aria-hidden="true" className={index <= phaseIndex ? "mb-1 block h-1 rounded-full bg-[#711f3a]" : "mb-1 block h-1 rounded-full bg-[#e7e2e4]"} />{labels.phases[item]}</li>)}</ol></div><div className="border-l border-[#e7e2e4] pl-4"><p className="text-[11px] uppercase tracking-[0.12em] text-[#969093]">{labels.elapsed}</p><p className="mt-2 text-lg font-semibold text-[#171416]">{formatElapsed(currentRun?.timing.startedAt, now, currentRun?.status === "completed" ? currentRun.timing.durationMs : null)}</p></div></section> : null}
        {parseError ? <p className="mt-4 rounded-[10px] border border-[#edcfcf] bg-[#fbefef] px-3 py-2 text-xs text-[#a23b3b]" role="alert">{parseError.message}</p> : null}

        {parseResult ? <>
          <section className="mt-6" data-testid="parse-result-summary"><p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-[#969093]">{preferences.locale === "tr" ? "SONUÇ ÖZETİ" : "RESULT SUMMARY"}</p><dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{summaryFields.map(([label, value]) => <div key={label}><dt className="text-xs uppercase leading-[18px] tracking-[0.48px] text-[#969093]">{label}</dt><dd className="mt-1 text-[26px] font-semibold leading-[31px] tracking-[-0.52px] text-[#171416]">{String(value)}</dd></div>)}</dl></section>
          <section className="mt-8" aria-labelledby="parsed-content-title"><div className="flex items-center justify-between gap-3"><div><h2 className="text-base font-semibold leading-[22px]" id="parsed-content-title">{preferences.locale === "tr" ? "Yapılandırılmış içerik" : "Structured content"}</h2></div><SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} /></div><div className="mt-4 h-[451px] overflow-hidden rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white p-4"><ParsedContentTab copy={copy.documents} result={parseResult} showDeveloperOutput={false} /></div></section>
          <div className="mt-8"><DeveloperOutput copy={copy.documents} result={parseResult} /></div>
        </> : <>
          <section className="mt-6 rounded-[16px] border border-[#e7e2e4] bg-white"><EmptyPipelineState>{labels.noOutput}</EmptyPipelineState></section>
          <div aria-label={copy.documents.viewMode} className="sr-only" role="group">
            {[copy.documents.structured, copy.documents.markdown, copy.documents.json].map((view) => <Button disabled key={view} size="sm" variant="ghost">{view}</Button>)}
          </div>
        </>}

        <section className="mt-8" data-testid="parse-history"><h2 className="text-base font-semibold leading-[22px]">{preferences.locale === "tr" ? "Ayrıştırma geçmişi" : "Parsing history"}</h2><details className="mt-4 rounded-[12px] border border-[#e7e2e4] bg-white"><summary className="flex h-[46px] cursor-pointer list-none items-center justify-between px-4 text-[13px] font-medium text-[#171416] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#711f3a]/25 sm:px-5"><span>{labels.history} ({orderedRuns.length})</span><span aria-hidden="true" className="text-[#969093]">⌄</span></summary>{orderedRuns.length ? <div className="space-y-2 border-t border-[#e7e2e4] p-4 sm:p-6">{orderedRuns.map((run) => <div className="flex flex-col gap-3 border border-[#e7e2e4] p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="parse-history-row" key={run.id}><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold">Parse {run.runNumber ?? "—"}</span><details><summary className="cursor-pointer text-[10px] text-[#6e676a]">{preferences.locale === "tr" ? "Teknik kimlik" : "Technical ID"}</summary><span className="break-all font-mono text-[10px] text-[#6e676a]">{run.id}</span></details>{run.id === (inspectedParseRunId ?? selectedParseRunId) ? <span className="rounded-full border border-[#d8b5c2] bg-[#fbf4f6] px-1.5 py-0.5 text-[10px] text-[#711f3a]">{labels.selected}</span> : null}{run.id === activeDocument?.activeParseRunId ? <span className="rounded-full border border-[#d6e5da] bg-[#f0f6f1] px-1.5 py-0.5 text-[10px] text-[#3f7a55]">{labels.active}</span> : null}{run.historicalLineage ? <span className="rounded-full border border-[#eadfc9] bg-[#fbf5e9] px-1.5 py-0.5 text-[10px] text-[#8d651e]">{labels.historical}</span> : null}</div><p className="mt-1 text-xs text-[#6e676a]">{run.status === "completed" ? run.isCompatible ? labels.compatible : labels.incompatible : run.status === "failed" ? labels.failed : labels.running}{run.timing.durationMs ? ` · ${run.timing.durationMs} ms` : ""}</p></div><div className="flex flex-wrap justify-end gap-2"><Button disabled={run.status !== "completed" || !run.isCompatible || run.id === (inspectedParseRunId ?? selectedParseRunId)} onClick={() => void selectParseRun(run.id)} size="sm" variant="outline">{run.id === (inspectedParseRunId ?? selectedParseRunId) ? labels.selected : preferences.locale === "tr" ? "İncele" : "Inspect"}</Button>{activePipeline && run.id === (inspectedParseRunId ?? selectedParseRunId) && run.id !== selectedParseRunId ? <Button onClick={() => void setPipelineParseRun(run.id)} size="sm" variant="outline">{preferences.locale === "tr" ? "Pipeline'da kullan" : "Use in pipeline"}</Button> : null}</div></div>)}</div> : <div className="border-t border-[#e7e2e4]"><EmptyPipelineState>{labels.noRun}</EmptyPipelineState></div>}</details></section>
      </div>
    </div>
  );
}
