"use client";

import { TransitionDetails, TransitionText } from "@/components/ui/transitions";

import Link from "next/link";
import { Fragment, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { TransitionDialogContent } from "@/components/ui/transition-surface";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { PipelineErrorMessage } from "@/components/pipeline-learning-ui";
import { usePreferences } from "@/components/preferences-provider";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { type AppLocale, useCopy } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import type { ParseRunStatus } from "@/lib/document-parse-types";
import { formatCount, formatNumber } from "@/lib/format";
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

function DocumentStatusBadge({ status }: { status: DocumentStatus }) {
  const copy = useCopy();
  return <StatusPill tone={statusTones[status]}>{copy.documents.library.status[status]}</StatusPill>;
}

function formatUpdatedAt(value: string | null, locale: AppLocale) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "tr" ? "tr-TR" : "en-US", { dateStyle: "medium" }).format(date);
}

/** Long file names break after separators (_ - .) instead of mid-word on narrow screens. */
export function BreakableFileName({ name }: { name: string }) {
  const parts = name.split(/(?<=[_\-.])/);
  return <>{parts.map((part, index) => <Fragment key={index}>{part}{index < parts.length - 1 ? <wbr /> : null}</Fragment>)}</>;
}

export function DocumentLibrary() {
  const copy = useCopy();
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const labels = copy.documents.library;
  const { documents, activeDocumentId, persistenceStatus, persistenceError, selectPersistedDocument, deletePersistedDocument } = useDocumentPipeline();
  const [documentPendingDelete, setDocumentPendingDelete] = useState<PersistedDocument | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const deleteOrigin = useRef<HTMLElement | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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

  const pagesFor = (document: PersistedDocument, status: DocumentStatus) => status === "completed" && document.pageCount > 0 ? formatNumber(locale, document.pageCount) : "—";

  return (
    <section aria-label={labels.title} className="mt-8 min-w-0" data-testid="document-library">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{labels.title}</h2>
        {documents.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">{formatCount(locale, documents.length, copy.units.document)}</span>
            {activeDocumentId ? <Button asChild data-testid="documents-continue-action" size="sm"><Link href="/parse">{labels.continue}<AppIcon className="size-3.5" name="arrowRight" /></Link></Button> : null}
          </div>
        ) : null}
      </div>
      <div className="mt-4">
        {persistenceStatus === "checking" ? <Skeleton label={labels.loading} rowClassName="h-14" /> :
          persistenceStatus === "unavailable" ? (
            <div className="space-y-3">
              <EmptyState className="rounded-lg border border-border bg-card py-8" icon="warning" title={labels.unavailable} titleAs="p" />
              <PipelineErrorMessage message={persistenceError?.message} />
            </div>
          ) :
            documents.length === 0 ? (
              <EmptyState className="rounded-lg border border-dashed border-input bg-card py-12" description={labels.emptyDescription} icon="document" title={labels.empty} />
            ) : (
              <>
                {/* The fixed columns take 560px; 880px keeps >=320px for the name column so the
                    file name stays readable next to the "In use" badge. Below lg the cards are used. */}
                <div className="hidden min-w-0 max-w-full overflow-x-auto rounded-lg border border-border bg-card lg:block" data-testid="document-library-table">
                  <table className="w-full min-w-[880px] table-fixed text-left text-sm">
                    <caption className="sr-only">{labels.title}</caption>
                    <colgroup>
                      <col />
                      <col className="w-20" />
                      <col className="w-24" />
                      <col className="w-36" />
                      <col className="w-36" />
                      <col className="w-24" />
                    </colgroup>
                    <thead className="border-b border-border bg-card text-2xs font-medium uppercase tracking-wide text-subtle-foreground">
                      <tr>
                        <th className="px-5 py-3 font-medium" scope="col">{labels.columns.document}</th>
                        <th className="px-5 py-3 text-right font-medium" scope="col">{labels.columns.pages}</th>
                        <th className="px-5 py-3 text-right font-medium" scope="col">{labels.columns.size}</th>
                        <th className="px-5 py-3 font-medium" scope="col">{labels.columns.uploaded}</th>
                        <th className="px-5 py-3 font-medium" scope="col">{labels.columns.status}</th>
                        <th className="px-5 py-3 text-right font-medium" scope="col"><span className="sr-only">{labels.columns.actions}</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {documents.map((document) => {
                        const isActive = document.id === activeDocumentId;
                        const status = getDocumentStatus(document.latestParseStatus);
                        return (
                          <tr className={cn("transition-colors hover:bg-surface-subtle", isActive && "bg-secondary shadow-[inset_2px_0_0_var(--ring)] hover:bg-secondary")} data-testid="document-library-row" key={document.id}>
                            <th className="min-w-0 px-5 py-3 text-left font-medium text-foreground" scope="row">
                              <button aria-label={`${labels.select}: ${document.fileName}`} aria-pressed={isActive} className="flex w-full min-w-0 items-center gap-3 rounded-md text-left" onClick={() => void selectPersistedDocument(document.id)} title={document.fileName} type="button">
                                <span className={cn("grid size-9 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground", isActive && "bg-card text-brand")}><AppIcon name="document" className="size-4" /></span>
                                <span className="min-w-0 flex-1 truncate text-sm" data-testid="document-library-name">{document.fileName}</span>
                                {isActive ? <StatusPill className="shrink-0" tone="neutral">{labels.inUse}</StatusPill> : null}
                              </button>
                            </th>
                            <td className="whitespace-nowrap px-5 py-3 text-right text-sm text-muted-foreground tabular-nums">{pagesFor(document, status)}</td>
                            <td className="whitespace-nowrap px-5 py-3 text-right text-sm text-muted-foreground tabular-nums">{formatDocumentFileSize(document.sizeBytes, locale)}</td>
                            <td className="whitespace-nowrap px-5 py-3 text-sm text-muted-foreground">{formatUpdatedAt(document.createdAt ?? document.updatedAt, locale)}</td>
                            <td className="whitespace-nowrap px-5 py-3"><DocumentStatusBadge status={status} /></td>
                            <td className="whitespace-nowrap px-5 py-3 text-right">
                              <Button aria-label={`${copy.common.delete}: ${document.fileName}`} className="text-muted-foreground hover:bg-destructive-subtle hover:text-destructive" disabled={deletingDocumentId === document.id} onClick={() => requestDelete(document)} size="icon-sm" title={copy.common.delete} type="button" variant="ghost"><AppIcon name="trash" className="size-4" /></Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="lg:hidden" data-testid="document-library-mobile">
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
                                  <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-foreground [overflow-wrap:anywhere]" title={document.fileName}><BreakableFileName name={document.fileName} /></p>
                                  <TransitionDetails className="relative shrink-0" variant="dropdown">
                                    <summary aria-label={`${labels.menu}: ${document.fileName}`} className="grid size-9 cursor-pointer list-none place-items-center rounded-md text-muted-foreground hover:bg-secondary [&::-webkit-details-marker]:hidden">
                                      <AppIcon name="moreHorizontal" className="size-4" />
                                    </summary>
                                    <div className="absolute right-0 top-10 z-10 min-w-[184px] rounded-md border border-border bg-card p-1.5 shadow-lg">
                                      <Link className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2.5 text-sm text-foreground hover:bg-secondary" href="/parse" onClick={() => void selectPersistedDocument(document.id)}>{labels.openParse}<AppIcon name="arrowUpRight" className="size-3.5 text-muted-foreground" /></Link>
                                      <Link className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2.5 text-sm text-foreground hover:bg-secondary" href="/chunking" onClick={() => void selectPersistedDocument(document.id)}>{labels.openChunks}<AppIcon name="arrowUpRight" className="size-3.5 text-muted-foreground" /></Link>
                                      <button aria-label={`${copy.common.delete}: ${document.fileName}`} className="flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-sm text-destructive hover:bg-destructive-subtle disabled:pointer-events-none disabled:opacity-50" disabled={deletingDocumentId === document.id} onClick={() => requestDelete(document)} type="button"><AppIcon name="trash" className="size-4" />{copy.common.delete}</button>
                                    </div>
                                  </TransitionDetails>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <DocumentStatusBadge status={status} />
                                  {isActive ? <StatusPill tone="neutral">{labels.inUse}</StatusPill> : null}
                                </div>
                                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border-subtle pt-3">
                                  <div className="min-w-0"><dt className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{labels.columns.pages}</dt><dd className="mt-1 truncate text-xs text-muted-foreground tabular-nums">{pagesFor(document, status)}</dd></div>
                                  <div className="min-w-0"><dt className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{labels.columns.size}</dt><dd className="mt-1 truncate text-xs text-muted-foreground tabular-nums">{formatDocumentFileSize(document.sizeBytes, locale)}</dd></div>
                                  <div className="min-w-0"><dt className="text-2xs font-medium uppercase tracking-wide text-subtle-foreground">{labels.columns.uploaded}</dt><dd className="mt-1 truncate text-xs text-muted-foreground">{formatUpdatedAt(document.createdAt ?? document.updatedAt, locale)}</dd></div>
                                </dl>
                                <Button aria-label={`${labels.select}: ${document.fileName}`} aria-pressed={isActive} className="mt-3 w-full justify-between" onClick={() => void selectPersistedDocument(document.id)} type="button" variant="outline">
                                  <span>{labels.select}</span><AppIcon name="arrowUpRight" className="size-4 text-muted-foreground" />
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
                            <Button aria-label={copy.common.cancel} disabled={deletingDocumentId !== null} size="icon-sm" title={copy.common.cancel} type="button" variant="ghost"><AppIcon name="close" className="size-4" /></Button>
                          </DialogPrimitive.Close>
                        </div>
                        <DialogPrimitive.Description className="mt-2 text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground [overflow-wrap:anywhere]">{documentPendingDelete.fileName}</span> — {labels.deleteDescription}</DialogPrimitive.Description>
                        {deleteError ? <p className="mt-3 text-sm text-destructive" role="alert">{deleteError}</p> : null}
                        <div className="mt-5 flex flex-wrap justify-end gap-2">
                          <DialogPrimitive.Close asChild>
                            <Button disabled={deletingDocumentId !== null} size="sm" type="button" variant="outline">{copy.common.cancel}</Button>
                          </DialogPrimitive.Close>
                          <Button disabled={deletingDocumentId !== null} onClick={() => void confirmDelete()} size="sm" variant="destructive"><TransitionText>{deletingDocumentId ? copy.common.deleting : copy.common.delete}</TransitionText></Button>
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
