"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { usePreferences } from "@/components/preferences-provider";
import { OcrSourceDetails } from "@/components/ocr-source-details";
import { AppIcon } from "@/components/ui/app-icon";
import { Badge } from "@/components/ui/badge";
import { Button, buttonStyles } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/disclosure";
import { Notice } from "@/components/ui/notice";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@/components/ui/preview-card";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { TransitionPanel } from "@/components/ui/transitions";
import { interpolate, UI_COPY } from "@/lib/copy";
import type { DocumentParseResponse, SourceRegion } from "@/lib/document-parse-types";
import { getDocumentSourcePreviewUrl } from "@/lib/rag-api";
import { cn } from "@/lib/utils";

type SourceInspectorProps = {
  documentId: string | null;
  parseResult: DocumentParseResponse | null;
  pageNumbers?: number[];
  sourceElementIds?: string[];
  headingPath?: string[];
  triggerLabel?: string;
  triggerAriaLabel?: string;
  /**
   * `button`: a secondary button. `link`: a quiet text action. `icon`: an icon-only action with
   * `triggerLabel` as its tooltip, for dense ranked lists. `chip`: a compact inline citation
   * marker inside answer text.
   */
  variant?: "button" | "link" | "icon" | "chip";
  /** Chip only: the citation did not validate against the context. */
  invalid?: boolean;
  /** Rich hover/focus preview for the trigger (citation → passage). The click still opens the inspector. */
  preview?: ReactNode;
};

/** Hover previews must not pop up again when focus returns to the trigger after closing. */
const PREVIEW_SUPPRESS_MS = 400;

/**
 * Source inspector: a wide sheet that puts the extracted evidence next to the original PDF page.
 * Extracted document text is untrusted data and is rendered as plain text only.
 */
