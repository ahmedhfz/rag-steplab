"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileSearch, LoaderCircle, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { usePreferences } from "@/components/preferences-provider";
import { OcrSourceDetails } from "@/components/ocr-source-details";
import { Button } from "@/components/ui/button";
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
};

export function SourceInspector({ documentId, parseResult, pageNumbers = [], sourceElementIds = [], headingPath = [], triggerLabel, triggerAriaLabel }: SourceInspectorProps) {
  const { preferences } = usePreferences();
  const [open, setOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
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
  const labels = preferences.locale === "tr"
    ? { title: "Kaynak denetleyicisi", open: "Kaynağı incele", close: "Kapat", loading: "Özel PDF yükleniyor…", provenance: "Kaynak zinciri", page: "Sayfa", elements: "Parse elementleri", fallback: "Koordinat verisi yok; doğrulanmış sayfa ve kaynak elementleri gösteriliyor.", unavailable: "Kaynak PDF yalnız doküman sahibi tarafından açılabilir." }
    : { title: "Source inspector", open: "Inspect source", close: "Close", loading: "Loading private PDF…", provenance: "Source chain", page: "Page", elements: "Parse elements", fallback: "No coordinates are available; verified page and source elements are shown instead.", unavailable: "The source PDF can only be opened by the document owner." };

  useEffect(() => () => revokeRef.current?.(), []);

  async function loadSource() {
    if (!documentId || sourceUrl || loading) return;
    setLoading(true);
    setError(null);
    try {
      const loaded = await getDocumentSourcePreviewUrl(documentId);
      revokeRef.current?.();
      revokeRef.current = loaded.revoke;
      setSourceUrl(loaded.sourceUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.unavailable);
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogPrimitive.Root onOpenChange={(next) => { setOpen(next); if (next) void loadSource(); else { setError(null); setRegionPage(null); setSelectedRegion(null); } }} open={open}>
      <DialogPrimitive.Trigger asChild><Button aria-label={triggerAriaLabel} className="gap-2" disabled={!documentId} size="sm" type="button" variant="outline"><FileSearch aria-hidden="true" className="size-4" />{triggerLabel ?? labels.open}</Button></DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay/35 dark:bg-overlay/65" data-testid="source-inspector-overlay" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 ml-0 flex max-w-none flex-col overflow-hidden border-0 bg-card shadow-2xl focus:outline-none sm:inset-x-6 sm:bottom-6 sm:top-6 sm:ml-auto sm:max-w-5xl sm:border sm:border-border" data-testid="source-inspector-content">
          <header className="flex items-start justify-between gap-4 border-b border-border p-4 sm:px-6">
            <div><DialogPrimitive.Title className="text-base font-semibold text-foreground">{labels.title}</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-xs text-muted-foreground">{matchingElements.some((element) => element.sourceRegions?.length) ? (preferences.locale === "tr" ? "Kaynak bölgeleri TOPLEFT PDF koordinatlarıyla gösterilir; ilgili PDF sayfasını açarak görüntüyü inceleyin." : "Source regions use TOPLEFT PDF coordinates; open the corresponding PDF page to inspect the image.") : labels.fallback}</DialogPrimitive.Description></div>
            <DialogPrimitive.Close asChild><Button aria-label={labels.close} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" className="size-4" /></Button></DialogPrimitive.Close>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:overflow-hidden lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="h-[min(45vh,420px)] min-h-[260px] shrink-0 bg-technical lg:h-auto lg:min-h-[45vh]">
              {loading ? <div className="grid h-full place-items-center text-sm text-muted-foreground" role="status"><span className="flex items-center gap-2"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{labels.loading}</span></div> : error ? <p className="p-5 text-sm text-destructive" role="alert">{error}</p> : sourceUrl ? <iframe className="h-full min-h-[45vh] w-full" src={`${sourceUrl}${sourceFragment}`} title={labels.title} /> : <p className="p-5 text-sm text-muted-foreground">{labels.unavailable}</p>}
            </div>
            <aside className="border-t border-border p-4 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0 sm:p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle-foreground">{labels.provenance}</h3>
              <p className="mt-2 text-sm text-foreground">Document → {selectedPage ? `${labels.page} ${selectedPage}` : labels.page} → Parse element → Chunk → Retrieval/Context → Citation</p>
              {headingPath.length ? <p className="mt-3 text-xs text-muted-foreground">{headingPath.join(" › ")}</p> : null}
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground">{labels.elements}</h3>
              <div className="mt-2 space-y-2">{matchingElements.length ? matchingElements.map((element) => <article className="border border-border bg-card p-3" key={element.id}><div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground"><span>{element.type}</span><span>{element.pageNumbers.map((page) => `${labels.page} ${page}`).join(", ")}</span></div><p className="mt-2 break-words text-xs leading-5 text-foreground">{element.text}</p><OcrSourceDetails element={element} locale={preferences.locale} onInspectRegion={(region) => { setRegionPage(region.pageNumber); setSelectedRegion(region); }} /><details className="mt-2"><summary className="cursor-pointer text-[10px] text-muted-foreground">{preferences.locale === "tr" ? "Teknik kaynak kimliği" : "Technical source ID"}</summary><p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{element.id}</p></details></article>) : <p className="text-xs text-muted-foreground">{labels.fallback}</p>}</div>
              {sourceUrl ? <a className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-brand hover:underline" href={`${sourceUrl}${sourceFragment}`} rel="noreferrer" target="_blank">{labels.open}<ExternalLink aria-hidden="true" className="size-3.5" /></a> : null}
            </aside>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
