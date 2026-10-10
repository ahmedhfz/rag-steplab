"use client";

import { TransitionPanel } from "@/components/ui/transitions";
import { TransitionDialogContent } from "@/components/ui/transition-surface";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { usePreferences } from "@/components/preferences-provider";
import { OcrSourceDetails } from "@/components/ocr-source-details";
import { AppIcon } from "@/components/ui/app-icon";
import { Button } from "@/components/ui/button";
import { TechnicalDetails } from "@/components/ui/disclosure";
import { UI_COPY } from "@/lib/copy";
import type { DocumentParseResponse, SourceRegion } from "@/lib/document-parse-types";
import { getDocumentSourcePreviewUrl } from "@/lib/rag-api";

type SourceInspectorProps = {
  documentId: string | null;
  parseResult: DocumentParseResponse | null;
  pageNumbers?: number[];
  sourceElementIds?: string[];
  headingPath?: string[];
  triggerLabel?: string;
  triggerAriaLabel?: string;
  /** `chip`: a compact inline `[C1]` marker for citations inside answer text. */
  variant?: "button" | "chip";
};

function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ""));
}

export function SourceInspector({ documentId, parseResult, pageNumbers = [], sourceElementIds = [], headingPath = [], triggerLabel, triggerAriaLabel, variant = "button" }: SourceInspectorProps) {
  const { preferences } = usePreferences();
  const copy = UI_COPY[preferences.locale];
  const labels = copy.retrieval.inspector;
  const [open, setOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regionPage, setRegionPage] = useState<number | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<SourceRegion | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);
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

  const trigger = variant === "chip"
    ? (
      <button
        aria-label={triggerAriaLabel}
        className="mx-0.5 inline-flex h-5 items-center rounded-sm bg-secondary px-1 align-baseline font-mono text-xs font-medium text-foreground transition-colors hover:bg-surface-subtle hover:text-foreground disabled:cursor-not-allowed disabled:text-subtle-foreground"
        data-testid="citation-chip"
        disabled={!documentId}
        type="button"
      >
        [{triggerLabel}]
      </button>
    )
    : <Button aria-label={triggerAriaLabel} disabled={!documentId} size="sm" type="button" variant="outline"><AppIcon name="fileSearch" className="size-4" />{triggerLabel ?? labels.open}</Button>;

  return (
    <DialogPrimitive.Root onOpenChange={(next) => { setOpen(next); if (next) void loadSource(); else { setError(null); setRegionPage(null); setSelectedRegion(null); } }} open={open}>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="steplab-overlay fixed inset-0 z-50 bg-overlay/35 dark:bg-overlay/65" data-testid="source-inspector-overlay" />
        <TransitionDialogContent className="fixed inset-0 z-50 ml-0 flex max-w-none flex-col overflow-hidden border-0 bg-card shadow-2xl focus:outline-none sm:inset-x-6 sm:bottom-6 sm:top-6 sm:ml-auto sm:max-w-5xl sm:rounded-xl sm:border sm:border-border" data-testid="source-inspector-content">
          <header className="flex items-start justify-between gap-4 border-b border-border p-4 sm:px-6">
            <div><DialogPrimitive.Title className="text-base font-semibold text-foreground">{labels.title}</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">{labels.description}</DialogPrimitive.Description></div>
            <DialogPrimitive.Close asChild><Button aria-label={labels.close} size="icon-sm" type="button" variant="ghost"><AppIcon name="close" className="size-4" /></Button></DialogPrimitive.Close>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:overflow-hidden lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="order-last h-[min(45vh,420px)] min-h-[260px] shrink-0 bg-technical lg:order-first lg:h-auto lg:min-h-[45vh]" data-testid="source-inspector-preview">
              {error ? <div className="p-5"><p className="text-sm text-destructive" role="alert">{error}</p><Button className="mt-3" onClick={() => void loadSource()} size="sm" variant="outline">{labels.retry}</Button></div> : loading || sourceUrl ? <div className={`t-skel h-full ${previewReady ? "is-revealed" : ""}`}>
                <div aria-hidden={previewReady} className="t-skel-skeleton is-pulsing steplab-source-skeleton grid place-items-center p-5" role={previewReady ? undefined : "status"}><span className="flex items-center gap-2 text-sm text-muted-foreground"><AppIcon name="loading" className="size-4 animate-spin" />{labels.loading}</span></div>
                {sourceUrl ? <iframe className="t-skel-content steplab-source-content h-full min-h-[45vh] w-full" data-ready={previewReady} onLoad={() => setPreviewReady(true)} src={`${sourceUrl}${sourceFragment}`} title={labels.title} /> : null}
              </div> : <p className="p-5 text-sm text-muted-foreground">{labels.unavailable}</p>}
            </div>
            <TransitionPanel as="aside" transitionKey={selectedRegion?.pageNumber ?? selectedPage} className="order-first max-h-[40vh] overflow-y-auto border-b border-border p-4 lg:order-last lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-l sm:p-5" data-testid="source-inspector-evidence">
              <h3 className="text-xs font-semibold text-muted-foreground">{labels.evidence}</h3>
              <p className="mt-2 inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-foreground tabular-nums">{selectedPage ? fill(labels.page, { page: selectedPage }) : labels.pageLabel}</p>
              {headingPath.length ? <p className="mt-3 text-xs text-muted-foreground">{headingPath.join(" › ")}</p> : null}
              <h3 className="mt-5 text-xs font-semibold text-muted-foreground">{labels.elements}</h3>
              {/* Extracted document text is untrusted data: rendered as plain text only. */}
              <div className="mt-2 space-y-2">{matchingElements.length ? matchingElements.map((element) => <article className="rounded-md border border-border bg-card p-3" key={element.id}><div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums"><span>{copy.documents.elementTypes[element.type]}</span><span>{element.pageNumbers.map((page) => fill(labels.page, { page })).join(", ")}</span></div><p className="mt-2 break-words text-xs leading-5 text-foreground">{element.text}</p><OcrSourceDetails element={element} locale={preferences.locale} onInspectRegion={(region) => { setRegionPage(region.pageNumber); setSelectedRegion(region); }} /><TechnicalDetails className="mt-2" title={labels.technicalId}><p className="break-all font-mono text-xs text-muted-foreground">{element.id}</p></TechnicalDetails></article>) : <p className="text-xs text-muted-foreground">{labels.noElements}</p>}</div>
              {sourceUrl ? <a className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-foreground underline-offset-4 hover:underline" href={`${sourceUrl}${sourceFragment}`} rel="noreferrer" target="_blank">{labels.openPdf}<AppIcon name="externalLink" className="size-3.5" /></a> : null}
            </TransitionPanel>
          </div>
        </TransitionDialogContent>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
