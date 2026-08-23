"use client";

import { FileText } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { type AppLocale } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import { cn } from "@/lib/utils";

export function DocumentLibrary({ locale }: { locale: AppLocale }) {
  const { documents, activeDocumentId, persistenceStatus, persistenceError, selectPersistedDocument } = useDocumentPipeline();
  const labels = locale === "tr"
    ? { title: "PDF kitaplığı", loading: "Dokümanlar yükleniyor…", empty: "Henüz PDF eklenmedi.", unavailable: "Doküman servisi kullanılamıyor.", active: "Aktif", pages: "sayfa", notParsed: "Ayrıştırılmadı", parsing: "Ayrıştırılıyor", parsed: "Ayrıştırıldı", failed: "Ayrıştırma başarısız" }
    : { title: "PDF library", loading: "Loading documents…", empty: "No PDF has been added yet.", unavailable: "The document service is unavailable.", active: "Active", pages: "pages", notParsed: "Not parsed", parsing: "Parsing", parsed: "Parsed", failed: "Parse failed" };

  return (
    <section className="border-t px-4 py-6 sm:px-7">
      <h2 className="text-sm font-semibold">{labels.title}</h2>
      <div className="mt-4">
        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState> :
          persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></> :
            documents.length === 0 ? <EmptyPipelineState>{labels.empty}</EmptyPipelineState> : (
              <div className="grid gap-2 md:grid-cols-2">
                {documents.map((document) => {
                  const isActive = document.id === activeDocumentId;
                  return (
                    <button
                      aria-pressed={isActive}
                      className={cn("flex min-w-0 items-center gap-3 border p-3 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-400", isActive && "border-slate-950 bg-slate-50")}
                      key={document.id}
                      onClick={() => void selectPersistedDocument(document.id)}
                      type="button"
                    >
                      <FileText aria-hidden="true" className="size-5 shrink-0 text-slate-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{document.fileName}</span>
                        <span className="mt-1 block text-xs text-slate-500">{document.latestParseStatus === "completed" ? `${document.pageCount} ${labels.pages}` : document.latestParseStatus === "running" || document.latestParseStatus === "queued" ? labels.parsing : document.latestParseStatus === "failed" ? labels.failed : labels.notParsed} · {formatDocumentFileSize(document.sizeBytes, locale)}</span>
                      </span>
                      {isActive ? <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{labels.active}</span> : null}
                    </button>
                  );
                })}
              </div>
            )}
      </div>
    </section>
  );
}
