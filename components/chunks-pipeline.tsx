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
    <div className="grid min-w-0 overflow-hidden rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white lg:grid-cols-[400px_minmax(0,1fr)]" data-testid="chunk-inspector">
      <aside className="min-w-0 border-b-[1.712px] border-[#e7e2e4] bg-white lg:border-b-0 lg:border-r-[1.712px]">
        <div className="border-b-[1.712px] border-[#e7e2e4] px-4 py-3">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-[#171416]">{labels.chunks}</p><p className="mt-1 text-xs text-[#969093]">{run.chunkCount} {labels.chunkCount}</p></div><span className="text-xs text-[#969093]">{labels.select}</span></div>
          <div className="relative mt-3"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#969093]" /><Input aria-label={labels.filter} className="h-[44px] rounded-[10px] border-[#d8d2d5] bg-white pl-9 text-sm shadow-none" data-testid="chunk-filter" onChange={(event) => setQuery(event.target.value)} placeholder={labels.filterPlaceholder} value={query} /></div>
        </div>
        <div className="max-h-[620px] overflow-y-auto" role="list" aria-label={labels.chunks}>
          {visibleChunks.length ? visibleChunks.map((chunk) => {
            const selected = chunk.id === selectedChunk.id;
            const displayOrdinal = chunk.ordinal + 1;
            return <button aria-pressed={selected} className={`block min-h-[70px] w-full border-l-2 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#711f3a]/25 ${selected ? "border-[#711f3a] bg-[#fbf4f6]" : "border-transparent hover:bg-[#fbfafb]"}`} data-testid="chunk-list-item" key={chunk.id} onClick={() => setSelectedChunkId(chunk.id)} type="button"><span className="flex items-center justify-between gap-2"><span className={`text-sm font-medium ${selected ? "text-[#61182f]" : "text-[#171416]"}`}>{String(displayOrdinal).padStart(2, "0")} &nbsp;{chunk.headingPath.at(-1) || `${labels.chunk} ${displayOrdinal}`}</span><span className="font-mono text-xs text-[#969093]">{chunk.tokenCount}</span></span><span className="mt-1 block truncate text-xs leading-[18px] text-[#969093]">{chunk.headingPath.length ? `${chunk.headingPath.join(" › ")} · ` : ""}{chunk.pageNumbers.length ? `${labels.page} ${chunk.pageNumbers.join(", ")}` : labels.noPage}</span></button>;
          }) : <p className="px-4 py-6 text-center text-xs leading-5 text-[#6e676a]">{labels.noMatches}</p>}
        </div>
      </aside>
      <article className="min-w-0" data-testid="chunk-inspector-detail">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-[1.712px] border-[#e7e2e4] px-6 py-4">
          <div><span className="inline-flex rounded-[6px] bg-[#f2eff0] px-2 py-1 font-mono text-xs text-[#501329]">{labels.chunk} {selectedChunk.ordinal + 1}</span><p className="mt-3 text-xs text-[#969093]">{selectedChunk.headingPath.length ? selectedChunk.headingPath.join(" › ") : labels.selectedChunk}</p></div>
          <SourceInspector documentId={documentId} headingPath={selectedChunk.headingPath} pageNumbers={selectedChunk.pageNumbers} parseResult={parseResult} sourceElementIds={selectedChunk.sourceElementIds} triggerLabel={labels.viewSource} />
        </div>
        <div className="p-6"><div className="flex flex-wrap gap-3 font-mono text-xs text-[#969093]"><span>{selectedChunk.tokenCount} {labels.token}</span><span>·</span><span>{labels.pages} {selectedChunk.pageNumbers.join(", ") || "—"}</span><span>·</span><span>{selectedChunk.sourceElementIds.length} {labels.elements}</span></div><p className="mt-5 border-t-[1.712px] border-[#e7e2e4] pt-5 whitespace-pre-wrap break-words text-sm leading-6 text-[#171416]">{selectedChunk.text}</p><dl className="mt-6 grid gap-4 border-t-[1.712px] border-[#e7e2e4] pt-5 text-xs sm:grid-cols-3"><div><dt className="text-[#969093]">{labels.pages}</dt><dd className="mt-1 font-medium text-[#171416]">{selectedChunk.pageNumbers.join(", ") || "—"}</dd></div><div><dt className="text-[#969093]">{labels.elements}</dt><dd className="mt-1 font-medium text-[#171416]">{selectedChunk.sourceElementIds.length}</dd></div><div><dt className="text-[#969093]">{labels.heading}</dt><dd className="mt-1 break-words font-medium text-[#171416]">{selectedChunk.headingPath.join(" › ") || "—"}</dd></div></dl></div>
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
    <div className="grid gap-3 border-t border-[#e7e2e4] pt-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center" data-testid="embedding-lineage">
      <div className="flex min-w-0 items-center gap-3" data-testid="embedding-primary-result">
        <FileText aria-hidden="true" className="size-5 shrink-0 text-[#6e676a]" />
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#171416]">{count ?? "—"} {labels.chunks}</p><p className="mt-1 truncate text-xs text-[#6e676a]">{labels.input}</p></div>
      </div>
      <span aria-hidden="true" className="hidden text-center text-lg text-[#969093] sm:block">→</span>
      <div className="flex min-w-0 items-center gap-3" data-testid="embedding-output-result">
        <Braces aria-hidden="true" className={`size-5 shrink-0 ${run ? "text-[#711f3a]" : "text-[#6e676a]"}`} />
        <div className="min-w-0"><p className="truncate text-sm font-semibold text-[#171416]">{embeddingCount ?? "—"} {labels.embeddings}</p><p className="mt-1 truncate text-xs text-[#6e676a]">{run ? labels.output : labels.pending}</p></div>
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
    strategy: "Strateji ve yapılandırma", chunkSize: "Chunk boyutu", chunkSizeHint: "Retrieval parçasının hedef uzunluğu.", overlap: "Overlap", overlapHint: "Komşu parçalar arasında korunan token.", runChunk: "Chunking'i çalıştır", chunkLocked: "Önce kalıcı document ve parse run gerekir.", chunkEmpty: "Henüz gerçek bir chunk run yok.", chunks: "Chunks", chunk: "Chunk", chunkCount: "total", selectedChunk: "Selected chunk", select: "Select", emptyChunk: "Boş chunk", filter: "Filter chunks", filterPlaceholder: "Filter by section or number", noMatches: "Bu aramaya uyan chunk yok.", pages: "pages", page: "p.", noPage: "Sayfa yok", elements: "elements", sourceElements: "kaynak elementi", heading: "Heading", token: "tokens", viewSource: "View source", why: "Bu neden önemli?", whyText: "Büyük chunk'lar daha fazla bağlam taşır; küçük chunk'lar retrieval hassasiyetini artırabilir. Seçtiğiniz strateji bu dengeyi belirler.", chunkDescription: "Parse çıktısını aranabilir parçalara dönüştürün.", reuseNotice: "Mevcut artifact yeniden kullanıldı.", embeddingDescription: "Her chunk'ı semantic search için bir vektör temsiline dönüştürür.", embeddingEmpty: "Henüz gerçek bir embedding run yok.", embeddingProgress: "chunk embedding oluşturuluyor; backend batch ilerlemesi yayınlanmadığı için durum belirsizdir.", storage: "Aranabilir depolama", model: "Model", dimensions: "Boyut", count: "Vektör", format: "Format", persistenceUnavailable: "Kalıcı backend kullanılamıyor.", embeddingLocked: "Önce başarılı, güncel bir chunk run gerekir.", create: "Embedding oluştur", creating: "Embedding oluşturuluyor", output: "Çıktı", details: "Teknik ayrıntılar", resultSummary: "RESULT SUMMARY", chunksResult: "CHUNK COUNT", average: "AVG TOKENS", min: "MIN TOKENS", max: "MAX TOKENS", inspector: "Chunk inspector",
  } : {
    strategy: "Strategy & configuration", chunkSize: "Chunk size", chunkSizeHint: "Target length of each retrieval unit.", overlap: "Overlap", overlapHint: "Tokens preserved between neighboring chunks.", runChunk: "Run chunking", chunkLocked: "A persisted document and parse run are required first.", chunkEmpty: "No real chunk run exists yet.", chunks: "Chunks", chunk: "Chunk", chunkCount: "total", selectedChunk: "Selected chunk", select: "Select", emptyChunk: "Empty chunk", filter: "Filter chunks", filterPlaceholder: "Filter by section or number", noMatches: "No chunks match this search.", pages: "pages", page: "p.", noPage: "No page", elements: "elements", sourceElements: "source elements", heading: "Heading", token: "tokens", viewSource: "View source", why: "Why this matters", whyText: "Larger chunks preserve more context, but may reduce retrieval precision. Smaller chunks can improve precision but may lose surrounding context.", chunkDescription: "Turn parsed output into searchable units.", reuseNotice: "The existing artifact was reused.", embeddingDescription: "Turns each chunk into a vector representation for semantic search.", embeddingEmpty: "No real embedding run exists yet.", embeddingProgress: "chunks are being embedded; progress is indeterminate because the backend does not publish batch counts.", storage: "Searchable storage", model: "Model", dimensions: "Dimensions", count: "Vectors", format: "Format", persistenceUnavailable: "The persistence backend is unavailable.", embeddingLocked: "A successful, current chunk run is required first.", create: "Create embeddings", creating: "Creating embeddings", output: "Output", details: "Technical details", resultSummary: "RESULT SUMMARY", chunksResult: "CHUNK COUNT", average: "AVG TOKENS", min: "MIN TOKENS", max: "MAX TOKENS", inspector: "Chunk inspector",
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
        <section className="rounded-[14px] border border-[#e7e2e4] bg-white p-4">
        {showAction ? <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Button aria-busy={embeddingStatus === "processing"} aria-describedby={!canEmbed ? "embedding-run-disabled-reason" : undefined} className="h-[42px] gap-2 rounded-[10px] px-4 text-sm" data-testid="embedding-run-action" disabled={!canEmbed} onClick={() => void handleEmbedding()}><Play aria-hidden="true" className="size-4" />{embeddingStatus === "processing" ? labels.creating : labels.create}</Button>
            {!canEmbed && embeddingStatus !== "processing" && embeddingBlocker ? <p className="mt-2 text-xs leading-5 text-[#6e676a]" data-testid="embedding-blocker" id="embedding-run-disabled-reason" role="status">{embeddingBlocker.message}</p> : null}
          </div>
        </div> : null}
        <EmbeddingLineage chunkCount={selectedChunkCount} locale={locale} run={embeddingRun} />
        </section>
        {embeddingStatus === "processing" ? <div className="mt-4 rounded-[10px] border-[1.712px] border-[#e7e2e4] bg-white p-4 text-xs text-[#6e676a]" role="status"><div className="h-1.5 overflow-hidden rounded-full bg-[#e7e2e4]"><div className="h-full w-1/3 animate-pulse rounded-full bg-[#711f3a]" /></div><p className="mt-2">{selectedChunkCount ?? "—"} {labels.embeddingProgress}</p></div> : null}
        <PipelineErrorMessage message={embeddingError?.message} />
        {reuseNotice === "embedding" ? <p className="mt-4 rounded-[10px] border border-[#c6ddcc] bg-[#eef4ef] px-3 py-2 text-xs text-[#3f7a55]" data-testid="embedding-reuse-notice" role="status"><CheckCircle2 aria-hidden="true" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
        {embeddingRun ? <section className="mt-6" data-testid="embedding-result-details"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#969093]">{labels.resultSummary}</p><dl className="mt-3 grid gap-4 border-y border-[#e7e2e4] py-3 sm:grid-cols-3"><div><dt className="text-[11px] uppercase tracking-[0.04em] text-[#969093]">{labels.count}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-[#171416]">{embeddingRun.embeddingCount}</dd></div><div><dt className="text-[11px] uppercase tracking-[0.04em] text-[#969093]">{labels.model}</dt><dd className="mt-1 break-words text-sm font-medium text-[#171416]">{embeddingRun.model || "Gemini Embedding"}</dd></div><div><dt className="text-[11px] uppercase tracking-[0.04em] text-[#969093]">{labels.dimensions}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-[#171416]">{embeddingRun.dimensions}</dd></div></dl><details className="mt-4 rounded-[12px] border border-[#e7e2e4] bg-white" data-testid="embedding-details"><summary className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium text-[#171416]">{labels.details}<span aria-hidden="true" className="text-[#969093]">⌄</span></summary><div className="border-t border-[#e7e2e4] p-4"><dl className="grid gap-3 text-xs sm:grid-cols-3"><div><dt className="text-[#969093]">{labels.storage}</dt><dd className="mt-1 font-medium">{labels.ready}</dd></div><div><dt className="text-[#969093]">{locale === "tr" ? "Provenance" : "Provenance"}</dt><dd className="mt-1 font-medium">{locale === "tr" ? "Mevcut chunk run" : "Current chunk run"}</dd></div><div><dt className="text-[#969093]">{labels.format}</dt><dd className="mt-1 break-words font-medium">{embeddingRun.embeddingFormatVersion}</dd></div></dl></div></details></section> : null}
      </div>
    );
  }

  return (
    <div className="mt-6" data-testid="chunking-workspace">
      <section>
        <h2 className="text-base font-semibold leading-[22px] text-[#171416]">{labels.strategy}</h2>
        <p className="mt-2 text-sm leading-[21px] text-[#6e676a]">{labels.chunkDescription}</p>
        <div className="mt-4">
          <div>
            <div aria-label={labels.strategy} className="grid gap-3 md:grid-cols-3" role="radiogroup">
              {(Object.keys(strategyNames) as ChunkStrategy[]).map((option) => { const selected = strategy === option; return <button aria-checked={selected} className={`min-h-[58px] rounded-[12px] border-[1.712px] px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25 ${selected ? "border-[#171416] bg-[#fbf4f6]" : "border-[#e7e2e4] bg-white hover:border-[#d8b5c2]"}`} key={option} onClick={() => setStrategy(option)} role="radio" type="button"><span className={`block text-sm font-semibold ${selected ? "text-[#61182f]" : "text-[#171416]"}`}>{strategyNames[option][locale]}</span><span className="sr-only">{selected ? "selected" : ""}</span></button>; })}
            </div>
            <p className="mt-3 text-xs leading-5 text-[#6e676a]">{strategyNotes[strategy][locale]}</p>
            <div className="mt-6 grid gap-5 md:grid-cols-2"><label className="text-sm font-medium text-[#171416]" htmlFor="chunk-size">{labels.chunkSize}<span className="mt-1 block text-xs font-normal leading-[18px] text-[#6e676a]">{labels.chunkSizeHint}</span><span className="relative mt-2 block"><Input className="h-[44px] rounded-[10px] border-[#d8d2d5] pr-16 shadow-none" id="chunk-size" max={4096} min={32} onChange={(event) => setChunkSize(Number(event.target.value))} type="number" value={chunkSize} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#969093]">tokens</span></span></label><label className="text-sm font-medium text-[#171416]" htmlFor="chunk-overlap">{labels.overlap}<span className="mt-1 block text-xs font-normal leading-[18px] text-[#6e676a]">{labels.overlapHint}</span><span className="relative mt-2 block"><Input className="h-[44px] rounded-[10px] border-[#d8d2d5] pr-16 shadow-none" id="chunk-overlap" max={1024} min={0} onChange={(event) => setOverlap(Number(event.target.value))} type="number" value={overlap} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#969093]">tokens</span></span></label></div>
            <div className="mt-8 flex flex-wrap items-center gap-3"><Button aria-describedby={!canChunk ? "chunk-disabled-reason" : undefined} aria-busy={chunkStatus === "processing"} className="h-[42px] gap-2 rounded-[10px] px-4 text-sm" data-testid="chunking-run-action" disabled={!canChunk || overlap >= chunkSize} onClick={() => void handleChunk()}><Play aria-hidden="true" className="size-4" />{labels.runChunk}</Button>{chunkRun ? <span className="text-xs text-[#6e676a]">Last run · {strategyNames[chunkRun.strategy][locale]} · {typeof chunkRun.config.chunkSizeTokens === "number" ? Number(chunkRun.config.chunkSizeTokens) : chunkSize} tokens</span> : null}</div>
            {!canChunk ? <p className="mt-2 text-xs leading-5 text-[#6e676a]" id="chunk-disabled-reason">{chunkBlocker?.code === "missing_document" || chunkBlocker?.code === "missing_parse" ? labels.chunkLocked : chunkBlocker?.message ?? labels.chunkLocked}</p> : null}{overlap >= chunkSize ? <p className="mt-2 text-xs text-[#a23b3b]" role="alert">Overlap must be smaller than the chunk target.</p> : null}<PipelineErrorMessage message={chunkError?.message} />{reuseNotice === "chunk" ? <p className="mt-3 rounded-[10px] border border-[#c6ddcc] bg-[#eef4ef] px-3 py-2 text-xs text-[#3f7a55]" data-testid="chunk-reuse-notice" role="status"><CheckCircle2 aria-hidden="true" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
          </div>
        </div>
        <div className="mt-5"><LearningHint locale={locale}>{labels.whyText}</LearningHint></div>
      </section>
      {chunkRun ? <section className="mt-8" data-testid="chunk-results"><p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#969093]">{labels.resultSummary}</p><dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-[#e7e2e4] py-3 sm:grid-cols-4"><div><dt className="text-[11px] uppercase tracking-[0.04em] text-[#969093]">{labels.chunksResult}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-[#171416]">{chunkRun.chunkCount}</dd></div><div><dt className="text-[11px] uppercase tracking-[0.04em] text-[#969093]">{labels.average}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-[#171416]">{averageTokens}</dd></div><div><dt className="text-[11px] uppercase tracking-[0.04em] text-[#969093]">{labels.min}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-[#171416]">{minTokens}</dd></div><div><dt className="text-[11px] uppercase tracking-[0.04em] text-[#969093]">{labels.max}</dt><dd className="mt-1 text-[22px] font-semibold leading-7 text-[#171416]">{maxTokens}</dd></div></dl><div className="mt-7"><h2 className="text-base font-semibold leading-[22px]">{labels.inspector}</h2><div className="mt-4"><ChunkInspector documentId={activeDocument?.id ?? null} labels={labels} parseResult={parseResult} run={chunkRun} /></div></div></section> : null}
      {stage === "both" && <div className="mt-4"><Button disabled={!canEmbed} onClick={() => void handleEmbedding()}>{locale === "tr" ? "Embedding oluştur" : "Create embeddings"}</Button></div>}
    </div>
  );
}
