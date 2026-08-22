"use client";

import { Database, RefreshCw } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { DisabledReason, EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { Button } from "@/components/ui/button";
import type { AppLocale } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import { cn } from "@/lib/utils";

export function DocumentLibrary({ locale }: { locale: AppLocale }) {
  const {
    documents,
    activeDocument,
    persistenceStatus,
    persistenceError,
    refreshPersistence,
    selectPersistedDocument,
  } = useDocumentPipeline();
  const labels = locale === "tr" ? {
    title: "Kalıcı dokümanlar",
    description: "Supabase Storage ve PostgreSQL'de saklanan gerçek dokümanlar.",
    refresh: "Yenile",
    loading: "Doküman geçmişi yükleniyor…",
    empty: "Henüz kalıcı bir doküman yok. Documents ekranından gerçek bir PDF ayrıştırın.",
    unavailable: "Kalıcı backend hazır değil; doküman geçmişi yüklenemedi.",
    active: "Aktif",
    pages: "sayfa",
  } : {
    title: "Persisted documents",
    description: "Real documents stored in Supabase Storage and PostgreSQL.",
    refresh: "Refresh",
    loading: "Loading document history…",
    empty: "No persisted document exists yet. Parse a real PDF from Documents.",
    unavailable: "The persistence backend is not ready, so document history could not be loaded.",
    active: "Active",
    pages: "pages",
  };

  return (
    <section className="border-t px-4 py-6 sm:px-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{labels.title}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{labels.description}</p>
        </div>
        <Button className="gap-2" disabled={persistenceStatus === "checking"} onClick={() => void refreshPersistence()} size="sm" variant="outline">
          <RefreshCw aria-hidden="true" className={cn("size-3.5", persistenceStatus === "checking" && "animate-spin")} />
          {labels.refresh}
        </Button>
      </div>
      <div className="mt-4">
        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState> :
          persistenceStatus === "unavailable" ? (
            <>
              <EmptyPipelineState>{labels.unavailable}</EmptyPipelineState>
              <PipelineErrorMessage message={persistenceError?.message} />
            </>
          ) : documents.length === 0 ? <EmptyPipelineState>{labels.empty}</EmptyPipelineState> : (
            <div className="grid gap-2 md:grid-cols-2">
              {documents.map((document) => {
                const isActive = document.id === activeDocument?.id;
                return (
                  <button
                    aria-pressed={isActive}
                    className={cn("flex min-w-0 items-center gap-3 border p-3 text-left outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-400", isActive && "border-slate-950 bg-slate-50")}
                    key={document.id}
                    onClick={() => void selectPersistedDocument(document.id)}
                    type="button"
                  >
                    <Database aria-hidden="true" className="size-5 shrink-0 text-slate-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{document.fileName}</span>
                      <span className="mt-1 block text-xs text-slate-500">{document.pageCount} {labels.pages} · {formatDocumentFileSize(document.sizeBytes, locale)}</span>
                      <span className="mt-1 block truncate font-mono text-[10px] text-slate-400">{document.id}</span>
                    </span>
                    {isActive ? <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{labels.active}</span> : null}
                  </button>
                );
              })}
            </div>
          )}
      </div>
      {persistenceStatus !== "available" ? <DisabledReason id="persisted-documents-reason">{labels.unavailable}</DisabledReason> : null}
    </section>
  );
}
