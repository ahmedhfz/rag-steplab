"use client";

import { ThinkingText, TransitionNumber, TransitionText } from "@/components/ui/transitions";

import { useEffect, useMemo, useState } from "react";

import { DeveloperOutput, ParsedContentTab } from "@/components/documents-screen";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { StageNextAction } from "@/components/pipeline-stage-screens";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { SourceInspector } from "@/components/source-inspector";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Disclosure, TechnicalDetails } from "@/components/ui/disclosure";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
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
  const { activeDocument, activePipeline, parseResult, parseStatus, parseProgress, parseProgressEstimated, parsePhase, parseError, persistenceStatus, workspaceStatus, selectedParseRunId, selectedParseResult, inspectedParseRunId, selectParseRun, setPipelineParseRun, reparseActiveDocument } = useDocumentPipeline();
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
    title: "Parse", description: "Seçili PDF'nin metnini ve yapısını çıkarıp inceleyin.", parse: "Parse", reparse: "Yeniden parse et", reports: "Sonuçları gör", running: "Çalışıyor", current: "Güncel durum", parseCompleted: "Parse tamamlandı", progress: "İlerleme", elapsed: "Geçen süre", estimated: "kontrol noktaları arası tahmin", authoritative: "doğrulanmış ilerleme", summary: "Parse özeti", content: "Parsed content", continue: "Chunking'e devam et", nextReason: "Önce parse işlemini tamamlayın.", history: "Parse sürüm geçmişi", selected: "Seçili", active: "Varsayılan", historical: "Geçmiş", compatible: "Uyumlu", incompatible: "Uyumsuz", failed: "Başarısız", noDocument: "Önce Documents ekranından bir doküman seçin.", noRun: "Henüz parse sonucu yok.", noOutput: "Parse tamamlandığında çıkarılan metin ve yapı burada görünür.", unavailable: "Doküman servisi kullanılamıyor.", processingReason: "Devam eden parse tamamlanmadan yeni parse başlatılamaz.", phases: { queued: "Sırada", worker_started: "Başlatıldı", source_loaded: "Kaynak yüklendi", docling_starting: "Belge okunuyor", docling_ready: "İçerik işleniyor", docling_converted: "PDF okundu", content_normalized: "İçerik düzenlendi", completed: "Tamamlandı" } as Record<string, string>, pages: "Sayfa", headings: "Başlık", paragraphs: "Paragraf", lists: "Liste", tables: "Tablo", elements: "Öğe" } : {
    title: "Parse", description: "Extract and inspect the selected PDF's text and structure.", parse: "Parse", reparse: "Parse again", reports: "View results", running: "Running", current: "Current status", parseCompleted: "Parse completed", progress: "Progress", elapsed: "Elapsed", estimated: "estimated between checkpoints", authoritative: "confirmed progress", summary: "Parse summary", content: "Parsed content", continue: "Continue to Chunking", nextReason: "Complete parsing before continuing to Chunking.", history: "Parse version history", selected: "Selected", active: "Default", historical: "Historical", compatible: "Compatible", incompatible: "Incompatible", failed: "Failed", noDocument: "Select a document before parsing.", noRun: "No parse result yet.", noOutput: "Extracted text and structure appear here when parsing completes.", unavailable: "The document service is unavailable.", processingReason: "A new parse cannot start until the current run finishes.", phases: { queued: "Queued", worker_started: "Started", source_loaded: "Source loaded", docling_starting: "Reading document", docling_ready: "Processing content", docling_converted: "PDF read", content_normalized: "Content structured", completed: "Completed" } as Record<string, string>, pages: "Pages", headings: "Headings", paragraphs: "Paragraphs", lists: "Lists", tables: "Tables", elements: "Elements" };
  const canParse = Boolean(activeDocument?.id && workspaceStatus === "ready" && !isProcessing);
  const blocker = isProcessing ? labels.processingReason : workspaceStatus === "loading" ? (preferences.locale === "tr" ? "Doküman servisi kontrol ediliyor…" : "Checking document service…") : persistenceStatus === "unavailable" ? labels.unavailable : !activeDocument?.id ? labels.noDocument : null;
  const actionLabel = activeDocument?.activeParseRunId ? labels.reparse : labels.parse;
  const phase = parsePhase ?? currentRun?.phase ?? (parseStatus === "completed" ? "completed" : parseStatus === "queued" ? "queued" : null);
  const phaseIndex = phase ? PHASE_ORDER.indexOf(phase as typeof PHASE_ORDER[number]) : -1;
  const statusLabel = currentRun?.status === "failed" ? labels.failed : phase === "completed" ? labels.parseCompleted : phase ? labels.phases[phase] ?? phase : parseStatus;
  const summaryFields = parseResult ? [[labels.pages, parseResult.summary.pageCount], [labels.headings, parseResult.summary.headingCount], [labels.paragraphs, parseResult.summary.paragraphCount], [labels.lists, parseResult.summary.listCount], [labels.tables, parseResult.summary.tableCount], [labels.elements, parseResult.structured.elements.length]] as const : [];
  const orderedRuns = useMemo(() => [...(activeDocument?.parseRuns ?? [])].sort((a, b) => (b.runNumber ?? 0) - (a.runNumber ?? 0) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))), [activeDocument?.parseRuns]);
  const lifecycleVisible = showLifecycle || isProcessing;
  const parseAction = () => { setShowLifecycle(true); void reparseActiveDocument(); };
  const openReport = () => {
    const report = document.getElementById("parse-result-summary");
    report?.focus({ preventScroll: true });
    report?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
  };

  const statusTone: StatusTone = currentRun?.status === "failed" ? "error" : currentRun?.status === "queued" || currentRun?.status === "running" ? "running" : currentRun?.status === "completed" ? "neutral" : "idle";
  const inspectedRunId = inspectedParseRunId ?? selectedParseRunId;

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="parse-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="parse-page-header" description={labels.description} title={labels.title === "Parse" ? (preferences.locale === "tr" ? "Ayrıştırma" : "Parsing") : labels.title} />

        <div className="mt-6 grid min-w-0 gap-3 lg:grid-cols-[max-content_minmax(0,1fr)]" data-testid="parse-workspace-controls">
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-card [&>[data-testid=pipeline-context-bar]]:border-b-0">
            <PipelineContextBar showLineage={false} />
          </div>

          <section aria-live="polite" className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5" data-testid="parse-document-status">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">{labels.current}</span>
              <StatusPill tone={statusTone}>{statusLabel || (parseResult ? (preferences.locale === "tr" ? "Ayrıştırıldı" : "Parsed") : labels.noRun)}</StatusPill>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button aria-label={labels.reports} data-testid="parse-reports-action" disabled={!parseResult} onClick={openReport} size="sm" type="button" variant="outline">
                <AppIcon name="document" className="size-3.5" />{labels.reports}
              </Button>
              <Button aria-busy={isProcessing} aria-describedby={blocker ? "parse-action-disabled-reason" : undefined} data-testid="parse-run-action" disabled={!canParse} onClick={parseAction} size="sm" variant={activeDocument?.activeParseRunId ? "outline" : "default"}>
                {isProcessing ? <AppIcon name="loading" className="size-3.5 animate-spin" /> : <AppIcon name="refresh" className="size-3.5" />}{isProcessing ? labels.running : actionLabel}
              </Button>
            </div>
          </section>
        </div>
        {blocker ? <p className={cn("mt-3 text-sm", persistenceStatus === "unavailable" ? "text-destructive" : "text-muted-foreground")} id="parse-action-disabled-reason" role="status">{blocker}</p> : null}

        {lifecycleVisible ? <section aria-live="polite" className="mt-6 grid gap-4 rounded-lg border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_120px]">
          <div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">{isProcessing ? <ThinkingText>{statusLabel}</ThinkingText> : <TransitionText>{statusLabel}</TransitionText>}</span>
              <span className="text-muted-foreground tabular-nums"><TransitionNumber>{parseProgress}</TransitionNumber>% · {parseProgressEstimated ? labels.estimated : labels.authoritative}</span>
            </div>
            <div aria-label={`${labels.progress} ${parseProgress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={parseProgress} className="mt-3 h-2 overflow-hidden rounded-full bg-secondary" role="progressbar"><div className="h-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${parseProgress}%` }} /></div>
            <ol className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-8">{PHASE_ORDER.map((item, index) => <li className={index <= phaseIndex ? "text-xs text-foreground" : "text-xs text-subtle-foreground"} key={item}><span aria-hidden="true" className={index <= phaseIndex ? "mb-1 block h-1 rounded-full bg-muted-foreground" : "mb-1 block h-1 rounded-full bg-border"} />{labels.phases[item]}</li>)}</ol>
          </div>
          <div className="border-l border-border pl-4">
            <p className="text-xs text-muted-foreground">{labels.elapsed}</p>
            <p className="mt-1 text-lg font-semibold text-foreground tabular-nums">{formatElapsed(currentRun?.timing.startedAt, now, currentRun?.status === "completed" ? currentRun.timing.durationMs : null)}</p>
          </div>
        </section> : null}
        {parseError ? <p className="mt-4 rounded-md border border-destructive-border bg-destructive-subtle px-3 py-2 text-xs text-destructive" role="alert">{parseError.message}</p> : null}

        {parseResult ? <>
          <section className="mt-6" data-testid="parse-result-summary" id="parse-result-summary" tabIndex={-1}>
            <p className="text-xs font-semibold text-muted-foreground">{preferences.locale === "tr" ? "SONUÇ ÖZETİ" : "RESULT SUMMARY"}</p>
            <dl className="mt-3 grid grid-cols-2 gap-4 border-y border-border py-3 sm:grid-cols-3 lg:grid-cols-6">{summaryFields.map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-xl font-semibold text-foreground tabular-nums">{String(value)}</dd></div>)}</dl>
          </section>
          <section className="mt-8" aria-labelledby="parsed-content-title">
            <div className="flex items-center justify-between gap-3"><h2 className="text-base font-semibold" id="parsed-content-title">{preferences.locale === "tr" ? "Yapılandırılmış içerik" : "Structured content"}</h2><SourceInspector documentId={activeDocument?.id ?? null} parseResult={parseResult} /></div>
            <div className="mt-4 h-112 overflow-y-auto rounded-lg border border-border bg-card p-4"><ParsedContentTab copy={copy.documents} result={parseResult} showDeveloperOutput={false} /></div>
          </section>
          <div className="mt-8"><DeveloperOutput copy={copy.documents} result={parseResult} /></div>
        </> : <>
          <section className="mt-6 rounded-lg border border-border bg-card"><EmptyPipelineState>{labels.noOutput}</EmptyPipelineState></section>
          <div aria-label={copy.documents.viewMode} className="sr-only" role="group">
            {[copy.documents.structured, copy.documents.markdown, copy.documents.json].map((view) => <Button disabled key={view} size="sm" variant="ghost">{view}</Button>)}
          </div>
        </>}

        <section className="mt-8" data-testid="parse-history">
          <Disclosure contentClassName={orderedRuns.length ? "space-y-2 p-4" : "p-0"} title={`${labels.history} (${orderedRuns.length})`}>
            {orderedRuns.length ? orderedRuns.map((run) => <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid="parse-history-row" key={run.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-semibold tabular-nums">Parse {run.runNumber ?? "—"}</span>
                  {run.id === inspectedRunId ? <StatusPill tone="neutral">{labels.selected}</StatusPill> : null}
                  {run.id === activeDocument?.activeParseRunId ? <StatusPill tone="neutral">{labels.active}</StatusPill> : null}
                  {run.historicalLineage ? <StatusPill tone="warning">{labels.historical}</StatusPill> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">{run.status === "completed" ? run.isCompatible ? labels.compatible : labels.incompatible : run.status === "failed" ? labels.failed : labels.running}{run.timing.durationMs ? ` · ${run.timing.durationMs} ms` : ""}</p>
                <TechnicalDetails className="mt-1" title={preferences.locale === "tr" ? "Teknik kimlik" : "Technical ID"}><span className="break-all font-mono text-xs text-muted-foreground">{run.id}</span></TechnicalDetails>
              </div>
              <div className="flex flex-wrap justify-end gap-2"><Button disabled={run.status !== "completed" || !run.isCompatible || run.id === inspectedRunId} onClick={() => void selectParseRun(run.id)} size="sm" variant="outline">{run.id === inspectedRunId ? labels.selected : preferences.locale === "tr" ? "İncele" : "Inspect"}</Button>{activePipeline && run.id === inspectedRunId && run.id !== selectedParseRunId ? <Button onClick={() => void setPipelineParseRun(run.id)} size="sm" variant="outline">{preferences.locale === "tr" ? "Pipeline'da kullan" : "Use in pipeline"}</Button> : null}</div>
            </div>) : <EmptyPipelineState>{labels.noRun}</EmptyPipelineState>}
          </Disclosure>
        </section>
        <StageNextAction disabled={!selectedParseResult || isProcessing || selectedRun?.status !== "completed" || !selectedRun.isCompatible} href="/chunking" label={labels.continue} testId="parse-next-action" />
      </div>
    </div>
  );
}

