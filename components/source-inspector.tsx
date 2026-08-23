"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileSearch, LoaderCircle, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { usePreferences } from "@/components/preferences-provider";
import { Button } from "@/components/ui/button";
import type { DocumentParseResponse } from "@/lib/document-parse-types";
import { getDocumentSourcePreviewUrl } from "@/lib/rag-api";

type SourceInspectorProps = {
  documentId: string | null;
  parseResult: DocumentParseResponse | null;
  pageNumbers?: number[];
  sourceElementIds?: string[];
  headingPath?: string[];
  triggerLabel?: string;
};

export function SourceInspector({ documentId, parseResult, pageNumbers = [], sourceElementIds = [], headingPath = [], triggerLabel }: SourceInspectorProps) {
  const { preferences } = usePreferences();
  const [open, setOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revokeRef = useRef<(() => void) | null>(null);
  const selectedPage = pageNumbers[0] ?? parseResult?.structured.pages[0]?.pageNumber ?? null;
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
    <DialogPrimitive.Root onOpenChange={(next) => { setOpen(next); if (next) void loadSource(); else setError(null); }} open={open}>
      <DialogPrimitive.Trigger asChild><Button className="gap-2" disabled={!documentId} size="sm" type="button" variant="outline"><FileSearch aria-hidden="true" className="size-4" />{triggerLabel ?? labels.open}</Button></DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/35" />
        <DialogPrimitive.Content className="fixed inset-x-3 bottom-3 top-3 z-50 ml-auto flex max-w-5xl flex-col overflow-hidden border bg-white shadow-2xl focus:outline-none sm:inset-x-6 sm:bottom-6 sm:top-6">
          <header className="flex items-start justify-between gap-4 border-b p-4 sm:px-6">
            <div><DialogPrimitive.Title className="text-base font-semibold">{labels.title}</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-xs text-slate-500">{labels.fallback}</DialogPrimitive.Description></div>
            <DialogPrimitive.Close asChild><Button aria-label={labels.close} size="icon-sm" type="button" variant="ghost"><X aria-hidden="true" className="size-4" /></Button></DialogPrimitive.Close>
          </header>
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-h-[45vh] bg-slate-100">
              {loading ? <div className="grid h-full place-items-center text-sm text-slate-600" role="status"><span className="flex items-center gap-2"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{labels.loading}</span></div> : error ? <p className="p-5 text-sm text-red-700" role="alert">{error}</p> : sourceUrl ? <iframe className="h-full min-h-[45vh] w-full" src={`${sourceUrl}${selectedPage ? `#page=${selectedPage}` : ""}`} title={labels.title} /> : <p className="p-5 text-sm text-slate-500">{labels.unavailable}</p>}
            </div>
            <aside className="min-h-0 overflow-y-auto border-t p-4 lg:border-l lg:border-t-0 sm:p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{labels.provenance}</h3>
              <p className="mt-2 text-sm">Document → {selectedPage ? `${labels.page} ${selectedPage}` : labels.page} → Parse element → Chunk → Retrieval/Context → Citation</p>
              {headingPath.length ? <p className="mt-3 text-xs text-slate-600">{headingPath.join(" › ")}</p> : null}
              <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">{labels.elements}</h3>
              <div className="mt-2 space-y-2">{matchingElements.length ? matchingElements.map((element) => <article className="border p-3" key={element.id}><div className="flex items-center justify-between gap-2 text-[11px] text-slate-500"><span>{element.type}</span><span>{element.pageNumbers.map((page) => `${labels.page} ${page}`).join(", ")}</span></div><p className="mt-2 text-xs leading-5">{element.text}</p>{preferences.detailLevel === "technical" ? <p className="mt-2 break-all font-mono text-[10px] text-slate-500">{element.id}</p> : null}</article>) : <p className="text-xs text-slate-500">{labels.fallback}</p>}</div>
              {sourceUrl ? <a className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-sky-700 hover:underline" href={`${sourceUrl}${selectedPage ? `#page=${selectedPage}` : ""}`} rel="noreferrer" target="_blank">{labels.open}<ExternalLink aria-hidden="true" className="size-3.5" /></a> : null}
            </aside>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
