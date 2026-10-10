import type { DocumentParseResponse, ParsedElementType } from "@/lib/document-parse-types";

/**
 * Error contract and parse-payload guard shared by the RAG API client
 * (`lib/rag-api.ts`), which is the only module that performs requests.
 */

export type DocumentApiErrorCode =
  | "backend_unavailable"
  | "invalid_file_type"
  | "empty_file"
  | "file_too_large"
  | "docling_error"
  | "invalid_response"
  | "configuration_error"
  | "revision_conflict"
  | "invalid_config"
  | "provider_error"
  | "parse_interrupted"
  | "parse_poll_timeout"
  | "run_poll_timeout"
  | "request_timeout"
  | "auth_required"
  | "auth_unavailable"
  | "not_found"
  | "unknown"
  | (string & {});

export class DocumentApiError extends Error {
  readonly code: DocumentApiErrorCode;
  readonly status: number | null;

  constructor(code: DocumentApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "DocumentApiError";
    this.code = code;
    this.status = status;
  }
}

function isParsedElementType(value: unknown): value is ParsedElementType {
  return value === "heading" || value === "paragraph" || value === "list" || value === "table" || value === "other";
}

export function isDocumentParseResponse(value: unknown): value is DocumentParseResponse {
  if (!value || typeof value !== "object") return false;

  const response = value as Partial<DocumentParseResponse>;
  const document = response.document;
  const structured = response.structured;
  const summary = response.summary;

  if (
    !document || typeof document !== "object" ||
    typeof document.fileName !== "string" ||
    typeof document.mediaType !== "string" ||
    typeof document.sizeBytes !== "number" ||
    typeof document.pageCount !== "number" ||
    typeof response.markdown !== "string" ||
    !structured || typeof structured !== "object" ||
    !Array.isArray(structured.pages) || !Array.isArray(structured.elements) ||
    !summary || typeof summary !== "object"
  ) {
    return false;
  }

  const summaryKeys: Array<keyof typeof summary> = ["pageCount", "headingCount", "paragraphCount", "listCount", "tableCount"];
  if (summaryKeys.some((key) => typeof summary[key] !== "number")) return false;

  return structured.elements.every((element) => {
    if (!element || typeof element !== "object") return false;
    return typeof element.id === "string" && isParsedElementType(element.type) && typeof element.text === "string" && Array.isArray(element.pageNumbers);
  });
}
