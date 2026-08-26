"use client";

import { useState } from "react";
import { Braces, CheckCircle2, Database, Play } from "lucide-react";
import { motion } from "motion/react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState, LearningHint, PipelineErrorMessage, RunMetadata, StageSection } from "@/components/pipeline-learning-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppLocale } from "@/lib/copy";
import type { ChunkItem, ChunkRun, ChunkStrategy, EmbeddingRun } from "@/lib/rag-api-types";
import { firstBlocker } from "@/lib/blockers";

const strategyNotes: Record<ChunkStrategy, { en: string; tr: string }> = {
  fixed_token: {
    en: "Deterministic token windows. Simple baseline; structure can be split.",
    tr: "Deterministik token pencereleri. Basit baseline; yapı bölünebilir.",
  },
  recursive_token: {
    en: "Recursively prefers larger text boundaries before token fallback.",
    tr: "Token fallback öncesinde büyük metin sınırlarını özyinelemeli olarak korur.",
  },
  structure_aware: {
    en: "Uses ordered parsed elements and heading provenance before token limits.",
    tr: "Token limitlerinden önce sıralı parse elementlerini ve başlık provenance'ını kullanır.",
  },
};

function ChunkInspector({ run, labels }: { run: ChunkRun; labels: Record<string, string> }) {
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(run.chunks[0]?.id ?? null);

  const selectedChunk = run.chunks.find((chunk) => chunk.id === selectedChunkId) ?? run.chunks[0];
  if (!selectedChunk) return <EmptyPipelineState>{labels.chunkEmpty}</EmptyPipelineState>;

  function chunkPreview(chunk: ChunkItem) {
    return chunk.text.replace(/\s+/g, " ").trim().slice(0, 96) || labels.emptyChunk;
  }

  return (
    <div className="grid min-w-0 overflow-hidden border border-[#e7e2e4] bg-white lg:grid-cols-[280px_minmax(0,1fr)]" data-testid="chunk-inspector">
      <aside className="min-w-0 border-b border-[#e7e2e4] bg-[#fbfafb] lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between gap-3 border-b border-[#e7e2e4] px-4 py-3">
          <div><p className="text-xs font-semibold text-[#171416]">{labels.chunks}</p><p className="mt-1 text-[11px] text-[#969093]">{run.chunkCount} {labels.chunkCount}</p></div>
          <span className="text-[11px] font-medium text-[#711f3a]">{labels.select}</span>
        </div>
        <div className="max-h-[560px] space-y-1 overflow-y-auto p-2" role="list" aria-label={labels.chunks}>
          {run.chunks.map((chunk) => {
            const selected = chunk.id === selectedChunk.id;
            return (
              <button
                aria-pressed={selected}
                className={`block w-full border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25 ${selected ? "border-[#d8b5c2] bg-[#fbf4f6]" : "border-transparent hover:border-[#e7e2e4] hover:bg-white"}`}
                data-testid="chunk-list-item"
                key={chunk.id}
                onClick={() => setSelectedChunkId(chunk.id)}
                type="button"
              >
                <span className="flex items-center justify-between gap-2"><span className={`text-xs font-semibold ${selected ? "text-[#711f3a]" : "text-[#171416]"}`}>{labels.chunk} {chunk.ordinal}</span><span className="text-[10px] text-[#969093]">{chunk.tokenCount} {labels.token}</span></span>
                <span className="mt-2 block truncate text-[11px] leading-4 text-[#6e676a]">{chunkPreview(chunk)}</span>
                <span className="mt-2 block text-[10px] text-[#969093]">{chunk.pageNumbers.length ? `${labels.page} ${chunk.pageNumbers.join(", ")}` : labels.noPage}</span>
              </button>
            );
          })}
        </div>
      </aside>
      <article className="min-w-0" data-testid="chunk-inspector-detail">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e7e2e4] px-4 py-4 sm:px-6">
          <div><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.selectedChunk}</p><h3 className="mt-1 text-base font-semibold text-[#171416]">{labels.chunk} {selectedChunk.ordinal}</h3></div>
          <span className="rounded-full border border-[#d8b5c2] bg-[#fbf4f6] px-2.5 py-1 text-[11px] font-medium text-[#711f3a]">{selectedChunk.tokenCount} {labels.token}</span>
        </div>
        <div className="p-4 sm:p-6">
          <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[#171416]">{selectedChunk.text}</p>
          <dl className="mt-6 grid gap-4 border-t border-[#e7e2e4] pt-5 text-xs sm:grid-cols-3">
            <div><dt className="text-[#969093]">{labels.pages}</dt><dd className="mt-1 font-medium text-[#171416]">{selectedChunk.pageNumbers.join(", ") || "—"}</dd></div>
            <div><dt className="text-[#969093]">{labels.elements}</dt><dd className="mt-1 font-medium text-[#171416]">{selectedChunk.sourceElementIds.length} {labels.sourceElements}</dd></div>
            <div><dt className="text-[#969093]">{labels.heading}</dt><dd className="mt-1 break-words font-medium text-[#171416]">{selectedChunk.headingPath.join(" › ") || "—"}</dd></div>
          </dl>
          <details className="mt-5 border-t border-[#e7e2e4] pt-4">
            <summary className="cursor-pointer text-xs font-medium text-[#6e676a]">{labels.technical}</summary>
            <div className="mt-3 space-y-2 font-mono text-[10px] leading-4 text-[#6e676a]"><p className="break-all">{labels.chunkId}: {selectedChunk.id}</p><p>{labels.characters}: {selectedChunk.characterCount}</p><p>{labels.sourceIds}: {selectedChunk.sourceElementIds.join(", ") || "—"}</p></div>
          </details>
        </div>
      </article>
    </div>
  );
}

