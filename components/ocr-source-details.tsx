"use client";

import { Disclosure } from "@/components/ui/disclosure";

import { UI_COPY } from "@/lib/copy";
import type { ParsedElement, SourceRegion } from "@/lib/document-parse-types";

export function OcrSourceDetails({ element, locale, onInspectRegion }: {
  element: ParsedElement;
  locale: string;
  onInspectRegion?: (region: SourceRegion) => void;
}) {
  const labels = UI_COPY[locale === "tr" ? "tr" : "en"].parse.ocr;
  const origin = element.sourceOrigin ?? "unknown";
  const regions = element.sourceRegions ?? [];
  // Native text needs no diagnostics, and an unknown origin without regions has nothing to disclose (L8).
  if (origin === "native_pdf" || (origin === "unknown" && regions.length === 0)) return null;
  const title = origin === "ocr" ? labels.ocrText : origin === "mixed" ? labels.mixedText : labels.unknownOrigin;
  return <Disclosure className="mt-2" contentClassName="text-xs text-muted-foreground" title={title} variant="inline">
    {regions.map((region, index) => <div className="mt-1 tabular-nums" key={index}>
      <p>{labels.sourceRegion}: {region.pageNumber} · {region.bbox.map((value) => value.toFixed(1)).join(", ")} ({region.coordinateOrigin}) · {region.origin}</p>
      {region.origin === "ocr" && region.confidence != null ? <p>{labels.confidence}: {region.confidence.toFixed(4)}</p> : null}
      {onInspectRegion ? <button className="mt-1 font-medium text-foreground underline underline-offset-4" onClick={() => onInspectRegion(region)} type="button">{labels.inspectOnPage}</button> : null}
    </div>)}
    {origin === "ocr" || origin === "mixed" ? <p className="mt-2">{labels.confidenceCaveat}</p> : null}
  </Disclosure>;
}
