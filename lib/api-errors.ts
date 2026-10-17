import type { AppCopy } from "@/lib/copy";

/**
 * The single mapping from API error codes (backend `ApiProblem`, run errors and
 * the client's own transport codes) to localized user-facing copy. Screens show
 * `message`; the raw code and message stay under Technical details.
 */

/** Anything shaped like an API problem: `DocumentApiError`, a run's `ApiProblem`, a plain `Error`. */
export type ApiErrorLike = { code?: string | null; message?: string | null; status?: number | null };

export type DescribedApiError = {
  /** Localized sentence for the user. */
  message: string;
  /** Raw diagnostics for Technical details; null when the message already is local copy. */
  technical: { code: string; message: string | null } | null;
};

type CopyResolver = (copy: AppCopy) => string;

const api = (key: keyof AppCopy["apiErrors"]): CopyResolver => (copy) => copy.apiErrors[key];

function codes(list: string[], resolve: CopyResolver): Record<string, CopyResolver> {
  return Object.fromEntries(list.map((code) => [code, resolve]));
}

const COPY_BY_CODE: Record<string, CopyResolver> = {
  // AI model provider (Gemini). `gemini_<action>_failed` is handled as a family below.
  ...codes(["gemini_invalid_json", "gemini_invalid_rerank", "gemini_invalid_judge", "gemini_embedding_invalid", "embedding_result_invalid", "invalid_generation_metrics", "invalid_rerank", "citation_invalid"], api("providerInvalidOutput")),
  gemini_output_truncated: api("providerOutputTruncated"),
  // A quota that renews later than a minute: not "busy", so it must win over the `gemini_*` families.
  gemini_quota_exhausted: api("providerQuotaExhausted"),
  ...codes(["gemini_not_configured", "gemini_dependency_missing", "gemini_unavailable"], api("providerUnavailable")),
  provider_error: api("providerBusy"),
  // Per-user admission: one expensive run at a time.
  ...codes(["user_run_limit_reached", "pipeline_busy", "parse_already_in_progress", "experiment_in_progress", "evaluation_in_progress", "artifact_in_progress"], api("runInProgress")),
  // Upload, quotas and the write switch.
  invalid_file_type: (copy) => copy.errors.invalidPdf,
  ...codes(["file_too_large", "request_too_large"], (copy) => copy.errors.fileTooLarge),
  empty_file: api("emptyFile"),
  file_name_too_long: api("fileNameTooLong"),
  duplicate_document: (copy) => copy.documents.notice.reused,
  document_quota_exceeded: api("documentQuota"),
  storage_quota_exceeded: api("storageQuota"),
  writes_disabled: api("writesDisabled"),
  // Parse and worker lifecycle.
  page_limit_exceeded: api("pageLimit"),
  ...codes(["docling_error", "docling_content_missing"], api("unreadablePdf")),
  ...codes(["docling_timeout", "parse_timeout", "document_timeout"], api("parseTimeout")),
  parse_interrupted: api("parseInterrupted"),
  ...codes(["parse_failed", "parse_worker_error"], (copy) => copy.errors.parseFailed),
  ...codes(["worker_interrupted", "worker_lease_expired", "worker_lease_lost", "worker_lease_missing", "worker_terminated"], api("runInterrupted")),
  ...codes(["modal_dispatch_failed", "pipeline_dispatch_failed", "pipeline_dispatch_lost", "worker_queue_timeout"], api("workerStartFailed")),
  ...codes(["docling_unavailable", "ocr_configuration_unavailable", "ocr_runtime_incompatible", "ocr_assets_unavailable"], api("parserUnavailable")),
  parse_poll_timeout: (copy) => copy.parse.pollTimeout,
  run_poll_timeout: api("trackingPaused"),
  // Run outcomes without a more specific cause.
  chunk_run_failed: (copy) => copy.errors.chunkingFailed,
  embedding_run_failed: (copy) => copy.errors.embeddingFailed,
  experiment_failed: (copy) => copy.errors.experimentFailed,
  evaluation_failed: (copy) => copy.errors.evaluationFailed,
  evaluation_cases_failed: api("allCasesFailed"),
  ...codes(["parse_run_incomplete", "chunk_run_incomplete", "embedding_run_incomplete", "artifact_incomplete"], api("artifactIncomplete")),
  // Service, transport and configuration.
  ...codes(["backend_unavailable", "database_unavailable", "database_not_configured", "storage_not_configured", "internal_error", "persistence_failed", "storage_upload_failed", "storage_delete_failed"], api("serviceUnavailable")),
  request_timeout: api("requestTimeout"),
  invalid_response: api("invalidResponse"),
  ...codes(["configuration_error", "runtime_config_incomplete", "tokenizer_not_configured"], api("configuration")),
  // Session.
  ...codes(["auth_required", "authentication_required"], api("signIn")),
  auth_unavailable: (copy) => copy.errors.authUnavailable,
  // Lineage and request validation.
  ...codes(["lineage_incompatible", "chunk_lineage_missing"], (copy) => copy.runs.incompatibleLineage),
  ...codes(["parse_required", "chunks_required", "embedding_required", "context_required", "default_pipeline_required"], api("missingUpstream")),
  ...codes(["request_invalid", "invalid_config", "chunk_config_invalid", "retrieval_config_invalid", "rerank_config_invalid", "pipeline_kind_invalid", "fingerprint_invalid", "evaluation_dataset_invalid", "evaluation_elements_unknown", "invalid_pipeline_name"], api("invalidSettings")),
  evaluation_dataset_too_large: api("datasetTooLarge"),
  pipeline_name_conflict: api("pipelineNameTaken"),
  pipeline_conflict: (copy) => copy.errors.pipelineConflict,
};

