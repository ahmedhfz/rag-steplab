"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ChunkingWorkspace, EmbeddingWorkspace } from "@/components/chunks-pipeline";
import { ConditionalPipelineContextBar } from "@/components/pipeline-context-bar";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason } from "@/components/pipeline-learning-ui";
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
  inspectedId,
  defaultId,
  locale,
  onSelect,
  onUse,
  kind,
}: {
  title: string;
  runs: RunSummary[];
  selectedId: string | null;
  inspectedId?: string | null;
  defaultId: string | null | undefined;
  locale: AppLocale;
  onSelect: (id: string) => Promise<void>;
  onUse?: (id: string) => Promise<boolean>;
  kind: "chunk" | "embedding";
}) {
  const labels = locale === "tr"
    ? { empty: "Bu upstream için henüz run yok.", selected: "Kullanımda", inspected: "İnceleniyor", active: "Varsayılan", historical: "Geçmiş", status: "Durum", upstream: "Upstream", inspect: "İncele", use: "Pipeline'da kullan" }
    : { empty: "No runs exist for this upstream yet.", selected: "In use", inspected: "Inspecting", active: "Default", historical: "Historical", status: "Status", upstream: "Upstream", inspect: "Inspect", use: "Use in pipeline" };
  if (!runs.length) return null;

  return (
    <section className="mt-10" data-testid={`${kind}-history`}>
      <details className="rounded-[12px] border-[1.712px] border-[#e7e2e4] bg-white">
        <summary className="flex h-[46px] cursor-pointer list-none items-center justify-between px-4 text-[13px] font-medium text-[#171416] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#711f3a]/25 sm:px-5">
          <span>{title} ({runs.length})</span><span aria-hidden="true" className="text-[#969093]">⌄</span>
        </summary>
        <div className="space-y-2 border-t-[1.712px] border-[#e7e2e4] p-4">
          {runs.map((run) => {
            const selectable = runSelectable(run);
            const isSelected = run.id === selectedId;
            const isInspected = run.id === (inspectedId ?? selectedId);
            return (
              <div className="flex flex-col gap-3 rounded-[10px] border-[1.712px] border-[#e7e2e4] bg-white p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`${kind}-history-row`} key={run.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{kind === "chunk" ? "Chunk run" : "Embedding"} {run.runNumber ?? "—"}</span>
                    {isSelected ? <span className="rounded-full bg-[#fbf4f6] px-1.5 py-0.5 text-[10px] text-[#711f3a]">{labels.selected}</span> : null}
                    {!isSelected && isInspected ? <span className="rounded-full bg-[#fffaf1] px-1.5 py-0.5 text-[10px] text-[#8d651e]">{labels.inspected}</span> : null}
                    {run.id === defaultId ? <span className="rounded-full bg-[#eef4ef] px-1.5 py-0.5 text-[10px] text-[#3f7a55]">{labels.active}</span> : null}
                    {run.historicalLineage ? <span className="rounded-full bg-[#fffaf1] px-1.5 py-0.5 text-[10px] text-[#8d651e]">{labels.historical}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#6e676a]"><span>{labels.status}: {runStatusLabel(run, locale)}</span><span>{labels.upstream}: {Object.values(run.upstream).filter(Boolean).length ? `${Object.values(run.upstream).filter(Boolean).length} ${locale === "tr" ? "artifact" : "artifacts"}` : "—"}</span></div>
                  {run.error?.message ? <p className="mt-1 text-xs text-[#a23b3b]">{run.error.message}</p> : null}
                  {!run.isCompatible && run.compatibilityReason ? <p className="mt-1 text-xs text-[#8d651e]">{run.compatibilityReason}</p> : null}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button disabled={!selectable || isInspected} onClick={() => void onSelect(run.id)} size="sm" variant={isInspected ? "secondary" : "outline"}>{isInspected ? labels.inspected : labels.inspect}</Button>
                  {onUse && isInspected && !isSelected ? <Button onClick={() => void onUse(run.id)} size="sm" variant="outline">{labels.use}</Button> : null}
                </div>
              </div>
            );
          })}
        </div>
      </details>
    </section>
  );
}

function StageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className="flex h-[92px] items-start justify-between gap-6" data-testid={`${title.toLowerCase()}-page-header`}>
      <div className="max-w-[720px]">
        <p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-[#711f3a]">{eyebrow}</p>
        <h1 className="mt-2 text-[30px] font-semibold leading-9 tracking-[-0.6px] text-[#171416]">{title}</h1>
        <p className="mt-2 text-sm leading-[21px] text-[#6e676a]">{description}</p>
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </header>
  );
}

