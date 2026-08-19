import { describe, expect, it } from "vitest";

import {
  formatDocumentFileSize,
  MAX_DOCUMENT_FILE_SIZE_BYTES,
  validatePdfFile,
} from "@/lib/document-file";

function makeFile(name: string, type: string, size = 128) {
  return { name, type, size };
}

describe("document file validation", () => {
  it("accepts a PDF MIME type and an extension-only PDF selection", () => {
    expect(validatePdfFile(makeFile("guide.pdf", "application/pdf"))).toBeNull();
    expect(validatePdfFile(makeFile("guide.pdf", ""))).toBeNull();
  });

  it("rejects non-PDF MIME types even when the filename has a PDF extension", () => {
    expect(validatePdfFile(makeFile("guide.pdf", "text/plain"))).toBe("invalidPdf");
    expect(validatePdfFile(makeFile("guide.txt", ""))).toBe("invalidPdf");
  });

  it("accepts exactly 50 MB and rejects larger files", () => {
    expect(validatePdfFile(makeFile("guide.pdf", "application/pdf", MAX_DOCUMENT_FILE_SIZE_BYTES))).toBeNull();
    expect(validatePdfFile(makeFile("guide.pdf", "application/pdf", MAX_DOCUMENT_FILE_SIZE_BYTES + 1))).toBe("fileTooLarge");
  });

  it("formats file sizes with the selected locale", () => {
    expect(formatDocumentFileSize(1024 * 1024, "en")).toBe("1 MB");
    expect(formatDocumentFileSize(1024 * 1024, "tr")).toBe("1 MB");
    expect(formatDocumentFileSize(1024 * 1024 + 512 * 1024, "en")).toBe("1.5 MB");
    expect(formatDocumentFileSize(1024 * 1024 + 512 * 1024, "tr")).toBe("1,5 MB");
  });
});
