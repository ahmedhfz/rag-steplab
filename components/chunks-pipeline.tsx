"use client";

import { useState } from "react";
import { Braces, CheckCircle2, FileText, Play, Search } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, LearningHint, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { SourceInspector } from "@/components/source-inspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppLocale } from "@/lib/copy";
import type { ChunkRun, ChunkStrategy, EmbeddingRun } from "@/lib/rag-api-types";
import { getPipelineAvailability } from "@/lib/blockers";

const strategyNotes: Record<ChunkStrategy, { en: string; tr: string }> = {
  fixed_token: { en: "Simple deterministic chunks with fixed token boundaries.", tr: "Sabit token sınırlarıyla deterministik parçalar." },
  recursive_token: { en: "Preserves larger natural text boundaries before splitting further.", tr: "Daha büyük doğal metin sınırlarını koruyarak böler." },
  structure_aware: { en: "Uses document structure such as headings, sections and tables.", tr: "Başlıklar, bölümler ve tablolar gibi belge yapısını kullanır." },
};

const strategyNames: Record<ChunkStrategy, { en: string; tr: string }> = {
  fixed_token: { en: "Fixed token", tr: "Sabit token" },
  recursive_token: { en: "Recursive", tr: "Recursive" },
  structure_aware: { en: "Structure-aware", tr: "Structure-aware" },
};

