"use client";

import { TransitionDetails } from "@/components/ui/transitions";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";

import { useDocumentPipeline } from "@/components/document-pipeline-provider";
import { usePreferences } from "@/components/preferences-provider";
import { SampleDocumentButton } from "@/components/sample-document-button";
import { AppIcon } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal, ModalClose, ModalContent, ModalFooter } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type Status } from "@/components/ui/status-badge";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/components/ui/toast";
import { Tooltip } from "@/components/ui/tooltip";
import { type AppLocale, useCopy } from "@/lib/copy";
import { formatDocumentFileSize } from "@/lib/document-file";
import type { ParseRunStatus } from "@/lib/document-parse-types";
import { formatCount, formatNumber } from "@/lib/format";
import type { PersistedDocument } from "@/lib/rag-api-types";
import { cn } from "@/lib/utils";

type DocumentStatus = "not-started" | "processing" | "completed" | "failed";

/** Parsed is done work (neutral); only a running parse is "now" and a failure is red. */
const documentStatus: Record<DocumentStatus, Status> = {
  "not-started": "idle",
  processing: "processing",
  completed: "completed",
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
  return <StatusBadge appearance="pill" status={documentStatus[status]}>{copy.documents.library.status[status]}</StatusBadge>;
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

/** File tile; the document in use gets the brand icon (it is "where you are"). */
function FileTile({ active }: { active: boolean }) {
  return (
    <span aria-hidden="true" className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-primary shadow-xs ring-1 ring-secondary ring-inset", active ? "text-fg-brand-primary" : "text-fg-quaternary")}>
      <AppIcon name="document" className="size-4.5" />
    </span>
  );
}

const menuItemClass = "flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2.5 text-left text-sm font-medium text-secondary transition-colors duration-100 hover:bg-primary_hover hover:text-primary";

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
  const mobileListRef = useRef<HTMLUListElement>(null);

  // Row menus are <details> dropdowns: an outside press closes any open one.
  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      mobileListRef.current?.querySelectorAll<HTMLDetailsElement>("details[open]").forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.open = false;
      });
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

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
      toast.success(labels.deleted, { description: target.fileName });
    } catch (error) {
      setDeleteError(error instanceof Error && error.message ? error.message : labels.deleteFailed);
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const pagesFor = (document: PersistedDocument, status: DocumentStatus) => status === "completed" && document.pageCount > 0 ? formatNumber(locale, document.pageCount) : "—";
  const deleting = deletingDocumentId !== null;

  return (
    <section aria-label={labels.title} className="min-w-0" data-testid="document-library">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="text-lg font-semibold text-primary">{labels.title}</h2>
          {documents.length > 0 ? <Badge color="gray" size="sm">{formatCount(locale, documents.length, copy.units.document)}</Badge> : null}
        </div>
        {documents.length > 0 && activeDocumentId ? (
          <Button asChild data-testid="documents-continue-action"><Link href="/parse">{labels.continue}<AppIcon className="size-4" name="arrowRight" /></Link></Button>
        ) : null}
      </div>
      <div className="mt-4">
        {persistenceStatus === "checking" ? <Skeleton label={labels.loading} rowClassName="h-14" /> :
          persistenceStatus === "unavailable" ? (
            <Notice role="alert" title={labels.unavailable} tone="error">{persistenceError?.message}</Notice>
          ) :
            documents.length === 0 ? (
              <TableCard>
                <EmptyState action={<SampleDocumentButton primary size="lg" />} description={labels.emptyDescription} icon="document" title={labels.empty} />
              </TableCard>
            ) : (
              <>
                {/* The fixed columns take 560px; 880px keeps >=320px for the name column so the
                    file name stays readable next to the "In use" badge. Below lg the cards are used. */}
                <TableCard className="hidden lg:block" data-testid="document-library-table">
                  <Table className="min-w-220 table-fixed text-left">
                    <caption className="sr-only">{labels.title}</caption>
                    <colgroup>
                      <col />
                      <col className="w-20" />
                      <col className="w-24" />
                      <col className="w-36" />
                      <col className="w-36" />
                      <col className="w-20" />
                    </colgroup>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="px-5" scope="col">{labels.columns.document}</TableHead>
                        <TableHead numeric scope="col">{labels.columns.pages}</TableHead>
                        <TableHead numeric scope="col">{labels.columns.size}</TableHead>
                        <TableHead className="pl-8" scope="col">{labels.columns.uploaded}</TableHead>
                        <TableHead scope="col">{labels.columns.status}</TableHead>
                        <TableHead numeric scope="col"><span className="sr-only">{labels.columns.actions}</span></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {documents.map((document) => {
                        const isActive = document.id === activeDocumentId;
                        const status = getDocumentStatus(document.latestParseStatus);
                        return (
                          <TableRow className="group/row" data-state={isActive ? "selected" : undefined} data-testid="document-library-row" key={document.id}>
                            <th className="relative min-w-0 px-5 py-3 text-left align-middle font-medium" scope="row">
                              {isActive ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-fg-brand-primary" /> : null}
                              <button aria-label={`${labels.select}: ${document.fileName}`} aria-pressed={isActive} className="flex w-full min-w-0 items-center gap-3 rounded-md text-left" onClick={() => void selectPersistedDocument(document.id)} title={document.fileName} type="button">
                                <FileTile active={isActive} />
                                <span className={cn("min-w-0 flex-1 truncate text-sm", isActive ? "font-semibold text-primary" : "font-medium text-secondary group-hover/row:text-primary")} data-testid="document-library-name">{document.fileName}</span>
                                {isActive ? <Badge className="shrink-0" color="brand" size="sm">{labels.inUse}</Badge> : null}
                              </button>
                            </th>
                            <TableCell className="text-tertiary" numeric>{pagesFor(document, status)}</TableCell>
                            <TableCell className="text-tertiary" numeric>{formatDocumentFileSize(document.sizeBytes, locale)}</TableCell>
                            <TableCell className="pl-8 text-tertiary">{formatUpdatedAt(document.createdAt ?? document.updatedAt, locale)}</TableCell>
                            <TableCell><DocumentStatusBadge status={status} /></TableCell>
                            <TableCell numeric>
                              <Tooltip placement="left" title={copy.common.delete}>
                                <Button aria-label={`${copy.common.delete}: ${document.fileName}`} className="text-fg-quaternary hover:bg-error-primary hover:text-fg-error-primary" disabled={deletingDocumentId === document.id} onClick={() => requestDelete(document)} size="icon-sm" type="button" variant="tertiary"><AppIcon name="trash" className="size-4" /></Button>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableCard>

                <div className="lg:hidden" data-testid="document-library-mobile">
                  <ul className="divide-y divide-secondary overflow-hidden rounded-xl bg-primary shadow-xs ring-1 ring-secondary" ref={mobileListRef}>
                    {documents.map((document) => {
                      const isActive = document.id === activeDocumentId;
                      const status = getDocumentStatus(document.latestParseStatus);
                      return (
                        <li className={cn("relative p-4", isActive && "bg-active")} data-testid="document-library-mobile-item" key={document.id}>
                          {isActive ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-fg-brand-primary" /> : null}
                          <article className="flex items-start gap-3">
                            <FileTile active={isActive} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start gap-2">
                                <p className="min-w-0 flex-1 pt-2 text-sm font-semibold text-primary wrap-anywhere" title={document.fileName}><BreakableFileName name={document.fileName} /></p>
                                <TransitionDetails className="relative shrink-0" variant="dropdown">
                                  <summary aria-label={`${labels.menu}: ${document.fileName}`} className="grid size-9 cursor-pointer list-none place-items-center rounded-lg text-fg-quaternary transition-colors hover:bg-primary_hover hover:text-fg-quaternary_hover [&::-webkit-details-marker]:hidden">
                                    <AppIcon name="moreHorizontal" className="size-5" />
                                  </summary>
                                  <div className="absolute right-0 top-10 z-10 flex w-56 flex-col rounded-xl bg-primary_alt p-1.5 shadow-lg ring-1 ring-secondary_alt">
                                    <Link className={menuItemClass} href="/parse" onClick={() => void selectPersistedDocument(document.id)}>{labels.openParse}<AppIcon name="arrowUpRight" className="size-4 text-fg-quaternary" /></Link>
                                    <Link className={menuItemClass} href="/chunking" onClick={() => void selectPersistedDocument(document.id)}>{labels.openChunks}<AppIcon name="arrowUpRight" className="size-4 text-fg-quaternary" /></Link>
                                    <div aria-hidden="true" className="-mx-1.5 my-1.5 h-px bg-border-secondary" />
                                    <button aria-label={`${copy.common.delete}: ${document.fileName}`} className={cn(menuItemClass, "justify-start text-error-primary hover:bg-error-primary hover:text-error-primary_hover disabled:cursor-not-allowed disabled:text-disabled")} disabled={deletingDocumentId === document.id} onClick={() => requestDelete(document)} type="button"><AppIcon name="trash" className="size-4" />{copy.common.delete}</button>
                                  </div>
                                </TransitionDetails>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                <DocumentStatusBadge status={status} />
                                {isActive ? <Badge color="brand" size="sm">{labels.inUse}</Badge> : null}
                              </div>
                              <dl className="mt-3 grid grid-cols-3 gap-3">
                                <div className="min-w-0"><dt className="text-xs text-quaternary">{labels.columns.pages}</dt><dd className="mt-0.5 truncate text-sm font-medium text-secondary tabular-nums">{pagesFor(document, status)}</dd></div>
                                <div className="min-w-0"><dt className="text-xs text-quaternary">{labels.columns.size}</dt><dd className="mt-0.5 truncate text-sm font-medium text-secondary tabular-nums">{formatDocumentFileSize(document.sizeBytes, locale)}</dd></div>
                                <div className="min-w-0"><dt className="text-xs text-quaternary">{labels.columns.uploaded}</dt><dd className="mt-0.5 truncate text-sm font-medium text-secondary">{formatUpdatedAt(document.createdAt ?? document.updatedAt, locale)}</dd></div>
                              </dl>
                              <Button aria-label={`${labels.select}: ${document.fileName}`} aria-pressed={isActive} className="mt-4 w-full aria-pressed:bg-active" iconLeading={isActive ? "check" : undefined} onClick={() => void selectPersistedDocument(document.id)} type="button" variant="secondary">
                                {labels.select}
                              </Button>
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <Modal
                  onOpenChange={(open) => {
                    if (!open && deletingDocumentId === null) {
                      setDeleteDialogOpen(false);
                    }
                  }}
                  open={deleteDialogOpen}
                >
                  {documentPendingDelete ? (
                    <ModalContent
                      data-testid="delete-document-dialog"
                      description={<><span className="font-medium text-primary wrap-anywhere">{documentPendingDelete.fileName}</span> — {labels.deleteDescription}</>}
                      icon="trash"
                      iconColor="error"
                      onCloseAutoFocus={(event) => { if (deleteOrigin.current?.isConnected) { event.preventDefault(); deleteOrigin.current.focus(); } setDocumentPendingDelete(null); setDeleteError(null); }}
                      size="sm"
                      title={labels.deleteTitle}
                    >
                      {deleteError ? <p className="px-6 pt-4 text-sm text-error-primary" role="alert">{deleteError}</p> : null}
                      <ModalFooter>
                        <ModalClose asChild>
                          <Button disabled={deleting} size="lg" type="button" variant="secondary">{copy.common.cancel}</Button>
                        </ModalClose>
                        <Button disabled={deleting} isLoading={deleting} onClick={() => void confirmDelete()} size="lg" variant="destructive">{copy.common.delete}</Button>
                      </ModalFooter>
                    </ModalContent>
                  ) : null}
                </Modal>
              </>
            )}
      </div>
    </section>
  );
}