export function ChunkingScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, activeDocumentId, selectedParseRunId, selectedChunkRunId, inspectedChunkRunId, parseResult, selectChunkRun, setPipelineChunkRun } = useDocumentPipeline();
  const compatibleChunks = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const labels = locale === "tr"
    ? { description: "Yapılandırılmış içeriği retriever'ınızın bağımsız arayabileceği parçalara ayırın.", source: "Kaynak", basedOn: "Dayanak", elements: "Parse elementleri", noDocument: "Doküman seçin", latest: "Son Ayrıştırma", history: "Chunk sürüm geçmişi", next: "Embeddings'e git", nextReason: "Önce uyumlu ve tamamlanmış bir chunk run seçin." }
    : { description: "Split structured content into pieces your retriever can search independently.", source: "Source", basedOn: "Based on", elements: "Parsed elements", noDocument: "Select a document", latest: "Latest Parse", history: "Chunk version history", next: "Go to Embeddings", nextReason: "Select a compatible completed chunk run first." };
  const parsedElementCount = parseResult?.structured.elements.length ?? "—";

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="chunking-screen">
      <ConditionalPipelineContextBar />
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <StageHeader description={labels.description} eyebrow="Build" title="Chunking" />
        <section className="mt-8 flex h-[74px] items-center gap-12 rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white px-5" data-testid="chunking-source-summary">
          <div><p className="text-xs leading-[18px] text-[#969093]">{labels.source}</p><p className="mt-1 text-sm font-medium leading-[21px] text-[#171416]">{activeDocument?.fileName ?? labels.noDocument}</p></div>
          <div><p className="text-xs leading-[18px] text-[#969093]">{labels.basedOn}</p><p className="mt-1 text-sm font-medium leading-[21px] text-[#171416]">{selectedParseRunId ? labels.latest : "—"}</p></div>
          <div><p className="text-xs leading-[18px] text-[#969093]">{labels.elements}</p><p className="mt-1 text-sm font-medium leading-[21px] text-[#171416]">{parsedElementCount}</p></div>
        </section>
        <ChunkingWorkspace locale={locale} />
         <ArtifactHistory defaultId={activeDocument?.activeChunkRunId} inspectedId={inspectedChunkRunId} kind="chunk" locale={locale} onSelect={selectChunkRun} onUse={setPipelineChunkRun} runs={activeDocument?.chunkRuns.filter((run) => run.upstream.parseRunId === selectedParseRunId) ?? []} selectedId={selectedChunkRunId} title={labels.history} />
        <section className="mt-6 flex items-start justify-between gap-4">
          {compatibleChunks.some((run) => run.id === selectedChunkRunId) ? <Button asChild size="sm" variant="outline"><Link href="/embeddings">{labels.next}<ArrowRight aria-hidden="true" className="ml-2 size-4" /></Link></Button> : <div><Button disabled size="sm" variant="outline">{labels.next}</Button><DisabledReason id="chunking-next-disabled-reason">{labels.nextReason}</DisabledReason></div>}
          {!activeDocumentId ? <span className="text-xs text-[#969093]">{labels.noDocument}</span> : null}
        </section>
      </div>
    </div>
  );
}

