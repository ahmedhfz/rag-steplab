"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ChunkingWorkspace, EmbeddingWorkspace } from "@/components/chunks-pipeline";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
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
    <header className="flex min-h-[92px] items-start justify-between gap-6 max-md:flex-col" data-testid={`${title.toLowerCase()}-page-header`}>
      <div className="max-w-[720px]">
        <p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-[#711f3a]">{eyebrow}</p>
        <h1 className="mt-2 text-[30px] font-semibold leading-9 tracking-[-0.6px] text-[#171416]">{title}</h1>
        <p className="mt-2 text-sm leading-[21px] text-[#6e676a]">{description}</p>
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </header>
  );
}

export function StageNextAction({ href, label, disabled, reason, testId }: { href: string; label: string; disabled: boolean; reason?: string; testId: string }) {
  const reasonId = `${testId}-disabled-reason`;
  if (disabled) {
    return (
      <div className="min-w-0">
        <Button aria-describedby={reason ? reasonId : undefined} className="h-[42px] gap-2 rounded-[10px] px-4 text-sm" data-testid={testId} disabled>
          {label}<ArrowRight aria-hidden="true" className="size-4" />
        </Button>
        {reason ? <DisabledReason id={reasonId}>{reason}</DisabledReason> : null}
      </div>
    );
  }
  return (
    <Button asChild className="h-[42px] gap-2 rounded-[10px] px-4 text-sm" data-testid={testId}>
      <Link href={href}>{label}<ArrowRight aria-hidden="true" className="size-4" /></Link>
    </Button>
  );
}

export function ChunkingScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, activeDocumentId, selectedParseRunId, selectedChunkRunId, inspectedChunkRunId, selectChunkRun, setPipelineChunkRun } = useDocumentPipeline();
  const compatibleChunks = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const labels = locale === "tr"
    ? { description: "Yapılandırılmış içeriği retriever'ınızın bağımsız arayabileceği parçalara ayırın.", source: "Kaynak", basedOn: "Dayanak", elements: "Parse elementleri", noDocument: "Doküman seçin", latest: "Son Ayrıştırma", history: "Chunk sürüm geçmişi", next: "Embeddings'e git", nextReason: "Önce uyumlu ve tamamlanmış bir chunk run seçin." }
    : { description: "Split structured content into pieces your retriever can search independently.", source: "Source", basedOn: "Based on", elements: "Parsed elements", noDocument: "Select a document", latest: "Latest Parse", history: "Chunk version history", next: "Go to Embeddings", nextReason: "Select a compatible completed chunk run first." };

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="chunking-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <StageHeader action={<StageNextAction disabled={!compatibleChunks.some((run) => run.id === selectedChunkRunId)} href="/embeddings" label={labels.next} reason={activeDocumentId ? labels.nextReason : labels.noDocument} testId="chunking-next-action" />} description={labels.description} eyebrow="Build" title="Chunking" />
        <PipelineContextBar showLineage={false} />
        <ChunkingWorkspace locale={locale} />
        <ArtifactHistory defaultId={activeDocument?.activeChunkRunId} inspectedId={inspectedChunkRunId} kind="chunk" locale={locale} onSelect={selectChunkRun} onUse={setPipelineChunkRun} runs={activeDocument?.chunkRuns.filter((run) => run.upstream.parseRunId === selectedParseRunId) ?? []} selectedId={selectedChunkRunId} title={labels.history} />
      </div>
    </div>
  );
}

export function EmbeddingsScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, selectedChunkRunId, selectedEmbeddingRunId, inspectedEmbeddingRunId, embeddingRun, selectEmbeddingRun, setPipelineEmbeddingRun } = useDocumentPipeline();
  const canContinue = embeddingRun?.status === "completed" && embeddingRun.isCompatible && embeddingRun.upstream.chunkRunId === selectedChunkRunId;
  const labels = locale === "tr"
    ? { description: "Seçili chunk setini semantic search için embedding'lere dönüştürün.", chunks: "chunk", model: "Model", dimensions: "Boyut", noDocument: "Chunk seti seçin", create: "Embedding oluştur", creating: "Embedding oluşturuluyor", history: "Embedding sürüm geçmişi", next: "Playground'a git", nextReason: "Playground'a geçmeden önce embedding oluşturun." }
    : { description: "Turn the selected chunk set into embeddings for semantic search.", chunks: "chunks", model: "Model", dimensions: "Dimensions", noDocument: "Select a chunk set", create: "Create embeddings", creating: "Creating embeddings", history: "Embedding version history", next: "Go to Playground", nextReason: "Create embeddings before continuing to Playground." };

  return (
    <div className="min-w-0 overflow-x-clip bg-[#f8f7f7]" data-testid="embeddings-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <StageHeader
          action={<StageNextAction disabled={!canContinue} href="/playground" label={labels.next} reason={labels.nextReason} testId="embeddings-next-action" />}
          description={labels.description}
          eyebrow="Build"
          title="Embeddings"
        />
        <PipelineContextBar showLineage={false} />
        <EmbeddingWorkspace locale={locale} />
        <ArtifactHistory defaultId={activeDocument?.activeEmbeddingRunId} inspectedId={inspectedEmbeddingRunId} kind="embedding" locale={locale} onSelect={selectEmbeddingRun} onUse={setPipelineEmbeddingRun} runs={activeDocument?.embeddingRuns.filter((run) => run.upstream.chunkRunId === selectedChunkRunId) ?? []} selectedId={selectedEmbeddingRunId} title={labels.history} />
      </div>
    </div>
  );
}