/** Browser tracking stopped after its deadline; the run itself may still be working. */
const TRACKING_PAUSED_CODES = new Set(["parse_poll_timeout", "run_poll_timeout"]);

/** Codes created in the browser whose message is already localized copy (lineage guards). */
const LOCALIZED_CLIENT_CODES = new Set(["incompatible_lineage"]);

function copyForCode(code: string): CopyResolver | null {
  if (Object.hasOwn(COPY_BY_CODE, code)) return COPY_BY_CODE[code];
  // Provider calls fail as `gemini_<action>_failed` after retries: busy, rate-limited or briefly down.
  if (/^gemini_[a-z_]+_failed$/.test(code)) return api("providerBusy");
  if (code.startsWith("gemini_")) return api("providerUnavailable");
  if (code === "not_found" || code.endsWith("_not_found")) return api("notFound");
  return null;
}

function toApiErrorLike(error: unknown): ApiErrorLike | null {
  if (!error || typeof error !== "object") return null;
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === "string" && value.code ? value.code : null,
    message: typeof value.message === "string" && value.message ? value.message : null,
    status: typeof value.status === "number" ? value.status : null,
  };
}

/**
 * Localized copy for a failed request. Known codes get their own sentence;
 * anything else falls back to the caller's context copy (or a generic one).
 * Accepts any caught value; non-objects yield `null`.
 */
export function describeApiError(copy: AppCopy, error: unknown, fallback?: string | null): DescribedApiError | null {
  const problem = toApiErrorLike(error);
  if (!problem || (!problem.code && !problem.message)) return null;
  const code = problem.code;
  // `unknown` without an HTTP status is the provider's own localized fallback (`asApiError`);
  // with a status it is a backend response that carried no structured problem.
  if (code && problem.message && (LOCALIZED_CLIENT_CODES.has(code) || (code === "unknown" && problem.status == null))) {
    return { message: problem.message, technical: null };
  }
  const resolve = code ? copyForCode(code) : null;
  const unstructuredServerError = (!code || code === "unknown" || code === "http_error") && problem.status != null && (problem.status >= 500 || problem.status === 429);
  const message = resolve
    ? resolve(copy)
    : unstructuredServerError ? copy.apiErrors.serviceUnavailable : fallback || copy.apiErrors.generic;
  const rawMessage = problem.message && problem.message !== message ? problem.message : null;
  return { message, technical: code || rawMessage ? { code: code ?? "—", message: rawMessage } : null };
}

/** The API error code of any caught value, or `null`. */
export function apiErrorCode(error: unknown): string | null {
  return toApiErrorLike(error)?.code ?? null;
}

/** True when browser tracking paused, not the run: show a resume action, never a failure. */
export function isTrackingPaused(error: unknown): boolean {
  const code = apiErrorCode(error);
  return code !== null && TRACKING_PAUSED_CODES.has(code);
}
