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
};
