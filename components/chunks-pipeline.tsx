"use client";

import { useState } from "react";
import { CheckCircle2, Info, Play, Search } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { SourceInspector } from "@/components/source-inspector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppLocale } from "@/lib/copy";
import type { ChunkRun, ChunkStrategy, EmbeddingRun } from "@/lib/rag-api-types";
import { firstBlocker } from "@/lib/blockers";

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

function EmbeddingLineage({ chunkCount, run, locale, model }: { chunkCount: number | null; run: EmbeddingRun | null; locale: AppLocale; model: string }) {
  const labels = locale === "tr" ? { chunks: "chunk", embeddings: "embedding", storage: "Aranabilir depolama", structure: "Yapı farkındalıklı", vectors: "boyutlu vektör", ready: "Vector index hazır" } : { chunks: "chunks", embeddings: "embeddings", storage: "Searchable storage", structure: "Structure-aware", vectors: "-dim vectors", ready: "Vector index ready" };
  const count = chunkCount ?? run?.embeddingCount ?? null;
  const cards = [
    { title: `${count ?? "—"} ${labels.chunks}`, detail: labels.structure, icon: "▤", active: false },
    { title: `${run?.embeddingCount ?? count ?? "—"} ${labels.embeddings}`, detail: run ? `${run.dimensions}${labels.vectors} · ${run.model || model}` : model, icon: "⌘", active: Boolean(run) },
    { title: labels.storage, detail: labels.ready, icon: "◉", active: false },
  ];
  return <div className="grid items-center gap-3 lg:grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)_24px_minmax(0,1fr)]">{cards.map((card, index) => <div className="contents" key={card.title}><article className={`flex h-[122px] flex-col items-center justify-center rounded-[16px] border-[1.712px] bg-white text-center ${card.active ? "border-[#e9a9ba] bg-[#fbf4f6]" : "border-[#e7e2e4]"}`}><span className={`text-xl ${card.active ? "text-[#711f3a]" : "text-[#6e676a]"}`} aria-hidden="true">{card.icon}</span><h3 className="mt-3 text-sm font-semibold text-[#171416]">{card.title}</h3><p className="mt-2 text-xs text-[#6e676a]">{card.detail}</p></article>{index < cards.length - 1 ? <span aria-hidden="true" className="hidden text-center text-lg text-[#969093] lg:block">→</span> : null}</div>)}</div>;
}

export type PipelineStage = "both" | "chunking" | "embeddings";

export function ChunkingWorkspace({ locale }: { locale: AppLocale }) {
  return <ChunksPipeline locale={locale} stage="chunking" />;
}

export function EmbeddingWorkspace({ locale, showAction = true }: { locale: AppLocale; showAction?: boolean }) {
  return <ChunksPipeline locale={locale} showAction={showAction} stage="embeddings" />;
}

