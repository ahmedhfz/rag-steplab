import type {
  DocumentParseResponse,
  ParseJobAcceptedResponse,
  ParsedElementType,
} from "@/lib/document-parse-types";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

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

type ApiErrorPayload = { error?: { code?: unknown; message?: unknown } };

export type ParseDocumentResponse = DocumentParseResponse | ParseJobAcceptedResponse;

function getApiBaseUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  if (process.env.NODE_ENV !== "production") return DEFAULT_API_BASE_URL;
  throw new DocumentApiError("configuration_error", "NEXT_PUBLIC_API_BASE_URL is required in production.");
}

function isParsedElementType(value: unknown): value is ParsedElementType {
  return value === "heading" || value === "paragraph" || value === "list" || value === "table" || value === "other";
}

export function isParseJobAcceptedResponse(value: unknown): value is ParseJobAcceptedResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<ParseJobAcceptedResponse> & { document_id?: unknown; parse_run_id?: unknown };
  const documentId = response.documentId ?? response.document_id;
  const parseRunId = response.parseRunId ?? response.parse_run_id;
  return typeof documentId === "string"
    && typeof parseRunId === "string"
    && (response.status === "queued" || response.status === "running");
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

async function readErrorPayload(response: Response): Promise<{ code: DocumentApiErrorCode; message: string }> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    const code = payload.error?.code;
    const message = payload.error?.message;
    return {
      code: typeof code === "string" && code ? code : "unknown",
      message: typeof message === "string" ? message : "The parsing backend returned an error.",
    };
  } catch {
    return { code: "unknown", message: "The parsing backend returned an unreadable error." };
  }
}

export async function parseDocument(file: File, signal?: AbortSignal): Promise<ParseDocumentResponse> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/documents/parse`, {
      method: "POST",
      body: formData,
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    if (error instanceof DocumentApiError) throw error;
    throw new DocumentApiError("backend_unavailable", "The parsing backend could not be reached.");
  }

  if (!response.ok) {
    const payload = await readErrorPayload(response);
    throw new DocumentApiError(payload.code, payload.message, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DocumentApiError("invalid_response", "The parsing backend returned invalid JSON.", response.status);
  }

  if (!isDocumentParseResponse(payload) && !isParseJobAcceptedResponse(payload)) {
    throw new DocumentApiError("invalid_response", "The parsing backend returned an invalid parse contract.", response.status);
  }

  return payload;
}
