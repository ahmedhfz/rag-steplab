"use client";

import { Check, ChevronRight, CircleAlert, Clock3, FileText, LoaderCircle } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { type AppLocale } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import type { ParseRunStatus } from "@/lib/document-parse-types";
import { cn } from "@/lib/utils";

type DocumentStatus = "not-started" | "processing" | "completed" | "failed";

const statusStyles: Record<DocumentStatus, string> = {
  "not-started": "border-[#e7e2e4] bg-[#f7f5f6] text-[#6e676a]",
  processing: "border-[#eadfc9] bg-[#fbf5e9] text-[#8d651e]",
  completed: "border-[#d6e5da] bg-[#f0f6f1] text-[#3f7a55]",
  failed: "border-[#edcfcf] bg-[#fbefef] text-[#a23b3b]",
};

function getDocumentStatus(status: ParseRunStatus | null | undefined): DocumentStatus {
  if (status === "queued" || status === "running") return "processing";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "not-started";
}

function DocumentStatusBadge({ locale, status }: { locale: AppLocale; status: DocumentStatus }) {
  const labels = locale === "tr"
    ? { "not-started": "Ayrıştırılmadı", processing: "Ayrıştırılıyor", completed: "Ayrıştırıldı", failed: "Başarısız" }
    : { "not-started": "Not parsed", processing: "Parsing", completed: "Parsed", failed: "Failed" };
  const icon = status === "processing"
    ? <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
    : status === "completed"
      ? <Check aria-hidden="true" className="size-3" />
      : status === "failed"
        ? <CircleAlert aria-hidden="true" className="size-3" />
        : <Clock3 aria-hidden="true" className="size-3" />;

  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium", statusStyles[status])}>{icon}{labels[status]}</span>;
}

function formatUpdatedAt(value: string | null, locale: AppLocale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(date);
}

export function DocumentLibrary({ locale }: { locale: AppLocale }) {
  const { documents, activeDocumentId, persistenceStatus, persistenceError, selectPersistedDocument } = useDocumentPipeline();
  const labels = locale === "tr"
    ? {
        title: "Doküman kitaplığı",
        description: "Yüklenen PDF'leri ve ayrıştırma durumlarını yönetin.",
        loading: "Dokümanlar yükleniyor…",
        empty: "Henüz doküman yok.",
        emptyDescription: "RAG akışını başlatmak için ilk PDF'nizi ekleyin.",
        unavailable: "Doküman servisi kullanılamıyor.",
        file: "Doküman",
        status: "Durum",
        pages: "Sayfa",
        size: "Boyut",
        updated: "Güncellendi",
        active: "Aktif",
        open: "Dokümanı aç",
        noPages: "—",
      }
    : {
        title: "Document library",
        description: "Manage uploaded PDFs and their parsing status.",
        loading: "Loading documents…",
        empty: "No documents yet.",
        emptyDescription: "Add your first PDF to start the RAG flow.",
        unavailable: "The document service is unavailable.",
        file: "Document",
        status: "Status",
        pages: "Pages",
        size: "Size",
        updated: "Updated",
        active: "Active",
        open: "Open document",
        noPages: "—",
      };

  return (
    <section aria-label={labels.title} className="border-t px-4 py-7 sm:px-8 sm:py-8" data-testid="document-library">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-[-0.02em]">{labels.title}</h2>
          <p className="mt-1 text-sm text-[#6e676a]">{labels.description}</p>
        </div>
        {documents.length > 0 ? <span className="text-xs text-[#969093]">{documents.length} {locale === "tr" ? "doküman" : documents.length === 1 ? "document" : "documents"}</span> : null}
      </div>
      <div className="mt-5">
        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState> :
          persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></> :
            documents.length === 0 ? (
              <div className="border border-dashed border-[#d8d2d5] bg-white px-6 py-12 text-center">
                <span className="mx-auto grid size-11 place-items-center rounded-full bg-[#fbf4f6] text-[#711f3a]"><FileText aria-hidden="true" className="size-5" /></span>
                <h3 className="mt-4 text-sm font-semibold">{labels.empty}</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-[#6e676a]">{labels.emptyDescription}</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-[#e7e2e4] bg-white">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <caption className="sr-only">{labels.title}</caption>
                  <thead className="border-b border-[#e7e2e4] bg-[#fbfafb] text-[11px] font-medium uppercase tracking-[0.08em] text-[#969093]">
                    <tr>
                      <th className="px-4 py-3 font-medium">{labels.file}</th>
                      <th className="px-4 py-3 font-medium">{labels.status}</th>
                      <th className="px-4 py-3 font-medium">{labels.pages}</th>
                      <th className="px-4 py-3 font-medium">{labels.size}</th>
                      <th className="px-4 py-3 font-medium">{labels.updated}</th>
                      <th className="w-10 px-4 py-3"><span className="sr-only">{labels.open}</span></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e7e2e4]">
                    {documents.map((document) => {
                      const isActive = document.id === activeDocumentId;
                      const status = getDocumentStatus(document.latestParseStatus);
                      return (
                        <tr className={cn("transition-colors hover:bg-[#fbf4f6]/60", isActive && "bg-[#fbf4f6]/70")} key={document.id}>
                          <th className="max-w-[340px] px-4 py-4 text-left font-medium text-[#171416]" scope="row">
                            <button aria-label={`${labels.open}: ${document.fileName}`} aria-pressed={isActive} className="flex min-w-0 items-center gap-3 rounded-[7px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" onClick={() => void selectPersistedDocument(document.id)} type="button">
                              <span className={cn("grid size-8 shrink-0 place-items-center rounded-[7px] border bg-white", isActive ? "border-[#d8b5c2] text-[#711f3a]" : "border-[#e7e2e4] text-[#6e676a]")}><FileText aria-hidden="true" className="size-4" /></span>
                              <span className="min-w-0"><span className="block truncate">{document.fileName}</span>{isActive ? <span className="mt-1 block text-[11px] font-medium text-[#711f3a]">{labels.active}</span> : null}</span>
                            </button>
                          </th>
                          <td className="whitespace-nowrap px-4 py-4"><DocumentStatusBadge locale={locale} status={status} /></td>
                          <td className="whitespace-nowrap px-4 py-4 text-[#6e676a]">{status === "completed" && document.pageCount > 0 ? document.pageCount : labels.noPages}</td>
                          <td className="whitespace-nowrap px-4 py-4 text-[#6e676a]">{formatDocumentFileSize(document.sizeBytes, locale)}</td>
                          <td className="whitespace-nowrap px-4 py-4 text-[#6e676a]">{formatUpdatedAt(document.updatedAt ?? document.createdAt, locale)}</td>
                          <td className="px-4 py-4 text-right"><ChevronRight aria-hidden="true" className="ml-auto size-4 text-[#969093]" /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </section>
  );
}