function EmbeddingLineage({ chunkCount, run, locale, labels }: { chunkCount: number | null; run: EmbeddingRun | null; locale: AppLocale; labels: Record<string, string> }) {
  const count = run?.embeddingCount ?? chunkCount;
  return (
    <section className="border border-[#e7e2e4] bg-white" data-testid="embedding-lineage">
      <div className="border-b border-[#e7e2e4] px-4 py-4 sm:px-6"><h3 className="text-sm font-semibold text-[#171416]">{labels.lineageTitle}</h3><p className="mt-1 text-xs leading-5 text-[#6e676a]">{labels.lineageDescription}</p></div>
      <div className="grid divide-y divide-[#e7e2e4] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-4 sm:p-5"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.input}</p><p className="mt-3 text-2xl font-semibold text-[#171416]">{chunkCount ?? "—"}</p><p className="mt-1 text-xs text-[#6e676a]">{labels.chunks}</p></div>
        <div className="p-4 sm:p-5"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.model}</p><p className="mt-3 break-words text-sm font-semibold text-[#171416]">{run?.model || labels.waiting}</p><p className="mt-1 text-xs text-[#6e676a]">{locale === "tr" ? "Embedding üretimi" : "Embedding generation"}</p></div>
        <div className="p-4 sm:p-5"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.output}</p><p className="mt-3 text-2xl font-semibold text-[#711f3a]">{count ?? "—"}</p><p className="mt-1 text-xs text-[#6e676a]">{labels.searchableVectors}</p></div>
      </div>
    </section>
  );
}

export type PipelineStage = "both" | "chunking" | "embeddings";

export function ChunkingWorkspace({ locale }: { locale: AppLocale }) {
  return <ChunksPipeline locale={locale} stage="chunking" />;
}

export function EmbeddingWorkspace({ locale }: { locale: AppLocale }) {
  return <ChunksPipeline locale={locale} stage="embeddings" />;
}

