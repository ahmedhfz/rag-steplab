export type ParsedElementType = "heading" | "paragraph" | "list" | "table" | "other";

export type ParsedTable = {
  rows: string[][];
  markdown: string;
};

export type ParsedElement = {
  id: string;
  type: ParsedElementType;
  pageNumbers: number[];
  text: string;
  level: number | null;
  table: ParsedTable | null;
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
};

/**
 * Public parse lifecycle. Database-only states (for example `interrupted`)
 * are intentionally not part of the browser contract.
 */
export type ParseRunStatus = "queued" | "running" | "completed" | "failed";

export type ParseJobAcceptedResponse = {
  documentId: string;
  parseRunId: string;
  status: Exclude<ParseRunStatus, "completed" | "failed">;
  progress?: number;
  runMetadata?: Record<string, unknown> | null;
};

export type ParseJobFailedResponse = {
  documentId: string;
  parseRunId: string;
  status: "failed";
  progress?: number;
  error: { code: string; message: string };
  runMetadata?: Record<string, unknown> | null;
};