export function EmbeddingsScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, activeDocumentId, selectedChunkRunId, selectedEmbeddingRunId, inspectedEmbeddingRunId, embeddingRun, embeddingStatus, capabilities, selectEmbeddingRun, setPipelineEmbeddingRun, runEmbedding } = useDocumentPipeline();
  const selectedChunk = activeDocument?.chunkRuns.find((run) => run.id === selectedChunkRunId);
  const canEmbed = Boolean(activeDocumentId && selectedChunk?.status === "completed" && selectedChunk.isCompatible && selectedChunkRunId && embeddingStatus !== "processing");
  const labels = locale === "tr"
    ? { description: "Chunk'ları semantic search için vektörleştirin ve aranabilir hâle getirin.", source: "Girdi", basedOn: "Dayanak", chunks: "chunk", model: "Model", noDocument: "Doküman seçin", latest: "Güncel parçalama", create: "Embedding oluştur", history: "Embedding sürüm geçmişi", next: "Playground'a git", nextReason: "Playground için önce tamamlanmış bir chunk run gerekir." }
    : { description: "Turn chunks into vectors for semantic search and make them searchable.", source: "Input", basedOn: "Based on", chunks: "chunks", model: "Model", noDocument: "Select a document", latest: "Current Chunking", create: "Create embeddings", history: "Embedding version history", next: "Go to Playground", nextReason: "A successful, current chunk run is required first." };

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="embeddings-screen">
      <ConditionalPipelineContextBar />
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <StageHeader
          action={embeddingRun ? <Button asChild className="h-[42px] rounded-[10px] px-4 text-sm"><Link href="/playground">{labels.next}<ArrowRight aria-hidden="true" className="ml-2 size-4" /></Link></Button> : <Button aria-describedby={!canEmbed ? "embeddings-next-disabled-reason" : undefined} className="h-[42px] rounded-[10px] px-4 text-sm" disabled={!canEmbed} onClick={() => void runEmbedding()}>{labels.create}</Button>}
          description={labels.description}
          eyebrow="Build"
          title="Embeddings"
        />
        <section className="mt-8 flex h-[74px] items-center gap-12 rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white px-5" data-testid="embedding-input">
          <div><p className="text-xs leading-[18px] text-[#969093]">{labels.source}</p><p className="mt-1 text-sm font-medium leading-[21px] text-[#171416]">{selectedChunk?.chunkCount ?? "—"} {selectedChunk ? labels.chunks : labels.noDocument}</p></div>
          <div><p className="text-xs leading-[18px] text-[#969093]">{labels.basedOn}</p><p className="mt-1 text-sm font-medium leading-[21px] text-[#171416]">{selectedChunk ? labels.latest : "—"}</p></div>
          <div><p className="text-xs leading-[18px] text-[#969093]">{labels.model}</p><p className="mt-1 text-sm font-medium leading-[21px] text-[#171416]">{embeddingRun?.model ?? capabilities?.embeddingModel ?? "Gemini Embedding"}</p></div>
        </section>
        <EmbeddingWorkspace locale={locale} showAction={false} />
        <ArtifactHistory defaultId={activeDocument?.activeEmbeddingRunId} inspectedId={inspectedEmbeddingRunId} kind="embedding" locale={locale} onSelect={selectEmbeddingRun} onUse={setPipelineEmbeddingRun} runs={activeDocument?.embeddingRuns.filter((run) => run.upstream.chunkRunId === selectedChunkRunId) ?? []} selectedId={selectedEmbeddingRunId} title={labels.history} />
        <section className="mt-6">
          {embeddingRun ? <Button asChild size="sm" variant="outline"><Link href="/playground">{labels.next}<ArrowRight aria-hidden="true" className="ml-2 size-4" /></Link></Button> : <><Button disabled size="sm" variant="outline">{labels.next}</Button><DisabledReason id="embeddings-next-disabled-reason">{labels.nextReason}</DisabledReason></>}
        </section>
      </div>
    </div>
  );
}