function ChunkInspector({ run, labels, documentId, parseResult }: { run: ChunkRun; labels: Record<string, string>; documentId: string | null; parseResult: Parameters<typeof SourceInspector>[0]["parseResult"] }) {
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(run.chunks[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const selectedChunk = run.chunks.find((chunk) => chunk.id === selectedChunkId) ?? run.chunks[0];
  if (!selectedChunk) return <EmptyPipelineState>{labels.chunkEmpty}</EmptyPipelineState>;

  const visibleChunks = run.chunks.filter((chunk) => {
    const normalizedQuery = query.trim().toLowerCase();
    return !normalizedQuery || `${chunk.ordinal} ${chunk.text} ${chunk.headingPath.join(" ")}`.toLowerCase().includes(normalizedQuery);
  });

  return (
    <div className="grid min-w-0 overflow-hidden rounded-[16px] border-[1.712px] border-border bg-card lg:grid-cols-[400px_minmax(0,1fr)]" data-testid="chunk-inspector">
      <aside className="min-w-0 border-b-[1.712px] border-border bg-card lg:border-b-0 lg:border-r-[1.712px]">
        <div className="border-b-[1.712px] border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-foreground">{labels.chunks}</p><p className="mt-1 text-xs text-subtle-foreground">{run.chunkCount} {labels.chunkCount}</p></div><span className="text-xs text-subtle-foreground">{labels.select}</span></div>
          <div className="relative mt-2.5"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground" /><Input aria-label={labels.filter} className="h-9 rounded-[9px] border-input bg-card pl-9 text-[13px] shadow-none" data-testid="chunk-filter" onChange={(event) => setQuery(event.target.value)} placeholder={labels.filterPlaceholder} value={query} /></div>
        </div>
        <div className="max-h-[620px] overflow-y-auto" role="list" aria-label={labels.chunks}>
          {visibleChunks.length ? visibleChunks.map((chunk) => {
            const selected = chunk.id === selectedChunk.id;
            const displayOrdinal = chunk.ordinal + 1;
            return <button aria-pressed={selected} className={`block min-h-[60px] w-full border-l-2 px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/25 ${selected ? "border-brand bg-accent" : "border-transparent hover:bg-technical"}`} data-testid="chunk-list-item" key={chunk.id} onClick={() => setSelectedChunkId(chunk.id)} type="button"><span className="flex items-center justify-between gap-2"><span className={`text-[13px] font-medium ${selected ? "text-accent-foreground" : "text-foreground"}`}>{String(displayOrdinal).padStart(2, "0")} &nbsp;{chunk.headingPath.at(-1) || `${labels.chunk} ${displayOrdinal}`}</span><span className="font-mono text-[11px] text-subtle-foreground">{chunk.tokenCount}</span></span><span className="mt-0.5 block truncate text-[11.5px] leading-[17px] text-subtle-foreground">{chunk.headingPath.length ? `${chunk.headingPath.join(" › ")} · ` : ""}{chunk.pageNumbers.length ? `${labels.page} ${chunk.pageNumbers.join(", ")}` : labels.noPage}</span></button>;
          }) : <p className="px-4 py-6 text-center text-xs leading-5 text-muted-foreground">{labels.noMatches}</p>}
        </div>
      </aside>
      <article className="min-w-0" data-testid="chunk-inspector-detail">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-[1.712px] border-border px-6 py-4">
          <div><span className="inline-flex rounded-[6px] bg-secondary px-2 py-1 font-mono text-xs text-accent-foreground">{labels.chunk} {selectedChunk.ordinal + 1}</span><p className="mt-3 text-xs text-subtle-foreground">{selectedChunk.headingPath.length ? selectedChunk.headingPath.join(" › ") : labels.selectedChunk}</p></div>
          <SourceInspector documentId={documentId} headingPath={selectedChunk.headingPath} pageNumbers={selectedChunk.pageNumbers} parseResult={parseResult} sourceElementIds={selectedChunk.sourceElementIds} triggerLabel={labels.viewSource} />
        </div>
        <div className="p-6"><div className="flex flex-wrap gap-3 font-mono text-xs text-subtle-foreground"><span>{selectedChunk.tokenCount} {labels.token}</span><span>·</span><span>{labels.pages} {selectedChunk.pageNumbers.join(", ") || "—"}</span><span>·</span><span>{selectedChunk.sourceElementIds.length} {labels.elements}</span></div><p className="mt-5 border-t-[1.712px] border-border pt-5 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{selectedChunk.text}</p><dl className="mt-6 grid gap-4 border-t-[1.712px] border-border pt-5 text-xs sm:grid-cols-3"><div><dt className="text-subtle-foreground">{labels.elements}</dt><dd className="mt-1 font-medium text-foreground">{selectedChunk.sourceElementIds.length}</dd></div><div><dt className="text-subtle-foreground">{labels.sourceElements}</dt><dd className="mt-1 break-all font-mono font-medium text-foreground">{selectedChunk.sourceElementIds.join(", ") || "—"}</dd></div><div><dt className="text-subtle-foreground">{labels.chunkId}</dt><dd className="mt-1 break-all font-mono font-medium text-foreground">{selectedChunk.id}</dd></div></dl></div>
      </article>
    </div>
  );
}

function EmbeddingLineage({ chunkCount, run, locale }: { chunkCount: number | null; run: EmbeddingRun | null; locale: AppLocale }) {
  const labels = locale === "tr"
    ? { chunks: "chunk", embeddings: "embedding", input: "Seçili chunk seti", output: "Embedding çıktısı", pending: "Oluşturmaya hazır" }
    : { chunks: "chunks", embeddings: "embeddings", input: "Selected chunk set", output: "Embedding output", pending: "Ready to create" };
  const count = chunkCount ?? run?.embeddingCount ?? null;
  const embeddingCount = run?.embeddingCount ?? null;
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,max-content)_max-content_minmax(0,max-content)] sm:items-center sm:justify-start sm:gap-5" data-testid="embedding-lineage">
      <div className="flex min-w-0 items-center gap-3" data-testid="embedding-primary-result">
        <FileText aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{count ?? "—"} {labels.chunks}</p><p className="mt-1 truncate text-xs text-muted-foreground">{labels.input}</p></div>
      </div>
      <span aria-hidden="true" className="hidden text-center text-lg text-subtle-foreground sm:block">→</span>
      <div className="flex min-w-0 items-center gap-3" data-testid="embedding-output-result">
        <Braces aria-hidden="true" className={`size-5 shrink-0 ${run ? "text-brand" : "text-muted-foreground"}`} />
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{embeddingCount ?? "—"} {labels.embeddings}</p><p className="mt-1 truncate text-xs text-muted-foreground">{run ? labels.output : labels.pending}</p></div>
      </div>
    </div>
  );
}

export type PipelineStage = "both" | "chunking" | "embeddings";

export function ChunkingWorkspace({ locale }: { locale: AppLocale }) {
  return <ChunksPipeline locale={locale} stage="chunking" />;
}

export function EmbeddingWorkspace({ locale, showAction = true }: { locale: AppLocale; showAction?: boolean }) {
  return <ChunksPipeline locale={locale} showAction={showAction} stage="embeddings" />;
}

