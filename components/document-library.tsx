"use client";

import { TransitionDetails, TransitionText } from "@/components/ui/transitions";

import Link from "next/link";
import { useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { TransitionDialogContent } from "@/components/ui/transition-surface";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { EmptyPipelineState, PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { type AppLocale } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import type { ParseRunStatus } from "@/lib/document-parse-types";
import type { PersistedDocument } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";

type DocumentStatus = "not-started" | "processing" | "completed" | "failed";

const statusTones: Record<DocumentStatus, StatusTone> = {
  "not-started": "idle",
  processing: "running",
  completed: "neutral",
  failed: "error",
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
  return <StatusPill tone={statusTones[status]}>{labels[status]}</StatusPill>;
}

function formatUpdatedAt(value: string | null, locale: AppLocale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(date);
}

export function DocumentLibrary({ locale }: { locale: AppLocale }) {
  const { documents, activeDocumentId, persistenceStatus, persistenceError, selectPersistedDocument, deletePersistedDocument } = useDocumentPipeline();
  const [documentPendingDelete, setDocumentPendingDelete] = useState<PersistedDocument | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteOrigin = useRef<HTMLElement | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
        actions: "İşlemler",
        open: "Dokümanı seç",
        continue: "Parsing'e devam et",
        menu: "Diğer işlemler",
        openParse: "Parsed içeriği aç",
        openChunks: "Chunk'ları aç",
        delete: "Sil",
        deleting: "Siliniyor…",
        deleteTitle: "Dokümanı silmek istediğinizden emin misiniz?",
        deleteDescription: "Bu işlem parse, chunk, embedding ve ilişkili pipeline verilerini de kaldırır. Devam etmek istiyor musunuz?",
        cancel: "İptal",
        deleteFailed: "Doküman silinemedi. Lütfen tekrar deneyin.",
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
        actions: "Actions",
        open: "Select document",
        continue: "Continue to Parsing",
        menu: "More actions",
        openParse: "Open parsed content",
        openChunks: "Open chunks",
        delete: "Delete",
        deleting: "Deleting…",
        deleteTitle: "Are you sure you want to delete this document?",
        deleteDescription: "This also removes its parse, chunk, embedding, and related pipeline data. Do you want to continue?",
        cancel: "Cancel",
        deleteFailed: "The document could not be deleted. Please try again.",
        noPages: "—",
      };

  const requestDelete = (document: PersistedDocument) => {
    deleteOrigin.current = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
    setDeleteError(null);
    setDocumentPendingDelete(document);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!documentPendingDelete) return;
    const target = documentPendingDelete;
    setDeletingDocumentId(target.id);
    setDeleteError(null);
    try {
      await deletePersistedDocument(target.id);
      setDeleteDialogOpen(false);
    } catch (error) {
      setDeleteError(error instanceof Error && error.message ? error.message : labels.deleteFailed);
    } finally {
      setDeletingDocumentId(null);
    }
  };

  return (
    <section aria-label={labels.title} className="mt-8 min-w-0" data-testid="document-library">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{labels.title}</h2>
        </div>
        {documents.length > 0 ? <div className="flex flex-wrap items-center gap-3"><span className="text-sm text-muted-foreground tabular-nums">{documents.length} {locale === "tr" ? "doküman" : documents.length === 1 ? "document" : "documents"}</span>{activeDocumentId ? <Link className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline" href="/parse">{labels.continue}<AppIcon className="size-3.5" name="arrowRight" /></Link> : null}</div> : null}
      </div>
      <div className="mt-4">
        {persistenceStatus === "checking" ? <Skeleton label={labels.loading} rowClassName="h-14" /> :
          persistenceStatus === "unavailable" ? <><EmptyPipelineState>{labels.unavailable}</EmptyPipelineState><PipelineErrorMessage message={persistenceError?.message} /></> :
            documents.length === 0 ? (
              <EmptyState className="rounded-lg border border-dashed border-input bg-card py-12" description={labels.emptyDescription} icon="document" title={labels.empty} />
            ) : (
              <>
                <div className="hidden min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-card md:block" data-testid="document-library-table">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <caption className="sr-only">{labels.title}</caption>
                  <thead className="border-b border-border bg-card text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium">{labels.file}</th>
                      <th className="px-5 py-3 text-right font-medium">{labels.pages}</th>
                      <th className="px-5 py-3 text-right font-medium">{labels.size}</th>
                      <th className="px-5 py-3 font-medium">{labels.uploaded}</th>
                      <th className="px-5 py-3 font-medium">{labels.status}</th>
                      <th className="px-5 py-3 text-right font-medium">{labels.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {documents.map((document) => {
                      const isActive = document.id === activeDocumentId;
                      const status = getDocumentStatus(document.latestParseStatus);
                      return (
                        <tr className={cn("transition-colors hover:bg-surface-subtle", isActive && "bg-secondary shadow-[inset_2px_0_0_var(--ring)] hover:bg-secondary")} key={document.id}>
                          <th className="max-w-[340px] px-5 py-4 text-left font-medium text-foreground" scope="row">
                            <button aria-label={`${labels.open}: ${document.fileName}`} aria-pressed={isActive} className="flex min-w-0 items-center gap-3 rounded-md text-left" onClick={() => void selectPersistedDocument(document.id)} type="button">
                              <span className={cn("grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground", isActive && "bg-card text-brand")}><AppIcon name="document" className="size-4" /></span>
                              <span className="min-w-0"><span className="block truncate text-sm">{document.fileName} {isActive ? <span className="text-xs font-normal text-muted-foreground">· {labels.active}</span> : null}</span><span className="mt-0.5 block text-xs text-subtle-foreground">PDF</span></span>
                            </button>
                          </th>
                          <td className="whitespace-nowrap px-5 py-4 text-right text-sm text-muted-foreground tabular-nums">{status === "completed" && document.pageCount > 0 ? document.pageCount : labels.noPages}</td>
                          <td className="whitespace-nowrap px-5 py-4 text-right text-sm text-muted-foreground tabular-nums">{formatDocumentFileSize(document.sizeBytes, locale)}</td>
                          <td className="whitespace-nowrap px-5 py-4 text-sm text-muted-foreground">{formatUpdatedAt(document.createdAt ?? document.updatedAt, locale)}</td>
                          <td className="whitespace-nowrap px-5 py-4"><DocumentStatusBadge locale={locale} status={status} /></td>
                          <td className="whitespace-nowrap px-5 py-4 text-right">
                            <Button aria-label={`${labels.delete}: ${document.fileName}`} className="text-muted-foreground hover:bg-destructive-subtle hover:text-destructive" disabled={deletingDocumentId === document.id} onClick={() => requestDelete(document)} size="icon-sm" title={labels.delete} type="button" variant="ghost"><AppIcon name="trash" className="size-4" /></Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>

                <div className="md:hidden" data-testid="document-library-mobile">
                  <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                    {documents.map((document) => {
                      const isActive = document.id === activeDocumentId;
                      const status = getDocumentStatus(document.latestParseStatus);
                      return (
                        <li className={cn("p-4", isActive && "bg-secondary shadow-[inset_2px_0_0_var(--ring)]")} data-testid="document-library-mobile-item" key={document.id}>
                          <article>
                            <div className="flex items-start gap-3">
                              <span className={cn("grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground", isActive && "bg-card text-brand")}><AppIcon name="document" className="size-4" /></span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="break-words text-sm font-medium leading-5 text-foreground">{document.fileName}</p>
                                    <p className="mt-0.5 text-xs text-subtle-foreground">PDF</p>
                                  </div>
                                  <TransitionDetails className="relative shrink-0" variant="dropdown">
                                    <summary aria-label={`${labels.menu}: ${document.fileName}`} className="grid size-9 cursor-pointer list-none place-items-center rounded-md text-muted-foreground hover:bg-secondary [&::-webkit-details-marker]:hidden">
                                      <AppIcon name="moreHorizontal" className="size-4" />
                                    </summary>
                                    <div className="absolute right-0 top-10 z-10 min-w-[184px] rounded-md border border-border bg-card p-1.5 shadow-lg">
                                      <Link className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2.5 text-sm text-foreground hover:bg-secondary" href="/parse" onClick={() => void selectPersistedDocument(document.id)}>{labels.openParse}<AppIcon name="arrowUpRight" className="size-3.5 text-muted-foreground" /></Link>
                                      <Link className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2.5 text-sm text-foreground hover:bg-secondary" href="/chunking" onClick={() => void selectPersistedDocument(document.id)}>{labels.openChunks}<AppIcon name="arrowUpRight" className="size-3.5 text-muted-foreground" /></Link>
                                      <button aria-label={`${labels.delete}: ${document.fileName}`} className="flex min-h-9 w-full items-center justify-center rounded-md px-2.5 text-destructive hover:bg-destructive-subtle disabled:pointer-events-none disabled:opacity-50" disabled={deletingDocumentId === document.id} onClick={() => requestDelete(document)} title={labels.delete} type="button"><AppIcon name="trash" className="size-4" /></button>
                                    </div>
                                  </TransitionDetails>
                                </div>
                                <div className="mt-3"><DocumentStatusBadge locale={locale} status={status} /></div>
                                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3">
                                  <div className="min-w-0"><dt className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{labels.pages}</dt><dd className="mt-1 truncate text-xs text-muted-foreground tabular-nums">{status === "completed" && document.pageCount > 0 ? document.pageCount : labels.noPages}</dd></div>
                                  <div className="min-w-0"><dt className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{labels.size}</dt><dd className="mt-1 truncate text-xs text-muted-foreground tabular-nums">{formatDocumentFileSize(document.sizeBytes, locale)}</dd></div>
                                  <div className="min-w-0"><dt className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{labels.uploaded}</dt><dd className="mt-1 truncate text-xs text-muted-foreground">{formatUpdatedAt(document.createdAt ?? document.updatedAt, locale)}</dd></div>
                                </dl>
                                <Button aria-label={`${labels.open}: ${document.fileName}`} aria-pressed={isActive} className="mt-4 w-full justify-between" onClick={() => void selectPersistedDocument(document.id)} size="default" type="button" variant="outline">
                                  <span>{labels.open}</span><AppIcon name="arrowUpRight" className="size-4 text-muted-foreground" />
                                </Button>
                              </div>
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <DialogPrimitive.Root
                  onOpenChange={(open) => {
                    if (!open && deletingDocumentId === null) {
                      setDeleteDialogOpen(false);
                    }
                  }}
                  open={deleteDialogOpen}
                >
                  {documentPendingDelete ? (
                    <DialogPrimitive.Portal>
                      <DialogPrimitive.Overlay className="steplab-overlay fixed inset-0 z-50 bg-overlay/35 dark:bg-overlay/65" data-testid="delete-document-overlay" />
                      <TransitionDialogContent onCloseAutoFocus={(event) => { if (deleteOrigin.current?.isConnected) { event.preventDefault(); deleteOrigin.current.focus(); } setDocumentPendingDelete(null); setDeleteError(null); }} className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none sm:p-6" data-testid="delete-document-dialog">
                        <div className="flex items-start justify-between gap-4">
                          <DialogPrimitive.Title className="text-base font-semibold text-foreground">{labels.deleteTitle}</DialogPrimitive.Title>
                          <DialogPrimitive.Close asChild>
                            <Button aria-label={labels.cancel} disabled={deletingDocumentId !== null} size="icon-sm" title={labels.cancel} type="button" variant="ghost"><AppIcon name="close" className="size-4" /></Button>
                          </DialogPrimitive.Close>
                        </div>
                        <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground">{documentPendingDelete.fileName}</span> — {labels.deleteDescription}</DialogPrimitive.Description>
                        {deleteError ? <p className="mt-3 text-sm text-destructive" role="alert">{deleteError}</p> : null}
                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                          <DialogPrimitive.Close asChild>
                            <Button disabled={deletingDocumentId !== null} size="sm" type="button" variant="outline">{labels.cancel}</Button>
                          </DialogPrimitive.Close>
                          <Button disabled={deletingDocumentId !== null} onClick={() => void confirmDelete()} size="sm" variant="destructive"><TransitionText>{deletingDocumentId ? labels.deleting : labels.delete}</TransitionText></Button>
                        </div>
                      </TransitionDialogContent>
                    </DialogPrimitive.Portal>
                  ) : null}
                </DialogPrimitive.Root>
              </>
            )}
      </div>
    </section>
  );
}

