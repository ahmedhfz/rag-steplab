"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ChunkingWorkspace, EmbeddingWorkspace } from "@/components/chunks-pipeline";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
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
    <section className="mt-8" data-testid={`${kind}-history`}>
      <details className="rounded-[12px] border-[1.712px] border-border bg-card">
        <summary className="flex h-[46px] cursor-pointer list-none items-center justify-between px-4 text-[13px] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/25 sm:px-5">
          <span>{title} ({runs.length})</span><span aria-hidden="true" className="text-subtle-foreground">⌄</span>
        </summary>
        <div className="space-y-2 border-t-[1.712px] border-border p-4">
          {runs.map((run) => {
            const selectable = runSelectable(run);
            const isSelected = run.id === selectedId;
            const isInspected = run.id === (inspectedId ?? selectedId);
            return (
              <div className="flex flex-col gap-3 rounded-[10px] border-[1.712px] border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`${kind}-history-row`} key={run.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold">{kind === "chunk" ? "Chunk run" : "Embedding"} {run.runNumber ?? "—"}</span>
                    {isSelected ? <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] text-brand">{labels.selected}</span> : null}
                    {!isSelected && isInspected ? <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 text-[10px] text-warning">{labels.inspected}</span> : null}
                    {run.id === defaultId ? <span className="rounded-full bg-success-subtle px-1.5 py-0.5 text-[10px] text-success">{labels.active}</span> : null}
                    {run.historicalLineage ? <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 text-[10px] text-warning">{labels.historical}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span>{labels.status}: {runStatusLabel(run, locale)}</span><span>{labels.upstream}: {Object.values(run.upstream).filter(Boolean).length ? `${Object.values(run.upstream).filter(Boolean).length} ${locale === "tr" ? "artifact" : "artifacts"}` : "—"}</span></div>
                  {run.error?.message ? <p className="mt-1 text-xs text-destructive">{run.error.message}</p> : null}
                  {!run.isCompatible && run.compatibilityReason ? <p className="mt-1 text-xs text-warning">{run.compatibilityReason}</p> : null}
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

function StageHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="flex min-h-[92px] items-start justify-between gap-6 max-md:flex-col" data-testid={`${title.toLowerCase()}-page-header`}>
      <div className="max-w-[720px]">
        <p className="text-xs font-semibold uppercase leading-[18px] tracking-[0.96px] text-brand">{eyebrow}</p>
        <h1 className="mt-2 text-[30px] font-semibold leading-9 tracking-[-0.6px] text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-[21px] text-muted-foreground">{description}</p>
      </div>
    </header>
  );
}

export function StageNextAction({ href, label, disabled, testId }: { href: string; label: string; disabled: boolean; testId: string }) {
  if (disabled) return null;
  return (
    <footer className="mt-8 flex justify-end border-t border-border pt-5" data-testid={`${testId}-footer`}>
      <Button asChild className="h-[42px] gap-2 rounded-[10px] px-4 text-sm" data-testid={testId}>
        <Link href={href}>{label}<ArrowRight aria-hidden="true" className="size-4" /></Link>
      </Button>
    </footer>
  );
}

export function ChunkingScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, selectedParseRunId, selectedChunkRunId, inspectedChunkRunId, selectChunkRun, setPipelineChunkRun } = useDocumentPipeline();
  const compatibleChunks = activeDocument?.chunkRuns.filter((run) => run.status === "completed" && run.isCompatible && run.upstream.parseRunId === selectedParseRunId) ?? [];
  const labels = locale === "tr"
    ? { description: "Yapılandırılmış içeriği retriever'ınızın bağımsız arayabileceği parçalara ayırın.", source: "Kaynak", basedOn: "Dayanak", elements: "Parse elementleri", noDocument: "Doküman seçin", latest: "Son Ayrıştırma", history: "Chunk sürüm geçmişi", next: "Embeddings'e git", nextReason: "Önce uyumlu ve tamamlanmış bir chunk run seçin." }
    : { description: "Split structured content into pieces your retriever can search independently.", source: "Source", basedOn: "Based on", elements: "Parsed elements", noDocument: "Select a document", latest: "Latest Parse", history: "Chunk version history", next: "Go to Embeddings", nextReason: "Select a compatible completed chunk run first." };

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="chunking-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <StageHeader description={labels.description} eyebrow="Build" title="Chunking" />
        <div className="mt-3 w-fit max-w-full overflow-hidden rounded-[14px] border border-border bg-card [&>[data-testid=pipeline-context-bar]]:border-b-0">
          <PipelineContextBar showLineage={false} />
        </div>
        <ChunkingWorkspace locale={locale} />
        <ArtifactHistory defaultId={activeDocument?.activeChunkRunId} inspectedId={inspectedChunkRunId} kind="chunk" locale={locale} onSelect={selectChunkRun} onUse={setPipelineChunkRun} runs={activeDocument?.chunkRuns.filter((run) => run.upstream.parseRunId === selectedParseRunId) ?? []} selectedId={selectedChunkRunId} title={labels.history} />
        <StageNextAction disabled={!selectedParseRunId || !compatibleChunks.some((run) => run.id === selectedChunkRunId)} href="/embeddings" label={labels.next} testId="chunking-next-action" />
      </div>
    </div>
  );
}

export function EmbeddingsScreen() {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const { activeDocument, selectedChunkRunId, selectedEmbeddingRunId, inspectedEmbeddingRunId, embeddingRun, selectEmbeddingRun, setPipelineEmbeddingRun } = useDocumentPipeline();
  const canContinue = Boolean(selectedChunkRunId && selectedEmbeddingRunId && embeddingRun?.id === selectedEmbeddingRunId && embeddingRun?.status === "completed" && embeddingRun.isCompatible && embeddingRun.upstream.chunkRunId === selectedChunkRunId);
  const labels = locale === "tr"
    ? { description: "Seçili chunk setini semantic search için embedding'lere dönüştürün.", chunks: "chunk", model: "Model", dimensions: "Boyut", noDocument: "Chunk seti seçin", create: "Embedding oluştur", creating: "Embedding oluşturuluyor", history: "Embedding sürüm geçmişi", next: "Playground'a git", nextReason: "Playground'a geçmeden önce embedding oluşturun." }
    : { description: "Turn the selected chunk set into embeddings for semantic search.", chunks: "chunks", model: "Model", dimensions: "Dimensions", noDocument: "Select a chunk set", create: "Create embeddings", creating: "Creating embeddings", history: "Embedding version history", next: "Go to Playground", nextReason: "Create embeddings before continuing to Playground." };

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="embeddings-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <StageHeader
          description={labels.description}
          eyebrow="Build"
          title="Embeddings"
        />
        <div className="mt-3 w-fit max-w-full overflow-hidden rounded-[14px] border border-border bg-card [&>[data-testid=pipeline-context-bar]]:border-b-0">
          <PipelineContextBar showLineage={false} />
        </div>
        <EmbeddingWorkspace locale={locale} />
        <ArtifactHistory defaultId={activeDocument?.activeEmbeddingRunId} inspectedId={inspectedEmbeddingRunId} kind="embedding" locale={locale} onSelect={selectEmbeddingRun} onUse={setPipelineEmbeddingRun} runs={activeDocument?.embeddingRuns.filter((run) => run.upstream.chunkRunId === selectedChunkRunId) ?? []} selectedId={selectedEmbeddingRunId} title={labels.history} />
        <StageNextAction disabled={!canContinue} href="/playground" label={labels.next} testId="embeddings-next-action" />
      </div>
    </div>
  );
}
