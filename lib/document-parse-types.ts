export type ParsedElementType = "heading" | "paragraph" | "list" | "table" | "other";

export type ParsedTable = {
  rows: string[][];
  markdown: string;
};

export type SourceRegion = {
  pageNumber: number;
  bbox: [number, number, number, number];
  coordinateOrigin: "TOPLEFT";
  pageHeight?: number | null;
  origin: "native_pdf" | "ocr" | "unknown";
  confidence: number | null;
  text: string;
};

export type ParsedElement = {
  id: string;
  type: ParsedElementType;
  pageNumbers: number[];
  text: string;
  level: number | null;
  table: ParsedTable | null;
  sourceOrigin?: "native_pdf" | "ocr" | "mixed" | "unknown";
  sourceRegions?: SourceRegion[];
};

export type ParsedPage = {
  pageNumber: number;
  elements: ParsedElement[];
};

export type StructuredContent = {
  pages: ParsedPage[];
  elements: ParsedElement[];
};

export type ParseSummary = {
  pageCount: number;
  headingCount: number;
  paragraphCount: number;
  listCount: number;
  tableCount: number;
};

export type DocumentMetadata = {
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  pageCount: number;
};

export type DocumentParseResponse = {
  document: DocumentMetadata;
  structured: StructuredContent;
  markdown: string;
  summary: ParseSummary;
  progress?: number;
  /** True when the upload reused an existing persisted document identity. */
  reusedDocument?: boolean;
};

/**
 * Public parse lifecycle. Database-only states (for example `interrupted`)
 * are intentionally not part of the browser contract.
 */
export type ParseRunStatus = "queued" | "running" | "completed" | "failed";
