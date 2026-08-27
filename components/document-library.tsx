"use client";

import Link from "next/link";
import { ArrowUpRight, FileText, MoreHorizontal } from "lucide-react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { Button } from "@/components/ui/button";
import { type AppLocale } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import type { ParseRunStatus } from "@/lib/document-parse-types";
import { cn } from "@/lib/utils";

type DocumentStatus = "not-started" | "processing" | "completed" | "failed";

const statusStyles: Record<DocumentStatus, string> = {
  "not-started": "bg-[#f2eff0] text-[#6e676a]",
  processing: "bg-[#fbf5e9] text-[#8d651e]",
  completed: "bg-[#eef4ef] text-[#3f7a55]",
  failed: "bg-[#fbefef] text-[#a23b3b]",
};

function getDocumentStatus(status: ParseRunStatus | null | undefined): DocumentStatus {
  if (status === "queued" || status === "running") return "processing";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "not-started";
}

function DocumentStatusBadge({ locale, status }: { locale: AppLocale; status: DocumentStatus }) {
  const labels = locale === "tr"
    ? { "not-started": "Parse için hazır", processing: "Ayrıştırılıyor", completed: "Parsed", failed: "Başarısız" }
    : { "not-started": "Ready to parse", processing: "Processing", completed: "Parsed", failed: "Failed" };
  return <span className={cn("inline-flex h-[26px] items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", statusStyles[status])}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{labels[status]}</span>;
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
        uploaded: "Yüklendi",
        active: "Aktif",
        open: "Dokümanı aç",
        menu: "Diğer işlemler",
        openParse: "Parsed içeriği aç",
        openChunks: "Chunk'ları aç",
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
        uploaded: "Uploaded",
        active: "Active",
        open: "Open document",
        menu: "More actions",
        openParse: "Open parsed content",
        openChunks: "Open chunks",
        noPages: "—",
      };

  return (
    <section aria-label={labels.title} className="mt-8 min-w-0" data-testid="document-library">
      <div className="flex h-[26px] items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold leading-[26px] tracking-[-0.02em] text-[#171416]">{labels.title}</h2>
        </div>
        {documents.length > 0 ? <span className="text-[13px] leading-[19.5px] text-[#6e676a]">{documents.length} {locale === "tr" ? "doküman" : documents.length === 1 ? "document" : "documents"}</span> : null}
      </div>
      <div className="mt-4">
        {persistenceStatus === "checking" ? <EmptyPipelineState>{labels.loading}</EmptyPipelineState> :
          persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></> :
            documents.length === 0 ? (
              <div className="rounded-[16px] border-[1.712px] border-dashed border-[#d8d2d5] bg-white px-6 py-12 text-center">
                <span className="mx-auto grid size-11 place-items-center rounded-full bg-[#fbf4f6] text-[#711f3a]"><FileText aria-hidden="true" className="size-5" /></span>
                <h3 className="mt-4 text-sm font-semibold">{labels.empty}</h3>
                <p className="mx-auto mt-1 max-w-sm text-sm leading-5 text-[#6e676a]">{labels.emptyDescription}</p>
              </div>
            ) : (
              <>
                <div className="hidden min-w-0 max-w-full overflow-x-auto rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white md:block" data-testid="document-library-table">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <caption className="sr-only">{labels.title}</caption>
                  <thead className="h-[43px] border-b-[1.712px] border-[#e7e2e4] bg-white text-xs font-medium uppercase tracking-[0.48px] text-[#969093]">
                    <tr>
                      <th className="px-5 py-3 font-medium">{labels.file}</th>
                      <th className="px-5 py-3 font-medium">{labels.pages}</th>
                      <th className="px-5 py-3 font-medium">{labels.size}</th>
                      <th className="px-5 py-3 font-medium">{labels.uploaded}</th>
                      <th className="px-5 py-3 font-medium">{labels.status}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e7e2e4]">
                    {documents.map((document) => {
                      const isActive = document.id === activeDocumentId;
                      const status = getDocumentStatus(document.latestParseStatus);
                      return (
                        <tr className={cn("h-[69px] transition-colors hover:bg-[#fbf4f6]/60", isActive && "bg-[#fbf4f6]/70")} key={document.id}>
                          <th className="max-w-[340px] px-5 py-[15px] text-left font-medium text-[#171416]" scope="row">
                            <button aria-label={`${labels.open}: ${document.fileName}`} aria-pressed={isActive} className="flex min-w-0 items-center gap-3 rounded-[7px] text-left outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" onClick={() => void selectPersistedDocument(document.id)} type="button">
                              <span className={cn("grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#fbf4f6]", isActive ? "text-[#711f3a]" : "text-[#711f3a]")}><FileText aria-hidden="true" className="size-[17px]" /></span>
                              <span className="min-w-0"><span className="block truncate text-sm leading-[21px]">{document.fileName} {isActive ? <span className="font-normal text-[11px] text-[#711f3a]">· {labels.active}</span> : null}</span><span className="mt-0.5 block text-xs leading-[18px] text-[#969093]">PDF</span></span>
                            </button>
                          </th>
                          <td className="whitespace-nowrap px-5 py-4 text-[13px] leading-[19.5px] text-[#6e676a]">{status === "completed" && document.pageCount > 0 ? document.pageCount : labels.noPages}</td>
                          <td className="whitespace-nowrap px-5 py-4 text-[13px] leading-[19.5px] text-[#6e676a]">{formatDocumentFileSize(document.sizeBytes, locale)}</td>
                          <td className="whitespace-nowrap px-5 py-4 text-[13px] leading-[19.5px] text-[#6e676a]">{formatUpdatedAt(document.createdAt ?? document.updatedAt, locale)}</td>
                          <td className="whitespace-nowrap px-5 py-4"><DocumentStatusBadge locale={locale} status={status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>

                <div className="md:hidden" data-testid="document-library-mobile">
                  <ul className="divide-y divide-[#e7e2e4] overflow-hidden rounded-[16px] border-[1.712px] border-[#e7e2e4] bg-white">
                    {documents.map((document) => {
                      const isActive = document.id === activeDocumentId;
                      const status = getDocumentStatus(document.latestParseStatus);
                      return (
                        <li className={cn("p-4", isActive && "bg-[#fbf4f6]/70")} data-testid="document-library-mobile-item" key={document.id}>
                          <article>
                            <div className="flex items-start gap-3">
                              <span className="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[#fbf4f6] text-[#711f3a]"><FileText aria-hidden="true" className="size-[17px]" /></span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="break-words text-sm font-medium leading-5 text-[#171416]">{document.fileName}</p>
                                    <p className="mt-0.5 text-xs leading-[18px] text-[#969093]">PDF</p>
                                  </div>
                                  <details className="relative shrink-0">
                                    <summary aria-label={`${labels.menu}: ${document.fileName}`} className="grid size-10 cursor-pointer list-none place-items-center rounded-[9px] text-[#6e676a] outline-none hover:bg-[#f2eff0] focus-visible:ring-2 focus-visible:ring-[#711f3a]/25 [&::-webkit-details-marker]:hidden">
                                      <MoreHorizontal aria-hidden="true" className="size-4" />
                                    </summary>
                                    <div className="absolute right-0 top-11 z-10 min-w-[184px] rounded-[10px] border border-[#e7e2e4] bg-white p-1.5 shadow-lg">
                                      <Link className="flex min-h-10 items-center justify-between gap-3 rounded-[7px] px-2.5 text-sm text-[#171416] hover:bg-[#fbf4f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" href="/parse" onClick={() => void selectPersistedDocument(document.id)}>{labels.openParse}<ArrowUpRight aria-hidden="true" className="size-3.5 text-[#711f3a]" /></Link>
                                      <Link className="flex min-h-10 items-center justify-between gap-3 rounded-[7px] px-2.5 text-sm text-[#171416] hover:bg-[#fbf4f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#711f3a]/25" href="/chunking" onClick={() => void selectPersistedDocument(document.id)}>{labels.openChunks}<ArrowUpRight aria-hidden="true" className="size-3.5 text-[#711f3a]" /></Link>
                                    </div>
                                  </details>
                                </div>
                                <div className="mt-3"><DocumentStatusBadge locale={locale} status={status} /></div>
                                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-[#eee9eb] pt-3">
                                  <div className="min-w-0"><dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#969093]">{labels.pages}</dt><dd className="mt-1 truncate text-xs text-[#6e676a]">{status === "completed" && document.pageCount > 0 ? document.pageCount : labels.noPages}</dd></div>
                                  <div className="min-w-0"><dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#969093]">{labels.size}</dt><dd className="mt-1 truncate text-xs text-[#6e676a]">{formatDocumentFileSize(document.sizeBytes, locale)}</dd></div>
                                  <div className="min-w-0"><dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#969093]">{labels.uploaded}</dt><dd className="mt-1 truncate text-xs text-[#6e676a]">{formatUpdatedAt(document.createdAt ?? document.updatedAt, locale)}</dd></div>
                                </dl>
                                <Button aria-label={`${labels.open}: ${document.fileName}`} aria-pressed={isActive} className="mt-4 w-full justify-between" onClick={() => void selectPersistedDocument(document.id)} size="default" type="button" variant="outline">
                                  <span>{labels.open}</span><ArrowUpRight aria-hidden="true" className="size-4 text-[#711f3a]" />
                                </Button>
                              </div>
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
      </div>
    </section>
  );
}
