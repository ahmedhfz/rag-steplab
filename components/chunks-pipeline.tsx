"use client";

import { useState } from "react";
import { Braces, Database, Play } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState, LearningHint, PipelineErrorMessage, RunMetadata, StageSection } from "@/components/pipeline-learning-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AppLocale } from "@/lib/copy";
import type { ChunkStrategy } from "@/lib/rag-api-types";
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
    chunks: "Üretilen chunk'lar", pages: "Sayfalar", elements: "Kaynak elementler", heading: "Başlık yolu", token: "token", characters: "karakter",
    embeddingTitle: "Embed + Index",
    embeddingDescription: "Chunk'ları semantic search için vektörleştirir ve pgvector üzerinde aranabilir hâle getirir.",
    runEmbedding: "Embedding oluştur", embeddingLocked: "Önce başarılı, güncel bir chunk run gerekir.", embeddingEmpty: "Henüz gerçek bir embedding run yok.",
    model: "Model", dimensions: "Boyut", count: "Vektör", format: "Format", persistenceUnavailable: "Kalıcı backend kullanılamıyor.", reuseNotice: "Mevcut artifact yeniden kullanıldı.", embeddingProgress: "chunk embedding oluşturuluyor; backend batch ilerlemesi yayınlamadığı için durum belirsizdir.",
  } : {
    chunkTitle: "Chunking experiment",
    chunkDescription: "Creates real chunks from canonical ordered parse elements while preserving source elements and pages.",
    strategy: "Strategy", chunkSize: "Chunk token target", overlap: "Overlap tokens", runChunk: "Create chunks", currentRun: "Selected result", newRun: "New run settings",
    chunkLocked: "A persisted document and parse run are required first.", chunkEmpty: "No real chunk run exists yet.",
    chunks: "Generated chunks", pages: "Pages", elements: "Source elements", heading: "Heading path", token: "tokens", characters: "characters",
    embeddingTitle: "Embed + Index",
    embeddingDescription: "Turns chunks into vectors for semantic search and stores them in pgvector.",
    runEmbedding: "Create embeddings", embeddingLocked: "A successful, current chunk run is required first.", embeddingEmpty: "No real embedding run exists yet.",
    model: "Model", dimensions: "Dimensions", count: "Vectors", format: "Format", persistenceUnavailable: "The persistence backend is unavailable.", reuseNotice: "The existing artifact was reused.", embeddingProgress: "chunks are being embedded; progress is indeterminate because the backend does not publish batch counts.",
  };
  const compatibleChunkRuns = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const canChunk = Boolean(activeDocument?.id && selectedParseRunId && persistenceStatus === "available" && chunkStatus !== "processing");
  const canEmbed = Boolean(activeDocument?.id && compatibleChunkRuns.some((run) => run.id === selectedChunkRunId) && embeddingStatus !== "processing");
  const chunkBlocker = firstBlocker(locale, [[chunkStatus === "processing", "processing"], [persistenceStatus === "unavailable", "backend_unavailable"], [!activeDocument?.id, "missing_document"], [!selectedParseRunId, "missing_parse"]]);
  const embeddingBlocker = firstBlocker(locale, [[embeddingStatus === "processing", "processing"], [!activeDocument?.id, "missing_document"], [!selectedChunkRunId, "missing_chunk"], [Boolean(selectedChunkRunId) && !compatibleChunkRuns.some((run) => run.id === selectedChunkRunId), "incompatible_lineage"]]);

  async function handleChunk() {
    const result = await runChunking(strategy, { chunkSizeTokens: chunkSize, overlapTokens: overlap });
    setReuseNotice(result?.reusedArtifact ? "chunk" : null);
  }

  async function handleEmbedding() {
    const result = await runEmbedding();
    setReuseNotice(result?.reusedArtifact ? "embedding" : null);
  }

  return (
    <div>
      {stage !== "embeddings" ? <StageSection description={labels.chunkDescription} locale={locale} status={chunkStatus} title={labels.chunkTitle}>
        <LearningHint locale={locale}>{locale === "tr" ? "Chunking, parse edilmiş içeriği retrieval sırasında bağımsız adaylara böler. Daha büyük chunk daha fazla bağlam taşır; overlap sınırdaki anlamın korunmasına yardım eder." : "Chunking turns parsed content into retrieval candidates. Larger chunks carry more context; overlap helps preserve meaning across boundaries."}</LearningHint>
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="space-y-4 border p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{labels.newRun}</p>
            <div>
              <label className="text-xs font-medium" htmlFor="chunk-strategy">{labels.strategy}</label>
              <Select onValueChange={(value) => setStrategy(value as ChunkStrategy)} value={strategy}>
                <SelectTrigger className="mt-2" id="chunk-strategy"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_token">Fixed token — Baseline</SelectItem>
                  <SelectItem value="recursive_token">Recursive text</SelectItem>
                  <SelectItem value="structure_aware">Structure-aware — Recommended</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs leading-5 text-slate-500">{strategyNotes[strategy][locale]}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs font-medium" htmlFor="chunk-size">{labels.chunkSize}<Input className="mt-2" id="chunk-size" max={4096} min={32} onChange={(event) => setChunkSize(Number(event.target.value))} type="number" value={chunkSize} /></label>
              <label className="text-xs font-medium" htmlFor="chunk-overlap">{labels.overlap}<Input className="mt-2" id="chunk-overlap" max={1024} min={0} onChange={(event) => setOverlap(Number(event.target.value))} type="number" value={overlap} /></label>
            </div>
            <Button aria-describedby={!canChunk ? "chunk-disabled-reason" : undefined} aria-busy={chunkStatus === "processing"} className="w-full gap-2" disabled={!canChunk || overlap >= chunkSize} onClick={() => void handleChunk()}>
              <Play aria-hidden="true" className="size-4" />{labels.runChunk}
            </Button>
            {!canChunk ? <DisabledReason id="chunk-disabled-reason">{chunkBlocker?.code === "missing_document" || chunkBlocker?.code === "missing_parse" ? labels.chunkLocked : chunkBlocker?.message ?? labels.chunkLocked}</DisabledReason> : null}
            {overlap >= chunkSize ? <p className="text-xs text-red-700" role="alert">Overlap must be smaller than the chunk target.</p> : null}
            <PipelineErrorMessage message={chunkError?.message} />
            {reuseNotice === "chunk" ? <p className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" data-testid="chunk-reuse-notice" role="status">{labels.reuseNotice}</p> : null}
          </div>
          <div className="min-w-0">
            {chunkRun ? (
              <>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{labels.currentRun}</p>
                <RunMetadata locale={locale} run={chunkRun} />
                <h3 className="mt-5 text-sm font-semibold">{labels.chunks} ({chunkRun.chunkCount})</h3>
                <div className="mt-3 max-h-[620px] space-y-2 overflow-y-auto pr-1 technical-scrollbar">
                  <AnimatePresence initial={false}>
                    {chunkRun.chunks.map((chunk) => (
                      <motion.article animate={{ opacity: 1, y: 0 }} className="border p-4" initial={{ opacity: 0, y: 4 }} key={chunk.id} transition={{ duration: 0.14, ease: "easeOut" }}>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span className="font-medium">Chunk {chunk.ordinal}</span>
                          <span>{chunk.tokenCount} {labels.token} · {chunk.characterCount} {labels.characters}</span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{chunk.text}</p>
                        <dl className="mt-3 grid gap-2 border-t pt-3 text-xs sm:grid-cols-3">
                          <div><dt className="text-slate-500">{labels.pages}</dt><dd className="mt-1">{chunk.pageNumbers.join(", ") || "—"}</dd></div>
                          <div><dt className="text-slate-500">{labels.elements}</dt><dd className="mt-1">{chunk.sourceElementIds.length} {locale === "tr" ? "kaynak elementi" : `source element${chunk.sourceElementIds.length === 1 ? "" : "s"}`}</dd></div>
                          <div><dt className="text-slate-500">{labels.heading}</dt><dd className="mt-1">{chunk.headingPath.join(" › ") || "—"}</dd></div>
                        </dl>
                      </motion.article>
                    ))}
                  </AnimatePresence>
                </div>
              </>
            ) : <EmptyPipelineState>{parseResult && !activeDocument ? labels.chunkLocked : labels.chunkEmpty}</EmptyPipelineState>}
          </div>
        </div>
      </StageSection> : null}

      {stage !== "chunking" ? <StageSection description={labels.embeddingDescription} locale={locale} status={embeddingStatus} title={labels.embeddingTitle}>
        <LearningHint locale={locale}>{locale === "tr" ? "Chunk'lar → Gemini embedding modeli → aynı sayıda vector → pgvector'da aranabilir kayıtlar. Bu stage ayrı bir ANN/HNSW lifecycle iddia etmez." : "Chunks → Gemini embedding model → the same number of vectors → searchable pgvector records. This stage does not claim a separate ANN/HNSW lifecycle."}</LearningHint>
        <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <Button aria-describedby={!canEmbed ? "embedding-disabled-reason" : undefined} aria-busy={embeddingStatus === "processing"} className="w-full gap-2" disabled={!canEmbed} onClick={() => void handleEmbedding()}>
              <Braces aria-hidden="true" className="size-4" />{labels.runEmbedding}
            </Button>
            {!canEmbed ? <DisabledReason id="embedding-disabled-reason">{embeddingBlocker?.code === "missing_document" || embeddingBlocker?.code === "missing_chunk" ? labels.embeddingLocked : embeddingBlocker?.message ?? labels.embeddingLocked}</DisabledReason> : null}
            <PipelineErrorMessage message={embeddingError?.message} />
            {embeddingStatus === "processing" ? <div className="mt-3 border p-3 text-xs text-slate-600" role="status"><div className="h-1.5 overflow-hidden rounded bg-slate-200"><motion.div animate={{ x: ["-100%", "250%"] }} className="h-full w-1/3 rounded bg-sky-600" transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity }} /></div><p className="mt-2">{chunkRun?.chunkCount ?? activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId)?.chunkCount ?? "—"} {labels.embeddingProgress}</p></div> : null}
            {reuseNotice === "embedding" ? <p className="border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" data-testid="embedding-reuse-notice" role="status">{labels.reuseNotice}</p> : null}
          </div>
          {embeddingRun ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{labels.currentRun}</p><RunMetadata locale={locale} run={embeddingRun} />
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  [labels.model, embeddingRun.model || capabilities?.embeddingModel || "—"],
                  [labels.dimensions, String(embeddingRun.dimensions)],
                  [labels.count, String(embeddingRun.embeddingCount)],
                  [labels.format, embeddingRun.embeddingFormatVersion],
                ].map(([label, value]) => <div className="border p-3" key={label}><dt className="text-[11px] text-slate-500">{label}</dt><dd className="mt-1 break-all text-sm font-medium">{value}</dd></div>)}
              </dl>
            </div>
          ) : <EmptyPipelineState><Database aria-hidden="true" className="mr-2 size-4" />{labels.embeddingEmpty}</EmptyPipelineState>}
        </div>
      </StageSection> : null}
    </div>
  );
}