export function ChunksPipeline({ locale, showAction = true, stage = "both" }: { locale: AppLocale; showAction?: boolean; stage?: PipelineStage }) {
  const { activeDocument, selectedParseRunId, selectedChunkRunId, parseResult, capabilities, persistenceStatus, chunkStatus, chunkRun, chunkError, embeddingStatus, embeddingRun, embeddingError, runChunking, runEmbedding } = useDocumentPipeline();
  const [strategy, setStrategy] = useState<ChunkStrategy>("structure_aware");
  const [chunkSize, setChunkSize] = useState(512);
  const [overlap, setOverlap] = useState(64);
  const [reuseNotice, setReuseNotice] = useState<"chunk" | "embedding" | null>(null);
  const labels = locale === "tr" ? {
    strategy: "Strateji", chunkSize: "Chunk boyutu", overlap: "Overlap", runChunk: "Create chunks", chunkLocked: "Önce kalıcı document ve parse run gerekir.", chunkEmpty: "Henüz gerçek bir chunk run yok.", chunks: "Chunks", chunk: "Chunk", chunkCount: "total", selectedChunk: "Selected chunk", select: "Select", emptyChunk: "Boş chunk", filter: "Filter chunks", filterPlaceholder: "Filter by section or number", noMatches: "Bu aramaya uyan chunk yok.", pages: "pages", page: "p.", noPage: "Sayfa yok", elements: "elements", sourceElements: "kaynak elementi", heading: "Heading", token: "tokens", viewSource: "View source", why: "Bu neden önemli?", whyText: "Büyük chunk'lar daha fazla bağlam taşır; küçük chunk'lar retrieval hassasiyetini artırabilir. Seçtiğiniz strateji bu dengeyi belirler.", chunkDescription: "Retrieval sırasında aranacak bağımsız birimler oluşturur.", reuseNotice: "Mevcut artifact yeniden kullanıldı.", embeddingDescription: "Her chunk'ı semantic search için bir vektör temsiline dönüştürür.", embeddingEmpty: "Henüz gerçek bir embedding run yok.", embeddingProgress: "chunk embedding oluşturuluyor; backend batch ilerlemesi yayınlanmadığı için durum belirsizdir.", storage: "Aranabilir depolama", model: "Model", dimensions: "Boyut", count: "Vektör", format: "Format", persistenceUnavailable: "Kalıcı backend kullanılamıyor.", embeddingLocked: "Önce başarılı, güncel bir chunk run gerekir.", create: "Embedding oluştur", output: "Çıktı", details: "Embedding details", resultSummary: "RESULT SUMMARY", chunksResult: "CHUNK COUNT", average: "AVG TOKENS", min: "MIN TOKENS", max: "MAX TOKENS", inspector: "Chunk inspector",
  } : {
    strategy: "Strategy", chunkSize: "Chunk size", overlap: "Overlap", runChunk: "Create chunks", chunkLocked: "A persisted document and parse run are required first.", chunkEmpty: "No real chunk run exists yet.", chunks: "Chunks", chunk: "Chunk", chunkCount: "total", selectedChunk: "Selected chunk", select: "Select", emptyChunk: "Empty chunk", filter: "Filter chunks", filterPlaceholder: "Filter by section or number", noMatches: "No chunks match this search.", pages: "pages", page: "p.", noPage: "No page", elements: "elements", sourceElements: "source elements", heading: "Heading", token: "tokens", viewSource: "View source", why: "Why this matters", whyText: "Larger chunks preserve more context, but may reduce retrieval precision. Smaller chunks can improve precision but may lose surrounding context.", chunkDescription: "Creates independent units your retriever can search.", reuseNotice: "The existing artifact was reused.", embeddingDescription: "Turns each chunk into a vector representation for semantic search.", embeddingEmpty: "No real embedding run exists yet.", embeddingProgress: "chunks are being embedded; progress is indeterminate because the backend does not publish batch counts.", storage: "Searchable storage", model: "Model", dimensions: "Dimensions", count: "Vectors", format: "Format", persistenceUnavailable: "The persistence backend is unavailable.", embeddingLocked: "A successful, current chunk run is required first.", create: "Create embeddings", output: "Output", details: "Embedding details", resultSummary: "RESULT SUMMARY", chunksResult: "CHUNK COUNT", average: "AVG TOKENS", min: "MIN TOKENS", max: "MAX TOKENS", inspector: "Chunk inspector",
  };
  const compatibleChunkRuns = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const canChunk = Boolean(activeDocument?.id && selectedParseRunId && persistenceStatus === "available" && chunkStatus !== "processing");
  const canEmbed = Boolean(activeDocument?.id && compatibleChunkRuns.some((run) => run.id === selectedChunkRunId) && embeddingStatus !== "processing");
  const chunkBlocker = firstBlocker(locale, [[chunkStatus === "processing", "processing"], [persistenceStatus === "unavailable", "backend_unavailable"], [!activeDocument?.id, "missing_document"], [!selectedParseRunId, "missing_parse"]]);
  const embeddingBlocker = firstBlocker(locale, [[embeddingStatus === "processing", "processing"], [!activeDocument?.id, "missing_document"], [!selectedChunkRunId, "missing_chunk"], [Boolean(selectedChunkRunId) && !compatibleChunkRuns.some((run) => run.id === selectedChunkRunId), "incompatible_lineage"]]);
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
      <div className="mt-8" data-testid="embeddings-workspace">
        {showAction ? <div className="sr-only"><Button disabled={!canEmbed} onClick={() => void handleEmbedding()}>{labels.create}</Button></div> : null}
        <section>
          <p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-[#969093]">WHAT HAPPENS HERE</p>
          <p className="mt-3 max-w-[700px] text-sm leading-[21px] text-[#6e676a]">{locale === "tr" ? "Her chunk bir embedding vektörüne dönüşür. Bu vektörler sistemin tam anahtar kelimeler yerine anlam üzerinden chunk bulabilmesi için saklanır." : "Each chunk becomes one embedding vector. Those vectors are stored so the system can find chunks by meaning rather than exact keywords."}</p>
          <div className="mt-5"><EmbeddingLineage chunkCount={selectedChunkCount} locale={locale} model={embeddingRun?.model ?? capabilities?.embeddingModel ?? "Gemini Embedding"} run={embeddingRun} /></div>
        </section>
        {embeddingStatus === "processing" ? <div className="mt-4 rounded-[10px] border-[1.712px] border-[#e7e2e4] bg-white p-4 text-xs text-[#6e676a]" role="status"><div className="h-1.5 overflow-hidden rounded-full bg-[#e7e2e4]"><div className="h-full w-1/3 animate-pulse rounded-full bg-[#711f3a]" /></div><p className="mt-2">{selectedChunkCount ?? "—"} {labels.embeddingProgress}</p></div> : null}
        <PipelineErrorMessage message={embeddingError?.message} />
        {!embeddingRun && embeddingStatus !== "processing" && embeddingBlocker ? <p className="sr-only" data-testid="embedding-blocker">{embeddingBlocker.message}</p> : null}
        {reuseNotice === "embedding" ? <p className="mt-4 rounded-[10px] border border-[#c6ddcc] bg-[#eef4ef] px-3 py-2 text-xs text-[#3f7a55]" data-testid="embedding-reuse-notice" role="status"><CheckCircle2 aria-hidden="true" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
        {embeddingRun ? <section className="mt-9"><p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-[#969093]">{labels.resultSummary}</p><dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><div><dt className="text-xs uppercase tracking-[0.48px] text-[#969093]">{labels.model}</dt><dd className="mt-2 text-lg font-semibold text-[#171416]">{embeddingRun.model || "Gemini Embedding"}</dd></div><div><dt className="text-xs uppercase tracking-[0.48px] text-[#969093]">{labels.dimensions}</dt><dd className="mt-2 text-[26px] font-semibold leading-[31px] text-[#171416]">{embeddingRun.dimensions}</dd></div><div><dt className="text-xs uppercase tracking-[0.48px] text-[#969093]">{labels.count}</dt><dd className="mt-2 text-[26px] font-semibold leading-[31px] text-[#171416]">{embeddingRun.embeddingCount}</dd></div><div><dt className="text-xs uppercase tracking-[0.48px] text-[#969093]">{labels.storage}</dt><dd className="mt-2 text-lg font-semibold text-[#171416]">Vector index</dd></div></dl><details className="mt-8 rounded-[12px] border-[1.712px] border-[#e7e2e4] bg-white"><summary className="flex h-[46px] cursor-pointer items-center justify-between px-4 text-[13px] font-medium text-[#171416]">{labels.details}<span aria-hidden="true" className="text-[#969093]">⌄</span></summary><div className="border-t border-[#e7e2e4] p-4"><dl className="grid gap-3 text-xs sm:grid-cols-4"><div><dt className="text-[#969093]">{labels.model}</dt><dd className="mt-1 font-medium">{embeddingRun.model}</dd></div><div><dt className="text-[#969093]">{labels.dimensions}</dt><dd className="mt-1 font-medium">{embeddingRun.dimensions}</dd></div><div><dt className="text-[#969093]">{labels.count}</dt><dd className="mt-1 font-medium">{embeddingRun.embeddingCount}</dd></div><div><dt className="text-[#969093]">{labels.format}</dt><dd className="mt-1 font-medium">{embeddingRun.embeddingFormatVersion}</dd></div></dl></div></details></section> : null}
      </div>
    );
  }

  return (
    <div className="mt-8" data-testid="chunking-workspace">
      <section>
        <p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-[#969093]">{labels.strategy}</p>
        <p className="mt-2 text-sm leading-[21px] text-[#6e676a]">{labels.chunkDescription}</p>
        <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div>
            <div aria-label={labels.strategy} className="grid gap-3 md:grid-cols-3" role="radiogroup">
              {(Object.keys(strategyNames) as ChunkStrategy[]).map((option) => { const selected = strategy === option; return <button aria-checked={selected} className={`min-h-[98px] rounded-[12px] border-[1.712px] px-4 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25 ${selected ? "border-[#171416] bg-[#fbf4f6]" : "border-[#e7e2e4] bg-white hover:border-[#d8b5c2]"}`} key={option} onClick={() => setStrategy(option)} role="radio" type="button"><span className={`block text-sm font-semibold ${selected ? "text-[#61182f]" : "text-[#171416]"}`}>{strategyNames[option][locale]}</span><span className="mt-2 block text-xs leading-[18px] text-[#6e676a]">{strategyNotes[option][locale]}</span><span className="sr-only">{selected ? "selected" : ""}</span></button>; })}
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-2"><label className="text-sm font-medium text-[#171416]" htmlFor="chunk-size">{labels.chunkSize}<span className="mt-1 block text-xs font-normal leading-[18px] text-[#6e676a]">Controls how much text each retrieval unit can contain.</span><span className="relative mt-2 block"><Input className="h-[44px] rounded-[10px] border-[#d8d2d5] pr-16 shadow-none" id="chunk-size" max={4096} min={32} onChange={(event) => setChunkSize(Number(event.target.value))} type="number" value={chunkSize} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#969093]">tokens</span></span></label><label className="text-sm font-medium text-[#171416]" htmlFor="chunk-overlap">{labels.overlap}<span className="mt-1 block text-xs font-normal leading-[18px] text-[#6e676a]">Shared tokens between neighboring chunks to preserve continuity.</span><span className="relative mt-2 block"><Input className="h-[44px] rounded-[10px] border-[#d8d2d5] pr-16 shadow-none" id="chunk-overlap" max={1024} min={0} onChange={(event) => setOverlap(Number(event.target.value))} type="number" value={overlap} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#969093]">tokens</span></span></label></div>
            <div className="mt-10 flex flex-wrap items-center gap-3"><Button aria-describedby={!canChunk ? "chunk-disabled-reason" : undefined} aria-busy={chunkStatus === "processing"} className="h-[42px] gap-2 rounded-[10px] px-4 text-sm" disabled={!canChunk || overlap >= chunkSize} onClick={() => void handleChunk()}><Play aria-hidden="true" className="size-4" />{labels.runChunk}</Button>{chunkRun ? <span className="text-xs text-[#6e676a]">Last run · {strategyNames[chunkRun.strategy][locale]} · {typeof chunkRun.config.chunkSizeTokens === "number" ? Number(chunkRun.config.chunkSizeTokens) : chunkSize} tokens</span> : null}</div>
            {!canChunk ? <p className="mt-2 text-xs leading-5 text-[#6e676a]" id="chunk-disabled-reason">{chunkBlocker?.code === "missing_document" || chunkBlocker?.code === "missing_parse" ? labels.chunkLocked : chunkBlocker?.message ?? labels.chunkLocked}</p> : null}{overlap >= chunkSize ? <p className="mt-2 text-xs text-[#a23b3b]" role="alert">Overlap must be smaller than the chunk target.</p> : null}<PipelineErrorMessage message={chunkError?.message} />{reuseNotice === "chunk" ? <p className="mt-3 rounded-[10px] border border-[#c6ddcc] bg-[#eef4ef] px-3 py-2 text-xs text-[#3f7a55]" data-testid="chunk-reuse-notice" role="status"><CheckCircle2 aria-hidden="true" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
          </div>
          <aside className="mt-[-28px] rounded-[14px] border-[1.712px] border-[#f3d9e0] bg-[#fbf4f6] p-4"><div className="flex items-center gap-3"><Info aria-hidden="true" className="size-4 text-[#711f3a]" /><h3 className="text-sm font-semibold text-[#501329]">{labels.why}</h3></div><p className="mt-3 text-sm leading-[21px] text-[rgba(59,13,29,0.75)]">{labels.whyText}</p></aside>
        </div>
      </section>
      {chunkRun ? <section className="mt-10" data-testid="chunk-results"><p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-[#969093]">RESULTS</p><dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><div><dt className="text-xs uppercase tracking-[0.48px] text-[#969093]">{labels.chunksResult}</dt><dd className="mt-1 text-[26px] font-semibold leading-[31px] text-[#171416]">{chunkRun.chunkCount}</dd></div><div><dt className="text-xs uppercase tracking-[0.48px] text-[#969093]">{labels.average}</dt><dd className="mt-1 text-[26px] font-semibold leading-[31px] text-[#171416]">{averageTokens}</dd></div><div><dt className="text-xs uppercase tracking-[0.48px] text-[#969093]">{labels.min}</dt><dd className="mt-1 text-[26px] font-semibold leading-[31px] text-[#171416]">{minTokens}</dd></div><div><dt className="text-xs uppercase tracking-[0.48px] text-[#969093]">{labels.max}</dt><dd className="mt-1 text-[26px] font-semibold leading-[31px] text-[#171416]">{maxTokens}</dd></div></dl><div className="mt-8"><h2 className="text-base font-semibold leading-[22px]">{labels.inspector}</h2><div className="mt-4"><ChunkInspector documentId={activeDocument?.id ?? null} labels={labels} parseResult={parseResult} run={chunkRun} /></div></div></section> : null}
      {stage === "both" && <div className="sr-only"><Button disabled={!canEmbed} onClick={() => void handleEmbedding()}>{locale === "tr" ? "Embedding oluştur" : "Create embeddings"}</Button></div>}
    </div>
  );
}
