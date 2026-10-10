"use client";

import Link from "next/link";

import { ChunkingWorkspace, EmbeddingWorkspace } from "@/components/chunks-pipeline";
import { PipelineContextBar } from "@/components/pipeline-context-bar";
import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
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
    ? { empty: "Bu aşama için henüz sonuç yok.", selected: "Kullanımda", inspected: "İnceleniyor", active: "Varsayılan", historical: "Geçmiş", status: "Durum", inspect: "İncele", use: "Pipeline'da kullan" }
    : { empty: "No result for this stage yet.", selected: "In use", inspected: "Inspecting", active: "Default", historical: "Historical", status: "Status", inspect: "Inspect", use: "Use in pipeline" };
  if (!runs.length) return null;

  return (
    <section className="mt-8" data-testid={`${kind}-history`}>
      <Disclosure contentClassName="space-y-2 p-4" title={`${title} (${runs.length})`}>
          {runs.map((run) => {
            const selectable = runSelectable(run);
            const isSelected = run.id === selectedId;
            const isInspected = run.id === (inspectedId ?? selectedId);
            return (
              <div className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`${kind}-history-row`} key={run.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="font-semibold tabular-nums">{kind === "chunk" ? "Chunk run" : "Embedding"} {run.runNumber ?? "—"}</span>
                    {isSelected ? <StatusPill tone="neutral">{labels.selected}</StatusPill> : null}
                    {!isSelected && isInspected ? <StatusPill tone="warning">{labels.inspected}</StatusPill> : null}
                    {run.id === defaultId ? <StatusPill tone="neutral">{labels.active}</StatusPill> : null}
                    {run.historicalLineage ? <StatusPill tone="warning">{labels.historical}</StatusPill> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{labels.status}: {runStatusLabel(run, locale)}</div>
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
      </Disclosure>
    </section>
  );
}

export function StageNextAction({ href, label, disabled, testId }: { href: string; label: string; disabled: boolean; testId: string }) {
  if (disabled) return null;
  return (
    <footer className="mt-8 flex justify-end border-t border-border pt-5" data-testid={`${testId}-footer`}>
      <Button asChild data-testid={testId}>
        <Link href={href}>{label}<AppIcon name="arrowRight" className="size-4" /></Link>
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
        <PageHeader data-testid="chunking-page-header" description={labels.description} title="Chunking" />
        <div className="mt-6 w-fit max-w-full overflow-hidden rounded-lg border border-border bg-card [&>[data-testid=pipeline-context-bar]]:border-b-0">
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
  const { activeDocument, selectedChunkRunId, selectedEmbeddingRunId, inspectedEmbeddingRunId, selectedEmbeddingRun, selectEmbeddingRun, setPipelineEmbeddingRun } = useDocumentPipeline();
  // The next step follows the selected lineage, never the inspection cursor.
  const canContinue = Boolean(selectedChunkRunId && selectedEmbeddingRunId && selectedEmbeddingRun?.id === selectedEmbeddingRunId && selectedEmbeddingRun?.status === "completed" && selectedEmbeddingRun.isCompatible && selectedEmbeddingRun.upstream.chunkRunId === selectedChunkRunId);
  const labels = locale === "tr"
    ? { description: "Seçili chunk setini semantic search için embedding'lere dönüştürün.", chunks: "chunk", model: "Model", dimensions: "Boyut", noDocument: "Chunk seti seçin", create: "Embedding oluştur", creating: "Embedding oluşturuluyor", history: "Embedding sürüm geçmişi", next: "Playground'a git", nextReason: "Playground'a geçmeden önce embedding oluşturun." }
    : { description: "Turn the selected chunk set into embeddings for semantic search.", chunks: "chunks", model: "Model", dimensions: "Dimensions", noDocument: "Select a chunk set", create: "Create embeddings", creating: "Creating embeddings", history: "Embedding version history", next: "Go to Playground", nextReason: "Create embeddings before continuing to Playground." };

  return (
    <div className="min-w-0 overflow-x-clip bg-background" data-testid="embeddings-screen">
      <div className="mx-auto w-full max-w-[1280px] p-10 max-md:p-4">
        <PageHeader data-testid="embeddings-page-header" description={labels.description} title="Embeddings" />
        <div className="mt-6 w-fit max-w-full overflow-hidden rounded-lg border border-border bg-card [&>[data-testid=pipeline-context-bar]]:border-b-0">
          <PipelineContextBar showLineage={false} />
        </div>
        <EmbeddingWorkspace locale={locale} />
        <ArtifactHistory defaultId={activeDocument?.activeEmbeddingRunId} inspectedId={inspectedEmbeddingRunId} kind="embedding" locale={locale} onSelect={selectEmbeddingRun} onUse={setPipelineEmbeddingRun} runs={activeDocument?.embeddingRuns.filter((run) => run.upstream.chunkRunId === selectedChunkRunId) ?? []} selectedId={selectedEmbeddingRunId} title={labels.history} />
        <StageNextAction disabled={!canContinue} href="/playground" label={labels.next} testId="embeddings-next-action" />
      </div>
    </div>
  );
}

