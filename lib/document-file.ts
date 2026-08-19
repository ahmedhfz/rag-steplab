export const MAX_DOCUMENT_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export type DocumentFileValidationError = "invalidPdf" | "fileTooLarge";

type DocumentFileLike = Pick<File, "name" | "size" | "type">;

/**
 * Yalnızca tarayıcıdaki dosya seçim sözleşmesini doğrular; PDF baytlarını
 * incelemez ve veri alma ya da güvenlik sınırı olarak kullanılmamalıdır.
 */
export function validatePdfFile(file: DocumentFileLike): DocumentFileValidationError | null {
  const hasPdfType = file.type === "application/pdf";
  const hasPdfExtension = file.name.toLowerCase().endsWith(".pdf");

  if ((file.type && !hasPdfType) || (!file.type && !hasPdfExtension)) {
    return "invalidPdf";
  }

  if (file.size > MAX_DOCUMENT_FILE_SIZE_BYTES) {
    return "fileTooLarge";
  }

  return null;
}

export function formatDocumentFileSize(bytes: number, locale: "en" | "tr"): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat(locale === "tr" ? "tr-TR" : "en-US", { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}