export function SourceInspector({ documentId, parseResult, pageNumbers = [], sourceElementIds = [], headingPath = [], triggerLabel, triggerAriaLabel, variant = "button", invalid = false, preview }: SourceInspectorProps) {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const labels = copy.retrieval.inspector;
  const [open, setOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regionPage, setRegionPage] = useState<number | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<SourceRegion | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);
  const closedAtRef = useRef(0);
  const selectedPage = regionPage ?? pageNumbers[0] ?? parseResult?.structured.pages[0]?.pageNumber ?? null;
  const sourceFragment = selectedRegion?.pageHeight
    ? `#page=${selectedRegion.pageNumber}&view=FitR,${selectedRegion.bbox[0]},${selectedRegion.pageHeight - selectedRegion.bbox[3]},${selectedRegion.bbox[2]},${selectedRegion.pageHeight - selectedRegion.bbox[1]}`
    : selectedPage ? `#page=${selectedPage}` : "";
  const matchingElements = useMemo(() => {
    const ids = new Set(sourceElementIds);
    const all = parseResult?.structured.elements ?? [];
    if (ids.size) return all.filter((element) => ids.has(element.id));
    if (selectedPage !== null) return all.filter((element) => element.pageNumbers.includes(selectedPage));
    return [];
  }, [parseResult, selectedPage, sourceElementIds]);

  useEffect(() => () => revokeRef.current?.(), []);

  async function loadSource() {
    if (!documentId || sourceUrl || loading) return;
    setLoading(true);
    setPreviewReady(false);
    setError(null);
    try {
      const loaded = await getDocumentSourcePreviewUrl(documentId);
      revokeRef.current?.();
      revokeRef.current = loaded.revoke;
      setSourceUrl(loaded.sourceUrl);
    } catch {
      setError(labels.loadFailed);
    } finally {
      setLoading(false);
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setPreviewOpen(false);
      void loadSource();
      return;
    }
    closedAtRef.current = Date.now();
    setError(null);
    setRegionPage(null);
    setSelectedRegion(null);
  }

  function handlePreviewOpenChange(next: boolean) {
    if (next && Date.now() - closedAtRef.current < PREVIEW_SUPPRESS_MS) return;
    setPreviewOpen(next);
  }

  const trigger = variant === "chip"
    ? (
      <button
        aria-label={triggerAriaLabel}
        className={cn(
          "mx-0.5 inline-flex h-5 cursor-pointer items-center gap-0.5 rounded-md px-1.5 align-baseline text-xs font-semibold tabular-nums ring-1 ring-inset",
          "transition-[background-color,color,box-shadow] duration-150 ease-out disabled:cursor-not-allowed",
          invalid
            ? "bg-warning-primary text-warning-primary ring-utility-warning-200 hover:ring-utility-warning-300 data-[state=open]:ring-utility-warning-300"
            : "bg-tertiary text-secondary ring-secondary hover:bg-brand-primary hover:text-brand-secondary hover:ring-utility-brand-200 data-[state=open]:bg-brand-primary data-[state=open]:text-brand-secondary data-[state=open]:ring-utility-brand-200",
          "disabled:bg-secondary disabled:text-disabled disabled:ring-secondary",
        )}
        data-testid="citation-chip"
        data-valid={invalid ? "false" : "true"}
        disabled={!documentId}
        type="button"
      >
        {invalid ? <AppIcon className="size-3" name="warningTriangle" strokeWidth={2} /> : null}
        {/* The brackets keep the "[C1]" citation form in the text; the chip itself reads as a pill. */}
        <span className="sr-only">[</span>{triggerLabel}<span className="sr-only">]</span>
      </button>
    )
    : variant === "icon"
      ? <Button aria-label={triggerAriaLabel ?? triggerLabel ?? labels.open} className="-my-1" disabled={!documentId} iconLeading="fileSearch" size="icon-sm" type="button" variant="tertiary" />
      : variant === "link"
        ? <Button aria-label={triggerAriaLabel} disabled={!documentId} iconLeading="fileSearch" size="sm" type="button" variant="link-gray">{triggerLabel ?? labels.open}</Button>
        : <Button aria-label={triggerAriaLabel} disabled={!documentId} iconLeading="fileSearch" size="sm" type="button" variant="secondary">{triggerLabel ?? labels.open}</Button>;

  const dialogTrigger = <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>;

  return (
    <DialogPrimitive.Root onOpenChange={handleOpenChange} open={open}>
      {preview ? (
        <PreviewCard onOpenChange={handlePreviewOpenChange} open={previewOpen && !open}>
          <PreviewCardTrigger asChild>{dialogTrigger}</PreviewCardTrigger>
          <PreviewCardContent>{preview}</PreviewCardContent>
        </PreviewCard>
      ) : variant === "icon" ? (
        <Tooltip title={triggerLabel ?? labels.open}>{dialogTrigger}</Tooltip>
      ) : dialogTrigger}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="steplab-overlay fixed inset-0 z-50 bg-overlay/40 dark:bg-overlay/65" data-testid="source-inspector-overlay" />
        <DialogPrimitive.Content
          className={cn(
            "steplab-drawer fixed inset-0 z-50 flex flex-col overflow-hidden bg-primary shadow-2xl outline-none",
            // A floating sheet from the right on larger screens; full screen on phones.
            "sm:inset-2 sm:rounded-2xl sm:ring-1 sm:ring-secondary_alt xl:left-auto xl:w-full xl:max-w-5xl",
          )}
          data-side="right"
          data-testid="source-inspector-content"
        >
          <header className="relative flex items-center gap-3 border-b border-secondary px-5 py-3.5 pr-14">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-fg-secondary shadow-xs-skeuomorphic ring-1 ring-primary ring-inset">
              <AppIcon className="size-5" name="fileSearch" />
            </span>
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-lg font-semibold text-primary">{labels.title}</DialogPrimitive.Title>
              {/* The two panes show what the sentence says; it stays for assistive technology. */}
              <DialogPrimitive.Description className="sr-only">{labels.description}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <Button aria-label={labels.close} className="absolute top-3 right-3" size="icon-sm" type="button" variant="tertiary"><AppIcon name="close" /></Button>
            </DialogPrimitive.Close>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
            <div className="order-last flex h-[min(45dvh,420px)] min-h-64 shrink-0 flex-col bg-secondary lg:order-first lg:h-auto lg:min-h-0 lg:flex-1" data-testid="source-inspector-preview">
              {error ? (
                <div className="p-5">
                  <Notice action={<Button onClick={() => void loadSource()} size="sm" variant="secondary">{labels.retry}</Button>} tone="error">{error}</Notice>
                </div>
              ) : loading || sourceUrl ? (
                <div className={cn("t-skel h-full", previewReady && "is-revealed")}>
                  <div aria-hidden={previewReady} className="t-skel-skeleton is-pulsing steplab-source-skeleton grid place-items-center p-5" role={previewReady ? undefined : "status"}>
                    <Spinner label={labels.loading} showLabel />
                  </div>
                  {sourceUrl ? <iframe className="t-skel-content steplab-source-content h-full min-h-64 w-full bg-primary" data-ready={previewReady} onLoad={() => setPreviewReady(true)} src={`${sourceUrl}${sourceFragment}`} title={labels.title} /> : null}
                </div>
              ) : (
                <div className="grid flex-1 place-items-center p-6">
                  <p className="flex max-w-xs items-start gap-2 text-sm text-tertiary"><AppIcon className="mt-0.5 size-4 shrink-0 text-fg-quaternary" name="lock" />{labels.unavailable}</p>
                </div>
              )}
            </div>
            <TransitionPanel
              as="aside"
              className="technical-scrollbar order-first max-h-[40dvh] shrink-0 overflow-y-auto border-b border-secondary p-5 lg:order-last lg:max-h-none lg:min-h-0 lg:w-96 lg:border-b-0 lg:border-l"
              data-testid="source-inspector-evidence"
              transitionKey={selectedRegion?.pageNumber ?? selectedPage}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-primary">{labels.evidence}</h3>
                <Badge color="gray" size="md">{selectedPage ? interpolate(labels.page, { page: selectedPage }) : labels.pageLabel}</Badge>
              </div>
              {headingPath.length ? <p className="mt-1 text-sm text-tertiary">{headingPath.join(" › ")}</p> : null}
              {matchingElements.length ? (
                <>
                  <ul aria-label={labels.elements} className="mt-3 divide-y divide-secondary border-t border-secondary">
                    {matchingElements.map((element) => {
                      // The badge above names the page; an element only repeats it when it spans other pages.
                      const otherPages = !(element.pageNumbers.length === 1 && element.pageNumbers[0] === selectedPage);
                      return (
                        <li className="py-3.5" key={element.id}>
                          <div className="flex items-center justify-between gap-2 text-xs tabular-nums">
                            <span className="font-medium text-tertiary">{copy.documents.elementTypes[element.type]}</span>
                            {otherPages && element.pageNumbers.length ? <span className="text-quaternary">{element.pageNumbers.map((page) => interpolate(labels.page, { page })).join(", ")}</span> : null}
                          </div>
                          {/* Extracted document text is untrusted data: rendered as plain text only. */}
                          <p className="mt-1.5 text-sm leading-6 break-words text-secondary">{element.text}</p>
                          <OcrSourceDetails element={element} locale={preferences.locale} onInspectRegion={(region) => { setRegionPage(region.pageNumber); setSelectedRegion(region); }} />
                        </li>
                      );
                    })}
                  </ul>
                  {/* One place for the raw ids instead of a toggle per element. */}
                  <TechnicalDetails className="mt-1" title={copy.retrieval.sourceElements}>
                    <ul className="grid gap-1.5 text-xs">
                      {matchingElements.map((element) => (
                        <li className="flex min-w-0 gap-2" key={element.id}>
                          <span className="shrink-0 text-quaternary">{copy.documents.elementTypes[element.type]}</span>
                          <span className="min-w-0 font-mono break-all text-tertiary">{element.id}</span>
                        </li>
                      ))}
                    </ul>
                  </TechnicalDetails>
                </>
              ) : <p className="mt-3 text-sm text-tertiary">{labels.noElements}</p>}
              {sourceUrl ? (
                <a className={buttonStyles({ variant: "link-gray", size: "sm", className: "mt-5" })} href={`${sourceUrl}${sourceFragment}`} rel="noreferrer" target="_blank">
                  {labels.openPdf}<AppIcon className="size-4" name="externalLink" />
                </a>
              ) : null}
            </TransitionPanel>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
