import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OcrSourceDetails } from "@/components/ocr-source-details";
import type { ParsedElement } from "@/lib/document-parse-types";

const element: ParsedElement = { id: "e1", type: "paragraph", pageNumbers: [7], text: "B1: pirinç", level: null, table: null };

describe("OCR source diagnostics", () => {
  it("keeps old source unknown and native content quiet", () => {
    const { rerender } = render(<OcrSourceDetails element={element} locale="en" />);
    expect(screen.getByText("Text origin unknown")).toBeTruthy();
    rerender(<OcrSourceDetails element={{ ...element, sourceOrigin: "native_pdf" }} locale="en" />);
    expect(screen.queryByText(/confidence/i)).toBeNull();
  });
  it("shows mixed origin, an uncalibrated score and source inspection", () => {
    const region = { pageNumber: 7, bbox: [1, 2, 3, 4] as [number, number, number, number], coordinateOrigin: "TOPLEFT" as const, origin: "ocr" as const, confidence: .99062, text: "B1: pirinç" };
    const inspect = vi.fn();
    render(<OcrSourceDetails element={{ ...element, sourceOrigin: "mixed", sourceRegions: [region] }} locale="en" onInspectRegion={inspect} />);
    expect(screen.getByText("Native PDF + OCR text")).toBeTruthy();
    expect(screen.getByText(/0.9906/)).toBeTruthy();
    expect(screen.queryByText(/99%/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Inspect on PDF page", hidden: true }));
    expect(inspect).toHaveBeenCalledWith(region);
  });
});
