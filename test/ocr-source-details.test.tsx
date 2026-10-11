import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OcrSourceDetails } from "@/components/ocr-source-details";
import type { ParsedElement } from "@/lib/document-parse-types";

const element: ParsedElement = { id: "e1", type: "paragraph", pageNumbers: [7], text: "B1: pirinç", level: null, table: null };

describe("OCR source diagnostics", () => {
  it("keeps native content and an unknown origin without regions quiet", () => {
    const { container, rerender } = render(<OcrSourceDetails element={element} locale="en" />);
    // "Text origin unknown" with nothing inside is not information (L8).
    expect(container).toBeEmptyDOMElement();
    rerender(<OcrSourceDetails element={{ ...element, sourceOrigin: "native_pdf" }} locale="en" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("still discloses an unknown origin when source regions exist", () => {
    const region = { pageNumber: 7, bbox: [1, 2, 3, 4] as [number, number, number, number], coordinateOrigin: "TOPLEFT" as const, origin: "native_pdf" as const, confidence: null, text: "B1" };
    render(<OcrSourceDetails element={{ ...element, sourceRegions: [region] }} locale="tr" />);
    expect(screen.getByText("Metin kaynağı bilinmiyor")).toBeTruthy();
  });

  it("shows mixed origin, an uncalibrated score and source inspection", () => {
    const region = { pageNumber: 7, bbox: [1, 2, 3, 4] as [number, number, number, number], coordinateOrigin: "TOPLEFT" as const, origin: "ocr" as const, confidence: .99062, text: "B1: pirinç" };
    const inspect = vi.fn();
    render(<OcrSourceDetails element={{ ...element, sourceOrigin: "mixed", sourceRegions: [region] }} locale="en" onInspectRegion={inspect} />);
    expect(screen.getByText("Native PDF + OCR text")).toBeTruthy();
    expect(screen.getByText(/0.9906/)).toBeTruthy();
    expect(screen.queryByText(/99%/)).toBeNull();
    expect(screen.getByText("Confidence is not a probability of correctness; inspect the source image.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Inspect on PDF page", hidden: true }));
    expect(inspect).toHaveBeenCalledWith(region);
  });
});