export function ChunksPipeline({ locale, showAction = true, stage = "both" }: { locale: AppLocale; showAction?: boolean; stage?: PipelineStage }) {
  const { activeDocument, activePipeline, selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId, parseResult, persistenceStatus, chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError, runChunking, runEmbedding } = useDocumentPipeline();
  const [strategy, setStrategy] = useState<ChunkStrategy>("structure_aware");
  const [chunkSize, setChunkSize] = useState(512);
  const [overlap, setOverlap] = useState(64);
  const [reuseNotice, setReuseNotice] = useState<"chunk" | "embedding" | null>(null);
  const labels = Object.assign(locale === "tr" ? {
    strategy: "Strateji ve yapılandırma", chunkSize: "Chunk boyutu", chunkSizeHint: "Retrieval parçasının hedef uzunluğu.", overlap: "Overlap", overlapHint: "Komşu parçalar arasında korunan token.", runChunk: "Chunking'i çalıştır", chunkLocked: "Önce kalıcı document ve parse run gerekir.", chunkEmpty: "Henüz gerçek bir chunk run yok.", chunks: "Chunks", chunk: "Chunk", chunkCount: "total", selectedChunk: "Selected chunk", select: "Select", emptyChunk: "Boş chunk", filter: "Filter chunks", filterPlaceholder: "Filter by section or number", noMatches: "Bu aramaya uyan chunk yok.", pages: "pages", page: "p.", noPage: "Sayfa yok", elements: "elements", sourceElements: "kaynak elementleri", chunkId: "Chunk kimliği", heading: "Heading", token: "tokens", viewSource: "View source", why: "Bu neden önemli?", whyText: "Büyük chunk'lar daha fazla bağlam taşır; küçük chunk'lar retrieval hassasiyetini artırabilir. Seçtiğiniz strateji bu dengeyi belirler.", chunkDescription: "Parse çıktısını aranabilir parçalara dönüştürün.", reuseNotice: "Mevcut artifact yeniden kullanıldı.", embeddingDescription: "Her chunk'ı semantic search için bir vektör temsiline dönüştürür.", embeddingEmpty: "Henüz gerçek bir embedding run yok.", embeddingProgress: "chunk embedding oluşturuluyor; backend batch ilerlemesi yayınlanmadığı için durum belirsizdir.", storage: "Aranabilir depolama", model: "Model", dimensions: "Boyut", count: "Vektör", format: "Format", persistenceUnavailable: "Kalıcı backend kullanılamıyor.", embeddingLocked: "Önce başarılı, güncel bir chunk run gerekir.", create: "Embedding oluştur", creating: "Embedding oluşturuluyor", output: "Çıktı", details: "Teknik ayrıntılar", resultSummary: "RESULT SUMMARY", chunksResult: "CHUNK COUNT", average: "AVG TOKENS", min: "MIN TOKENS", max: "MAX TOKENS", inspector: "Chunk inspector",
  } : {
    strategy: "Strategy & configuration", chunkSize: "Chunk size", chunkSizeHint: "Target length of each retrieval unit.", overlap: "Overlap", overlapHint: "Tokens preserved between neighboring chunks.", runChunk: "Run chunking", chunkLocked: "A persisted document and parse run are required first.", chunkEmpty: "No real chunk run exists yet.", chunks: "Chunks", chunk: "Chunk", chunkCount: "total", selectedChunk: "Selected chunk", select: "Select", emptyChunk: "Empty chunk", filter: "Filter chunks", filterPlaceholder: "Filter by section or number", noMatches: "No chunks match this search.", pages: "pages", page: "p.", noPage: "No page", elements: "elements", sourceElements: "source elements", chunkId: "Chunk ID", heading: "Heading", token: "tokens", viewSource: "View source", why: "Why this matters", whyText: "Larger chunks preserve more context, but may reduce retrieval precision. Smaller chunks can improve precision but may lose surrounding context.", chunkDescription: "Turn parsed output into searchable units.", reuseNotice: "The existing artifact was reused.", embeddingDescription: "Turns each chunk into a vector representation for semantic search.", embeddingEmpty: "No real embedding run exists yet.", embeddingProgress: "chunks are being embedded; progress is indeterminate because the backend does not publish batch counts.", storage: "Searchable storage", model: "Model", dimensions: "Dimensions", count: "Vectors", format: "Format", persistenceUnavailable: "The persistence backend is unavailable.", embeddingLocked: "A successful, current chunk run is required first.", create: "Create embeddings", creating: "Creating embeddings", output: "Output", details: "Technical details", resultSummary: "RESULT SUMMARY", chunksResult: "CHUNK COUNT", average: "AVG TOKENS", min: "MIN TOKENS", max: "MAX TOKENS", inspector: "Chunk inspector",
  }, { ready: locale === "tr" ? "pgvector'da saklı" : "Stored in pgvector" });
  const compatibleChunkRuns = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const selectedParseSummary = activeDocument?.parseRuns.find((run) => run.id === selectedParseRunId) ?? null;
  const selectedChunkSummary = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId) ?? null;
  const chunkAvailability = getPipelineAvailability(locale, "chunk", {
    document: activeDocument,
    pipeline: activePipeline,
    selection: { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId },
    parseRun: selectedParseSummary,
    processing: chunkStatus === "processing",
    persistenceStatus,
  });
  const embeddingAvailability = getPipelineAvailability(locale, "embedding", {
    document: activeDocument,
    pipeline: activePipeline,
    selection: { selectedParseRunId, selectedChunkRunId, selectedEmbeddingRunId },
    parseRun: selectedParseSummary,
    chunkRun: selectedChunkSummary,
    processing: embeddingStatus === "processing",
    persistenceStatus,
  });
  const canChunk = chunkAvailability.allowed;
  const canEmbed = embeddingAvailability.allowed && compatibleChunkRuns.some((run) => run.id === selectedChunkRunId);
  const chunkBlocker = chunkAvailability.allowed ? null : chunkAvailability;
  const embeddingBlocker = embeddingAvailability.allowed ? null : embeddingAvailability;
  const selectedChunkCount = chunkRun?.chunkCount ?? activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId)?.chunkCount ?? null;
  const chunks = chunkRun?.chunks ?? [];
  const averageTokens = chunks.length ? Math.round(chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / chunks.length) : "—";
  const minTokens = chunks.length ? Math.min(...chunks.map((chunk) => chunk.tokenCount)) : "—";
  const maxTokens = chunks.length ? Math.max(...chunks.map((chunk) => chunk.tokenCount)) : "—";

  async function handleChunk() {
    const result = await runChunking(strategy, { chunkSizeTokens: chunkSize, overlapTokens: overlap });
    setReuseNotice(result?.reusedArtifact ? "chunk" : null);
  }
  async function handleEmbedding() {
    const result = await runEmbedding();
    setReuseNotice(result?.reusedArtifact ? "embedding" : null);
  }

  if (stage === "embeddings") {
    return (
      <div className="mt-6" data-testid="embeddings-workspace">
        <section className="w-full max-w-[760px] rounded-[14px] border border-border bg-card p-4 sm:w-fit" data-testid="embedding-action-card">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
          {showAction ? <div className="min-w-0 shrink-0">
              <Button aria-busy={embeddingStatus === "processing"} aria-describedby={!canEmbed ? "embedding-run-disabled-reason" : undefined} className="h-9 gap-2 rounded-[9px] px-3.5 text-[13px]" data-testid="embedding-run-action" disabled={!canEmbed} onClick={() => void handleEmbedding()}><Play aria-hidden="true" className="size-3.5" />{embeddingStatus === "processing" ? labels.creating : labels.create}</Button>
            </div> : null}
          <div className="min-w-0 flex-1 sm:border-l sm:border-border sm:pl-5"><EmbeddingLineage chunkCount={selectedChunkCount} locale={locale} run={embeddingRun} /></div>
        </div>
        {!canEmbed && embeddingStatus !== "processing" && embeddingBlocker ? <p className="mt-2 text-xs leading-5 text-muted-foreground" data-testid="embedding-blocker" id="embedding-run-disabled-reason" role="status">{embeddingBlocker.message}</p> : null}
        </section>
        {embeddingStatus === "processing" ? <div className="mt-4 rounded-[10px] border-[1.712px] border-border bg-card p-4 text-xs text-muted-foreground" role="status"><div className="h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full w-1/3 animate-pulse rounded-full bg-brand" /></div><p className="mt-2">{selectedChunkCount ?? "—"} {labels.embeddingProgress}</p></div> : null}
        <PipelineErrorMessage message={embeddingError?.message} />
        {reuseNotice === "embedding" ? <p className="mt-4 rounded-[10px] border border-success-border bg-success-subtle px-3 py-2 text-xs text-success" data-testid="embedding-reuse-notice" role="status"><CheckCircle2 aria-hidden="true" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
        {embeddingRun ? <section className="mt-5" data-testid="embedding-result-details"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">{labels.resultSummary}</p><dl className="mt-2 grid gap-3 border-y border-border py-2.5 sm:grid-cols-3"><div><dt className="text-[10px] uppercase tracking-[0.04em] text-subtle-foreground">{labels.count}</dt><dd className="mt-0.5 text-lg font-semibold leading-6 text-foreground">{embeddingRun.embeddingCount}</dd></div><div><dt className="text-[10px] uppercase tracking-[0.04em] text-subtle-foreground">{labels.model}</dt><dd className="mt-0.5 break-words text-[13px] font-medium text-foreground">{embeddingRun.model || "Gemini Embedding"}</dd></div><div><dt className="text-[10px] uppercase tracking-[0.04em] text-subtle-foreground">{labels.dimensions}</dt><dd className="mt-0.5 text-lg font-semibold leading-6 text-foreground">{embeddingRun.dimensions}</dd></div></dl><details className="mt-3 rounded-[10px] border border-border bg-card" data-testid="embedding-details"><summary className="flex min-h-10 cursor-pointer items-center justify-between gap-3 px-3.5 py-2 text-[12.5px] font-medium text-foreground">{labels.details}<span aria-hidden="true" className="text-subtle-foreground">⌄</span></summary><div className="border-t border-border p-3.5"><dl className="grid gap-3 text-xs sm:grid-cols-3"><div><dt className="text-subtle-foreground">{labels.storage}</dt><dd className="mt-1 font-medium">{labels.ready}</dd></div><div><dt className="text-subtle-foreground">{locale === "tr" ? "Provenance" : "Provenance"}</dt><dd className="mt-1 font-medium">{locale === "tr" ? "Mevcut chunk run" : "Current chunk run"}</dd></div><div><dt className="text-subtle-foreground">{labels.format}</dt><dd className="mt-1 break-words font-medium">{embeddingRun.embeddingFormatVersion}</dd></div></dl></div></details></section> : null}
      </div>
    );
  }

  return (
    <div className="mt-6" data-testid="chunking-workspace">
      <section className="rounded-[14px] border border-border bg-card p-4" data-testid="chunking-config-card">
        <div className="grid xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="min-w-0 xl:pr-5">
            <h2 className="text-base font-semibold leading-[22px] text-foreground">{labels.strategy}</h2>
            <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{labels.chunkDescription}</p>
            <div aria-label={labels.strategy} className="mt-3 inline-flex max-w-full flex-wrap items-center gap-1 rounded-[10px] border border-border bg-secondary p-1" role="radiogroup">
              {(Object.keys(strategyNames) as ChunkStrategy[]).map((option) => { const selected = strategy === option; return <button aria-checked={selected} className={`h-9 rounded-[7px] px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 ${selected ? "bg-card text-accent-foreground shadow-sm" : "text-muted-foreground hover:bg-card/70 hover:text-foreground"}`} key={option} tabIndex={selected ? 0 : -1} onKeyDown={(event) => {
                const options = Object.keys(strategyNames) as ChunkStrategy[];
                const offset = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
                if (!offset) return;
                event.preventDefault();
                const next = (options.indexOf(option) + offset + options.length) % options.length;
                setStrategy(options[next]);
                (event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next])?.focus();
              }} onClick={() => setStrategy(option)} role="radio" type="button"><span>{strategyNames[option][locale]}</span><span className="sr-only">{selected ? "selected" : ""}</span></button>; })}
            </div>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{strategyNotes[strategy][locale]}</p>
          </div>
          <div className="mt-4 min-w-0 border-t border-border pt-4 xl:mt-0 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
            <div className="flex flex-wrap items-end gap-3" data-testid="chunk-compact-controls">
              <label className="min-w-[160px] flex-1 text-[12.5px] font-medium text-foreground xl:max-w-[220px]" htmlFor="chunk-size">{labels.chunkSize}<span className="mt-0.5 block text-xs font-normal leading-4 text-subtle-foreground" title={labels.chunkSizeHint}>{labels.chunkSizeHint}</span><span className="relative mt-1.5 block"><Input className="h-9 rounded-[9px] border-input pr-12 text-[13px] shadow-none" id="chunk-size" max={4096} min={32} onChange={(event) => setChunkSize(Number(event.target.value))} type="number" value={chunkSize} /><span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-subtle-foreground">tokens</span></span></label>
              <label className="min-w-[160px] flex-1 text-[12.5px] font-medium text-foreground xl:max-w-[220px]" htmlFor="chunk-overlap">{labels.overlap}<span className="mt-0.5 block text-xs font-normal leading-4 text-subtle-foreground" title={labels.overlapHint}>{labels.overlapHint}</span><span className="relative mt-1.5 block"><Input className="h-9 rounded-[9px] border-input pr-12 text-[13px] shadow-none" id="chunk-overlap" max={1024} min={0} onChange={(event) => setOverlap(Number(event.target.value))} type="number" value={overlap} /><span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10.5px] text-subtle-foreground">tokens</span></span></label>
              <Button aria-describedby={!canChunk ? "chunk-disabled-reason" : undefined} aria-busy={chunkStatus === "processing"} className="h-9 gap-2 rounded-[9px] px-3.5 text-[13px]" data-testid="chunking-run-action" disabled={!canChunk || overlap >= chunkSize} onClick={() => void handleChunk()}><Play aria-hidden="true" className="size-3.5" />{labels.runChunk}</Button>
            </div>
            {chunkRun ? <p className="mt-2 text-[11.5px] text-muted-foreground">Last run · {strategyNames[chunkRun.strategy][locale]} · {typeof chunkRun.config.chunkSizeTokens === "number" ? Number(chunkRun.config.chunkSizeTokens) : chunkSize} tokens</p> : null}
            {!canChunk ? <p className="mt-2 text-xs leading-5 text-muted-foreground" id="chunk-disabled-reason">{chunkBlocker?.code === "missing_document" || chunkBlocker?.code === "missing_parse" ? labels.chunkLocked : chunkBlocker?.message ?? labels.chunkLocked}</p> : null}{overlap >= chunkSize ? <p className="mt-2 text-xs text-destructive" role="alert">Overlap must be smaller than the chunk target.</p> : null}<PipelineErrorMessage message={chunkError?.message} />{reuseNotice === "chunk" ? <p className="mt-3 rounded-[10px] border border-success-border bg-success-subtle px-3 py-2 text-xs text-success" data-testid="chunk-reuse-notice" role="status"><CheckCircle2 aria-hidden="true" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
          </div>
        </div>
      </section>
      <div className="mt-3"><LearningHint locale={locale}>{labels.whyText}</LearningHint></div>
      {chunkRun ? <section className="mt-8" data-testid="chunk-results"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle-foreground">{labels.resultSummary}</p><dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-3 sm:grid-cols-4"><div><dt className="text-[11px] uppercase tracking-[0.04em] text-subtle-foreground">{labels.chunksResult}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-foreground">{chunkRun.chunkCount}</dd></div><div><dt className="text-[11px] uppercase tracking-[0.04em] text-subtle-foreground">{labels.average}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-foreground">{averageTokens}</dd></div><div><dt className="text-[11px] uppercase tracking-[0.04em] text-subtle-foreground">{labels.min}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-foreground">{minTokens}</dd></div><div><dt className="text-[11px] uppercase tracking-[0.04em] text-subtle-foreground">{labels.max}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-foreground">{maxTokens}</dd></div></dl><div className="mt-7"><h2 className="text-base font-semibold leading-[22px]">{labels.inspector}</h2><div className="mt-4"><ChunkInspector documentId={activeDocument?.id ?? null} labels={labels} parseResult={parseResult} run={chunkRun} /></div></div></section> : null}
      {stage === "both" && <div className="mt-4"><Button disabled={!canEmbed} onClick={() => void handleEmbedding()}>{locale === "tr" ? "Embedding oluştur" : "Create embeddings"}</Button></div>}
    </div>
  );
}
