"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ChunkingWorkspace, EmbeddingWorkspace } from "@/components/chunks-pipeline";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState, MetricCard } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import type { AppLocale } from "@/lib/copy";
import type { RunSummary } from "@/lib/rag-api-types";

function runStatusLabel(run: RunSummary, locale: AppLocale) {
  if (run.status === "completed" && run.isCompatible) return locale === "tr" ? "Uyumlu" : "Compatible";
  if (run.status === "completed") return locale === "tr" ? "Uyumsuz" : "Incompatible";
  if (run.status === "running" || run.status === "queued") return locale === "tr" ? "Çalışıyor" : "Running";
  return locale === "tr" ? "Başarısız" : "Failed";
}

function runSelectable(run: RunSummary) {
  return run.status === "completed" && run.isCompatible;
}

function ArtifactHistory({
  title,
  runs,
  selectedId,
  defaultId,
  locale,
  onSelect,
  kind,
}: {
  title: string;
  runs: RunSummary[];
  selectedId: string | null;
  defaultId: string | null | undefined;
  locale: AppLocale;
  onSelect: (id: string) => Promise<void>;
  kind: "chunk" | "embedding";
}) {
  const labels = locale === "tr"
    ? { empty: "Bu upstream için henüz run yok.", selected: "Seçili", active: "Varsayılan", historical: "Geçmiş", status: "Durum", run: "Run", upstream: "Upstream", select: "Seç" }
    : { empty: "No runs exist for this upstream yet.", selected: "Selected", active: "Default", historical: "Historical", status: "Status", run: "Run", upstream: "Upstream", select: "Select" };
  if (!runs.length) return <EmptyPipelineState>{labels.empty}</EmptyPipelineState>;

  return (
    <section className="border-t px-4 py-6 sm:px-7">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4 space-y-2">
        {runs.map((run) => {
          const selectable = runSelectable(run);
          const isSelected = run.id === selectedId;
          return (
            <div className="flex flex-col gap-3 border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`${kind}-history-row`} key={run.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold">{kind === "chunk" ? "Chunk" : "Embedding"} {run.runNumber ?? "—"}</span>
                  {isSelected ? <span className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px]">{labels.selected}</span> : null}
                  {run.id === defaultId ? <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">{labels.active}</span> : null}
                  {run.historicalLineage ? <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">{labels.historical}</span> : null}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500"><span>{labels.status}: {runStatusLabel(run, locale)}</span><span>{labels.upstream}: {Object.values(run.upstream).filter(Boolean).length ? `${Object.values(run.upstream).filter(Boolean).length} ${locale === "tr" ? "artifact" : "artifacts"}` : "—"}</span></div>
                {run.error?.message ? <p className="mt-1 text-xs text-red-700">{run.error.message}</p> : null}
                {!run.isCompatible && run.compatibilityReason ? <p className="mt-1 text-xs text-orange-700">{run.compatibilityReason}</p> : null}
                {kind === "chunk" && run.strategy ? <p className="mt-1 text-[11px] text-slate-500">{run.strategy}{run.chunkCount === null || run.chunkCount === undefined ? "" : ` · ${run.chunkCount} chunks`}</p> : null}
                {kind === "embedding" && run.model ? <p className="mt-1 text-[11px] text-slate-500">{run.model} · {run.dimensions ?? "—"}d · {run.embeddingFormatVersion ?? "—"}{run.effectiveModel && run.effectiveModel !== run.model ? ` · ${run.effectiveModel}` : ""}</p> : null}
              </div>
              <Button disabled={!selectable || isSelected} onClick={() => void onSelect(run.id)} size="sm" variant={isSelected ? "secondary" : "outline"}>{isSelected ? labels.selected : labels.select}</Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ChunkingScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, selectedParseRunId, selectedChunkRunId, chunkRun, selectChunkRun } = useDocumentPipeline();
  const compatibleChunks = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const chunks = chunkRun?.chunks ?? [];
  const averageTokens = chunks.length ? Math.round(chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0) / chunks.length) : 0;
  const labels = locale === "tr"
    ? { title: "Chunking", description: "Parse lineage'ı için strategy, config, chunk preview ve sürüm geçmişini inceleyin.", history: "Chunk version history", next: "Embedding aşamasına git", nextReason: "Önce uyumlu ve tamamlanmış bir chunk run seçin." }
    : { title: "Chunking", description: "Inspect strategy, config, chunk preview, and version history for the selected parse lineage.", history: "Chunk version history", next: "Go to Embeddings", nextReason: "Select a compatible completed chunk run first." };

  return (
    <div>
      <PipelineContextBar />
      <header className="px-4 py-6 sm:px-7"><h1 className="text-[22px] font-semibold tracking-[-0.025em]">{labels.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{labels.description}</p></header>
      <ChunkingWorkspace locale={locale} />
      {chunkRun ? <section className="border-t px-4 py-6 sm:px-7"><h2 className="text-sm font-semibold">{locale === "tr" ? "Chunk metrikleri" : "Chunk metrics"}</h2><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><MetricCard label={locale === "tr" ? "Chunk sayısı" : "Chunks"} value={String(chunkRun.chunkCount)} /><MetricCard label={locale === "tr" ? "Min token" : "Min tokens"} value={chunks.length ? String(Math.min(...chunks.map((chunk) => chunk.tokenCount))) : "—"} /><MetricCard label={locale === "tr" ? "Ortalama token" : "Average tokens"} value={String(averageTokens)} /><MetricCard label={locale === "tr" ? "Max token" : "Max tokens"} value={chunks.length ? String(Math.max(...chunks.map((chunk) => chunk.tokenCount))) : "—"} /></div></section> : null}
      <ArtifactHistory defaultId={activeDocument?.activeChunkRunId} kind="chunk" locale={locale} onSelect={selectChunkRun} runs={activeDocument?.chunkRuns.filter((run) => run.upstream.parseRunId === selectedParseRunId) ?? []} selectedId={selectedChunkRunId} title={labels.history} />
      <section className="border-t px-4 py-6 sm:px-7">{compatibleChunks.some((run) => run.id === selectedChunkRunId) ? <Button asChild size="sm" variant="outline"><Link href="/embeddings">{labels.next}<ArrowRight aria-hidden="true" className="ml-2 size-4" /></Link></Button> : <Button disabled size="sm" variant="outline">{labels.next}</Button>}{!compatibleChunks.some((run) => run.id === selectedChunkRunId) ? <DisabledReason id="chunking-next-disabled-reason">{labels.nextReason}</DisabledReason> : null}</section>
    </div>
  );
}

export function EmbeddingsScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, selectedChunkRunId, selectedEmbeddingRunId, embeddingRun, selectEmbeddingRun } = useDocumentPipeline();
  const labels = locale === "tr"
    ? { title: "Embeddings", description: "Seçili chunk input'u, effective model provenance'ı ve embedding sürümlerini inceleyin.", history: "Embedding version history", input: "Seçili chunk input", noInput: "Embedding için tamamlanmış uyumlu bir chunk seçin.", next: "Playground'a git", nextReason: "Playground için önce tamamlanmış bir chunk run gerekir." }
    : { title: "Embeddings", description: "Inspect the selected chunk input, effective model provenance, and embedding versions.", history: "Embedding version history", input: "Selected chunk input", noInput: "Select a compatible completed chunk before creating embeddings.", next: "Go to Playground", nextReason: "A completed chunk run is required before using Playground." };
  const selectedChunk = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const selectedChunkNumber = selectedChunk?.runNumber ?? 0;
  const selectedParseNumber = selectedChunk?.upstream.parseRunId && activeDocument ? activeDocument.parseRuns.find((run) => run.id === selectedChunk.upstream.parseRunId)?.runNumber ?? 0 : 0;
  const canPlayground = Boolean(activeDocument?.id && selectedChunk?.status === "completed" && selectedChunk.isCompatible && selectedChunkRunId);

  return (
    <div>
      <PipelineContextBar />
      <header className="px-4 py-6 sm:px-7"><h1 className="text-[22px] font-semibold tracking-[-0.025em]">{labels.title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{labels.description}</p></header>
      <section className="border-t px-4 py-5 sm:px-7"><h2 className="text-sm font-semibold">{labels.input}</h2>{selectedChunk ? <p className="mt-2 text-xs text-slate-600" title={selectedChunk.id}>{selectedChunkNumber > 0 ? `C${selectedChunkNumber}` : "C—"} · {selectedChunk.chunkCount ?? "—"} chunks · {selectedParseNumber > 0 ? `P${selectedParseNumber}` : "P—"}</p> : <p className="mt-2 text-sm text-slate-500">{labels.noInput}</p>}</section>
      <EmbeddingWorkspace locale={locale} />
      {embeddingRun ? <section className="border-t px-4 py-5 sm:px-7"><div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><MetricCard label="Model" value={embeddingRun.model || "—"} /><MetricCard label={locale === "tr" ? "Effective model" : "Effective model"} value={embeddingRun.effectiveModel || embeddingRun.model || "—"} /><MetricCard label={locale === "tr" ? "Boyut" : "Dimensions"} value={String(embeddingRun.dimensions)} /><MetricCard label={locale === "tr" ? "Vektör" : "Vectors"} value={String(embeddingRun.embeddingCount)} /><MetricCard label="Format" value={embeddingRun.embeddingFormatVersion} /></div></section> : null}
      <ArtifactHistory defaultId={activeDocument?.activeEmbeddingRunId} kind="embedding" locale={locale} onSelect={selectEmbeddingRun} runs={activeDocument?.embeddingRuns.filter((run) => run.upstream.chunkRunId === selectedChunkRunId) ?? []} selectedId={selectedEmbeddingRunId} title={labels.history} />
      <section className="border-t px-4 py-6 sm:px-7">{canPlayground ? <Button asChild size="sm" variant="outline"><Link href="/playground">{labels.next}<ArrowRight aria-hidden="true" className="ml-2 size-4" /></Link></Button> : <Button disabled size="sm" variant="outline">{labels.next}</Button>}{!canPlayground ? <DisabledReason id="embeddings-next-disabled-reason">{labels.nextReason}</DisabledReason> : null}</section>
    </div>
  );
}