export function ChunksPipeline({ locale, stage = "both" }: { locale: AppLocale; stage?: PipelineStage }) {
  const {
    activeDocument,
    selectedParseRunId,
    selectedChunkRunId,
    parseResult,
    capabilities,
    persistenceStatus,
    chunkStatus,
    chunkRun,
    chunkError,
    embeddingStatus,
    embeddingRun,
    embeddingError,
    runChunking,
    runEmbedding,
  } = useDocumentPipeline();
  const [strategy, setStrategy] = useState<ChunkStrategy>("structure_aware");
  const [chunkSize, setChunkSize] = useState(512);
  const [overlap, setOverlap] = useState(64);
  const [reuseNotice, setReuseNotice] = useState<"chunk" | "embedding" | null>(null);
  const labels = locale === "tr" ? {
    chunkTitle: "Chunking deneyi",
    chunkDescription: "Canonical ordered parse elementlerinden gerçek chunk'lar üretir; her chunk kaynak element ve sayfalarını korur.",
    strategy: "Strateji", chunkSize: "Chunk token hedefi", overlap: "Overlap token", runChunk: "Chunk oluştur", currentRun: "Seçili sonuç", newRun: "Yeni run ayarları",
    chunkLocked: "Önce kalıcı document ve parse run gerekir.", chunkEmpty: "Henüz gerçek bir chunk run yok.",
    chunks: "Üretilen chunk'lar", chunk: "Chunk", chunkCount: "chunk", selectedChunk: "Seçili chunk", select: "Seçim", emptyChunk: "Boş chunk", pages: "Sayfalar", page: "Sayfa", noPage: "Sayfa yok", elements: "Kaynak elementler", sourceElements: "kaynak elementi", sourceIds: "Kaynak element ID'leri", heading: "Başlık yolu", token: "token", characters: "karakter", technical: "Teknik ayrıntılar",
    embeddingTitle: "Embed + Index",
    embeddingDescription: "Chunk'ları semantic search için vektörleştirir ve pgvector üzerinde aranabilir hâle getirir.",
    runEmbedding: "Embedding oluştur", embeddingLocked: "Önce başarılı, güncel bir chunk run gerekir.", embeddingEmpty: "Henüz gerçek bir embedding run yok.",
    model: "Model", dimensions: "Boyut", count: "Vektör", format: "Format", input: "Girdi", output: "Çıktı", waiting: "Bekleniyor", searchableVectors: "aranabilir pgvector kaydı", lineageTitle: "Chunk → embedding → aranabilir vektörler", lineageDescription: "Her gerçek chunk için bir embedding üretimi ve pgvector üzerinde aranabilir kayıt tutulur.", persistenceUnavailable: "Kalıcı backend kullanılamıyor.", reuseNotice: "Mevcut artifact yeniden kullanıldı.", embeddingProgress: "chunk embedding oluşturuluyor; backend batch ilerlemesi yayınlamadığı için durum belirsizdir.",
  } : {
    chunkTitle: "Chunking experiment",
    chunkDescription: "Creates real chunks from canonical ordered parse elements while preserving source elements and pages.",
    strategy: "Strategy", chunkSize: "Chunk token target", overlap: "Overlap tokens", runChunk: "Create chunks", currentRun: "Selected result", newRun: "New run settings",
    chunkLocked: "A persisted document and parse run are required first.", chunkEmpty: "No real chunk run exists yet.",
    chunks: "Generated chunks", chunk: "Chunk", chunkCount: "chunks", selectedChunk: "Selected chunk", select: "Selection", emptyChunk: "Empty chunk", pages: "Pages", page: "Page", noPage: "No page", elements: "Source elements", sourceElements: "source elements", sourceIds: "Source element IDs", heading: "Heading path", token: "tokens", characters: "characters", technical: "Technical details",
    embeddingTitle: "Embed + Index",
    embeddingDescription: "Turns chunks into vectors for semantic search and stores them in pgvector.",
    runEmbedding: "Create embeddings", embeddingLocked: "A successful, current chunk run is required first.", embeddingEmpty: "No real embedding run exists yet.",
    model: "Model", dimensions: "Dimensions", count: "Vectors", input: "Input", output: "Output", waiting: "Waiting", searchableVectors: "searchable pgvector records", lineageTitle: "Chunks → embeddings → searchable vectors", lineageDescription: "Each real chunk produces an embedding record that can be searched in pgvector.", format: "Format", persistenceUnavailable: "The persistence backend is unavailable.", reuseNotice: "The existing artifact was reused.", embeddingProgress: "chunks are being embedded; progress is indeterminate because the backend does not publish batch counts.",
  };
  const compatibleChunkRuns = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const canChunk = Boolean(activeDocument?.id && selectedParseRunId && persistenceStatus === "available" && chunkStatus !== "processing");
  const canEmbed = Boolean(activeDocument?.id && compatibleChunkRuns.some((run) => run.id === selectedChunkRunId) && embeddingStatus !== "processing");
  const chunkBlocker = firstBlocker(locale, [[chunkStatus === "processing", "processing"], [persistenceStatus === "unavailable", "backend_unavailable"], [!activeDocument?.id, "missing_document"], [!selectedParseRunId, "missing_parse"]]);
  const embeddingBlocker = firstBlocker(locale, [[embeddingStatus === "processing", "processing"], [!activeDocument?.id, "missing_document"], [!selectedChunkRunId, "missing_chunk"], [Boolean(selectedChunkRunId) && !compatibleChunkRuns.some((run) => run.id === selectedChunkRunId), "incompatible_lineage"]]);
  const selectedChunkCount = chunkRun?.chunkCount ?? activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId)?.chunkCount ?? null;

  async function handleChunk() {
    const result = await runChunking(strategy, { chunkSizeTokens: chunkSize, overlapTokens: overlap });
    setReuseNotice(result?.reusedArtifact ? "chunk" : null);
  }

  async function handleEmbedding() {
    const result = await runEmbedding();
    setReuseNotice(result?.reusedArtifact ? "embedding" : null);
  }

  return (
    <div className="min-w-0">
      {stage !== "embeddings" ? <StageSection description={labels.chunkDescription} locale={locale} status={chunkStatus} title={labels.chunkTitle}>
        <LearningHint locale={locale}>{locale === "tr" ? "Chunking, parse edilmiş içeriği retrieval sırasında bağımsız adaylara böler. Daha büyük chunk daha fazla bağlam taşır; overlap sınırdaki anlamın korunmasına yardım eder." : "Chunking turns parsed content into retrieval candidates. Larger chunks carry more context; overlap helps preserve meaning across boundaries."}</LearningHint>
        <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
          <section className="min-w-0 border border-[#e7e2e4] bg-white p-4 sm:p-5">
            <div className="border-b border-[#e7e2e4] pb-4"><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.newRun}</p><h3 className="mt-2 text-sm font-semibold text-[#171416]">{labels.strategy}</h3></div>
            <div>
              <label className="mt-4 block text-xs font-medium text-[#171416]" htmlFor="chunk-strategy">{labels.strategy}</label>
              <Select onValueChange={(value) => setStrategy(value as ChunkStrategy)} value={strategy}>
                <SelectTrigger className="mt-2 w-full" id="chunk-strategy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_token">Fixed token — Baseline</SelectItem>
                  <SelectItem value="recursive_token">Recursive text</SelectItem>
                  <SelectItem value="structure_aware">Structure-aware — Recommended</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs leading-5 text-[#6e676a]">{strategyNotes[strategy][locale]}</p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="text-xs font-medium text-[#171416]" htmlFor="chunk-size">{labels.chunkSize}<Input className="mt-2" id="chunk-size" max={4096} min={32} onChange={(event) => setChunkSize(Number(event.target.value))} type="number" value={chunkSize} /></label>
              <label className="text-xs font-medium text-[#171416]" htmlFor="chunk-overlap">{labels.overlap}<Input className="mt-2" id="chunk-overlap" max={1024} min={0} onChange={(event) => setOverlap(Number(event.target.value))} type="number" value={overlap} /></label>
            </div>
            <Button aria-describedby={!canChunk ? "chunk-disabled-reason" : undefined} aria-busy={chunkStatus === "processing"} className="mt-5 w-full gap-2" disabled={!canChunk || overlap >= chunkSize} onClick={() => void handleChunk()}>
              <Play aria-hidden="true" className="size-4" />{labels.runChunk}
            </Button>
            {!canChunk ? <DisabledReason id="chunk-disabled-reason">{chunkBlocker?.code === "missing_document" || chunkBlocker?.code === "missing_parse" ? labels.chunkLocked : chunkBlocker?.message ?? labels.chunkLocked}</DisabledReason> : null}
            {overlap >= chunkSize ? <p className="mt-2 text-xs text-[#a23b3b]" role="alert">Overlap must be smaller than the chunk target.</p> : null}
            <div className="mt-3"><PipelineErrorMessage message={chunkError?.message} /></div>
            {reuseNotice === "chunk" ? <p className="mt-3 border border-[#c6ddcc] bg-[#eef4ef] px-3 py-2 text-xs text-[#3f7a55]" data-testid="chunk-reuse-notice" role="status"><CheckCircle2 aria-hidden="true" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
          </section>
          <section className="min-w-0">
            {chunkRun ? (
              <>
                <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.currentRun}</p><h3 className="mt-1 text-sm font-semibold text-[#171416]">{labels.chunks}</h3></div><span className="text-xs text-[#6e676a]">{chunkRun.chunkCount} {labels.chunkCount}</span></div>
                <RunMetadata locale={locale} run={chunkRun} />
                <div className="mt-4"><ChunkInspector key={chunkRun.id} labels={labels} run={chunkRun} /></div>
              </>
            ) : <EmptyPipelineState>{parseResult && !activeDocument ? labels.chunkLocked : labels.chunkEmpty}</EmptyPipelineState>}
          </section>
        </div>
      </StageSection> : null}

      {stage !== "chunking" ? <StageSection description={labels.embeddingDescription} locale={locale} status={embeddingStatus} title={labels.embeddingTitle}>
        <LearningHint locale={locale}>{locale === "tr" ? "Chunk'lar → Gemini embedding modeli → aynı sayıda vector → pgvector'da aranabilir kayıtlar. Bu stage ayrı bir ANN/HNSW lifecycle iddia etmez." : "Chunks → Gemini embedding model → the same number of vectors → searchable pgvector records. This stage does not claim a separate ANN/HNSW lifecycle."}</LearningHint>
        <div className="mt-5 space-y-5">
          <EmbeddingLineage chunkCount={selectedChunkCount} labels={labels} locale={locale} run={embeddingRun} />
          <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)]">
            <section className="border border-[#e7e2e4] bg-white p-4 sm:p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.newRun}</p>
              <Button aria-describedby={!canEmbed ? "embedding-disabled-reason" : undefined} aria-busy={embeddingStatus === "processing"} className="mt-4 w-full gap-2" disabled={!canEmbed} onClick={() => void handleEmbedding()}>
              <Braces aria-hidden="true" className="size-4" />{labels.runEmbedding}
              </Button>
              {!canEmbed ? <DisabledReason id="embedding-disabled-reason">{embeddingBlocker?.code === "missing_document" || embeddingBlocker?.code === "missing_chunk" ? labels.embeddingLocked : embeddingBlocker?.message ?? labels.embeddingLocked}</DisabledReason> : null}
              <div className="mt-3"><PipelineErrorMessage message={embeddingError?.message} /></div>
              {embeddingStatus === "processing" ? <div className="mt-3 border border-[#e7e2e4] bg-[#fbfafb] p-3 text-xs text-[#6e676a]" role="status"><div className="h-1.5 overflow-hidden rounded-full bg-[#e7e2e4]"><motion.div animate={{ x: ["-100%", "250%"] }} className="h-full w-1/3 rounded-full bg-[#711f3a]" transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity }} /></div><p className="mt-2">{selectedChunkCount ?? "—"} {labels.embeddingProgress}</p></div> : null}
              {reuseNotice === "embedding" ? <p className="mt-3 border border-[#c6ddcc] bg-[#eef4ef] px-3 py-2 text-xs text-[#3f7a55]" data-testid="embedding-reuse-notice" role="status"><CheckCircle2 aria-hidden="true" className="mr-1 inline size-3.5" />{labels.reuseNotice}</p> : null}
            </section>
            <section className="min-w-0">
              {embeddingRun ? (
                <>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2"><div><p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#969093]">{labels.currentRun}</p><h3 className="mt-1 text-sm font-semibold text-[#171416]">{labels.output}</h3></div><span className="text-xs text-[#6e676a]">{embeddingRun.embeddingCount} {labels.searchableVectors}</span></div>
                  <RunMetadata locale={locale} run={embeddingRun} />
                  <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      [labels.model, embeddingRun.model || capabilities?.embeddingModel || "—"],
                      [labels.dimensions, String(embeddingRun.dimensions)],
                      [labels.count, String(embeddingRun.embeddingCount)],
                      [labels.format, embeddingRun.embeddingFormatVersion],
                    ].map(([label, value]) => <div className="border border-[#e7e2e4] bg-white p-3" key={label}><dt className="text-[11px] text-[#969093]">{label}</dt><dd className="mt-1 break-all text-sm font-medium text-[#171416]">{value}</dd></div>)}
                  </dl>
                </>
              ) : <EmptyPipelineState><Database aria-hidden="true" className="mr-2 size-4" />{labels.embeddingEmpty}</EmptyPipelineState>}
            </section>
          </div>
        </div>
      </StageSection> : null}
    </div>
  );
}
