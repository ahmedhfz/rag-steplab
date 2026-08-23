"use client";

import { FileText } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import type { AppLocale } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import type { RunSummary } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";

function runLabel(run: RunSummary | undefined, hasRunPointer: boolean, active: boolean, locale: AppLocale) {
  if (!run) {
    if (!hasRunPointer) return locale === "tr" ? "Çalıştırılmadı" : "Not run";
    return active ? (locale === "tr" ? "Özet yükleniyor" : "Summary loading") : (locale === "tr" ? "Seçerek inceleyin" : "Select to inspect");
  }
  if (run.status === "queued" || run.status === "running") return locale === "tr" ? "Devam ediyor" : "In progress";
  if (run.status === "failed") return locale === "tr" ? "Başarısız" : "Failed";
  return run.isCompatible ? (locale === "tr" ? "Hazır" : "Ready") : (locale === "tr" ? "Uyumsuz" : "Incompatible");
}

function stageClass(run: RunSummary | undefined) {
  if (!run) return "text-slate-500";
  if (run.status === "failed" || !run.isCompatible) return "text-red-700";
  if (run.status === "queued" || run.status === "running") return "text-amber-700";
  return "text-emerald-700";
}

function PipelineStatus({ documentId, parse, chunk, embedding, parsePointer, chunkPointer, embeddingPointer, active, locale }: { documentId: string; parse?: RunSummary; chunk?: RunSummary; embedding?: RunSummary; parsePointer: boolean; chunkPointer: boolean; embeddingPointer: boolean; active: boolean; locale: AppLocale }) {
  const labels = locale === "tr" ? { parse: "Parse", chunk: "Chunk", embedding: "Embedding" } : { parse: "Parse", chunk: "Chunk", embedding: "Embedding" };
  return (
    <div className="grid grid-cols-3 gap-2 text-xs" data-document-pipeline-status={documentId}>
      {([[labels.parse, parse, parsePointer], [labels.chunk, chunk, chunkPointer], [labels.embedding, embedding, embeddingPointer]] as Array<[string, RunSummary | undefined, boolean]>).map(([label, run, hasRunPointer]) => (
        <div className="min-w-0" key={label as string}>
          <span className="block text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
          <span className={cn("mt-1 block truncate font-medium", stageClass(run))}>{runLabel(run, hasRunPointer, active, locale)}</span>
        </div>
      ))}
    </div>
  );
}

export function OverviewScreen() {
  const { preferences } = usePreferences();
  const { documents, activeDocumentId, activeDocument, persistenceStatus, persistenceError } = useDocumentPipeline();
  const labels = preferences.locale === "tr"
    ? { title: "Genel bakış", description: "Elinizdeki PDF dokümanları ve gerçek pipeline durumlarını görün.", inventory: "Doküman envanteri", count: "doküman", pages: "sayfa", active: "Aktif", loading: "Doküman özeti yükleniyor…", empty: "Henüz doküman yok.", unavailable: "Doküman servisi kullanılamıyor." }
    : { title: "Overview", description: "See the PDF documents you have and their real pipeline state.", inventory: "Document inventory", count: "documents", pages: "pages", active: "Active", loading: "Loading document summaries…", empty: "No documents yet.", unavailable: "The document service is unavailable." };

  return (
    <div>
      <header className="border-b px-4 py-7 sm:px-8">
        <h1 className="text-[22px] font-semibold tracking-[-0.025em]">{labels.title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{labels.description}</p>
      </header>
      <section className="px-4 py-6 sm:px-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">{labels.inventory}</h2>
          <span className="text-xs text-slate-500">{documents.length} {labels.count}</span>
        </div>
        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState> :
          persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></> :
            documents.length === 0 ? <EmptyPipelineState>{labels.empty}</EmptyPipelineState> : (
              <div className="mt-4 divide-y border">
                {documents.map((document) => {
                  const isActive = document.id === activeDocumentId;
                  const parse = isActive ? activeDocument?.parseRuns.find((run) => run.id === document.activeParseRunId) : undefined;
                  const chunk = isActive ? activeDocument?.chunkRuns.find((run) => run.id === document.activeChunkRunId) : undefined;
                  const embedding = isActive ? activeDocument?.embeddingRuns.find((run) => run.id === document.activeEmbeddingRunId) : undefined;
                  return (
                    <article className={cn("grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)] sm:items-center", isActive && "bg-slate-50")} key={document.id}>
                      <div className="flex min-w-0 items-center gap-3"><FileText aria-hidden="true" className="size-5 shrink-0 text-slate-500" /><div className="min-w-0"><h3 className="truncate text-sm font-medium" title={document.fileName}>{document.fileName}</h3><p className="mt-1 text-xs text-slate-500">{document.pageCount} {labels.pages} · {formatDocumentFileSize(document.sizeBytes, preferences.locale)}{isActive ? ` · ${labels.active}` : ""}</p></div></div>
                      <PipelineStatus active={isActive} chunk={chunk} chunkPointer={Boolean(document.activeChunkRunId)} documentId={document.id} embedding={embedding} embeddingPointer={Boolean(document.activeEmbeddingRunId)} locale={preferences.locale} parse={parse} parsePointer={Boolean(document.activeParseRunId)} />
                    </article>
                  );
                })}
              </div>
            )}
      </section>
    </div>
  );
}
