"use client";

import type { ParsedElement, SourceRegion } from "@/lib/document-parse-types";

export function OcrSourceDetails({ element, locale, onInspectRegion }: {
  element: ParsedElement;
  locale: string;
  onInspectRegion?: (region: SourceRegion) => void;
}) {
  const tr = locale === "tr";
  const origin = element.sourceOrigin ?? "unknown";
  if (origin === "native_pdf") return null;
  return <details className="mt-2 text-xs text-muted-foreground">
    <summary className="cursor-pointer">{origin === "ocr" ? (tr ? "OCR kaynaklı metin" : "OCR-derived text") : origin === "mixed" ? (tr ? "Native PDF + OCR metni" : "Native PDF + OCR text") : (tr ? "Metin kaynağı bilinmiyor" : "Text origin unknown")}</summary>
    {(element.sourceRegions ?? []).map((region, index) => <div className="mt-2" key={index}>
      <p>{tr ? "Kaynak bölgesi" : "Source region"}: {region.pageNumber} · {region.bbox.map((value) => value.toFixed(1)).join(", ")} ({region.coordinateOrigin}) · {region.origin}</p>
      {region.origin === "ocr" && region.confidence != null ? <p>{tr ? "OCR confidence (tanısal skor)" : "OCR confidence (diagnostic score)"}: {region.confidence.toFixed(4)}</p> : null}
      {onInspectRegion ? <button className="mt-1 text-brand underline" onClick={() => onInspectRegion(region)} type="button">{tr ? "PDF sayfasında incele" : "Inspect on PDF page"}</button> : null}
    </div>)}
    {origin === "ocr" || origin === "mixed" ? <p className="mt-2">{tr ? "Confidence, doğruluk olasılığı değildir; kaynak görüntüyü kontrol edin." : "Confidence is not a probability of correctness; inspect the source image."}</p> : null}
  </details>;
}
