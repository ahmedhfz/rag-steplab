import { describe, expect, it } from "vitest";

import { describeApiError } from "@/lib/api-errors";
import { UI_COPY } from "@/lib/copy";
import { DocumentApiError } from "@/lib/document-api";

const en = UI_COPY.en;
const tr = UI_COPY.tr;

describe("describeApiError", () => {
  it("explains a busy model provider as temporary and keeps the raw problem for Technical details", () => {
    const error = new DocumentApiError("gemini_generation_failed", "Gemini generation failed.", 503);
    expect(describeApiError(en, error)).toEqual({
      message: en.apiErrors.providerBusy,
      technical: { code: "gemini_generation_failed", message: "Gemini generation failed." },
    });
    expect(en.apiErrors.providerBusy).toMatch(/temporary/);
    expect(describeApiError(tr, error)?.message).toBe(tr.apiErrors.providerBusy);
    expect(tr.apiErrors.providerBusy).toMatch(/geçici/);
    // Every provider action that fails after retries is the same family, including new ones.
    for (const code of ["gemini_embedding_failed", "gemini_rerank_failed", "gemini_judge_failed", "gemini_token_count_failed"]) {
      expect(describeApiError(en, { code, message: "x" })?.message).toBe(en.apiErrors.providerBusy);
    }
    expect(describeApiError(en, { code: "gemini_new_problem", message: "x" })?.message).toBe(en.apiErrors.providerUnavailable);
  });

  it.each([
    ["gemini_invalid_json", "providerInvalidOutput"],
    ["gemini_output_truncated", "providerOutputTruncated"],
    ["gemini_not_configured", "providerUnavailable"],
    ["user_run_limit_reached", "runInProgress"],
    ["pipeline_busy", "runInProgress"],
    ["parse_already_in_progress", "runInProgress"],
    ["page_limit_exceeded", "pageLimit"],
    ["document_quota_exceeded", "documentQuota"],
    ["storage_quota_exceeded", "storageQuota"],
    ["writes_disabled", "writesDisabled"],
    ["empty_file", "emptyFile"],
    ["file_name_too_long", "fileNameTooLong"],
    ["docling_error", "unreadablePdf"],
    ["docling_timeout", "parseTimeout"],
    ["parse_timeout", "parseTimeout"],
    ["parse_interrupted", "parseInterrupted"],
    ["worker_lease_expired", "runInterrupted"],
    ["modal_dispatch_failed", "workerStartFailed"],
    ["worker_queue_timeout", "workerStartFailed"],
    ["ocr_assets_unavailable", "parserUnavailable"],
    ["backend_unavailable", "serviceUnavailable"],
    ["internal_error", "serviceUnavailable"],
    ["request_timeout", "requestTimeout"],
    ["authentication_required", "signIn"],
    ["auth_required", "signIn"],
    ["document_not_found", "notFound"],
    ["experiment_not_found", "notFound"],
    ["chunks_required", "missingUpstream"],
    ["evaluation_cases_failed", "allCasesFailed"],
  ] as const)("maps %s to its own localized sentence", (code, key) => {
    expect(describeApiError(en, { code, message: "raw backend text" })).toEqual({ message: en.apiErrors[key], technical: { code, message: "raw backend text" } });
    expect(describeApiError(tr, { code, message: "raw backend text" })?.message).toBe(tr.apiErrors[key]);
  });

  it("reuses existing copy for upload rejections and stage failures", () => {
    expect(describeApiError(en, { code: "file_too_large", message: "The upload exceeds the maximum PDF size." })?.message).toBe(en.errors.fileTooLarge);
    expect(describeApiError(tr, { code: "invalid_file_type", message: "The uploaded file is not a valid PDF." })?.message).toBe(tr.errors.invalidPdf);
    expect(describeApiError(en, { code: "parse_worker_error", message: "x" })?.message).toBe(en.errors.parseFailed);
    expect(describeApiError(en, { code: "lineage_incompatible", message: "x" })?.message).toBe(en.runs.incompatibleLineage);
  });

  it("falls back to the caller's context copy for unknown codes without hiding the diagnostics", () => {
    const error = { code: "brand_new_backend_code", message: "Something specific happened." };
    expect(describeApiError(en, error, en.errors.experimentFailed)).toEqual({
      message: en.errors.experimentFailed,
      technical: { code: "brand_new_backend_code", message: "Something specific happened." },
    });
    expect(describeApiError(en, error)?.message).toBe(en.apiErrors.generic);
    // Object prototype names are codes like any other, not lookups.
    expect(describeApiError(en, { code: "constructor", message: "x" })?.message).toBe(en.apiErrors.generic);
    // A plain JavaScript error has no code; its message is still a diagnostic.
    expect(describeApiError(en, new TypeError("Failed to fetch"), en.documents.sample.failed)).toEqual({
      message: en.documents.sample.failed,
      technical: { code: "—", message: "Failed to fetch" },
    });
  });

  it("treats an unstructured server failure as a temporary outage", () => {
    const error = new DocumentApiError("unknown", "The RAG backend returned an error.", 502);
    expect(describeApiError(tr, error, tr.errors.parseFailed)?.message).toBe(tr.apiErrors.serviceUnavailable);
    expect(describeApiError(en, new DocumentApiError("unknown", "The RAG backend returned an error.", 400), en.errors.parseFailed)?.message).toBe(en.errors.parseFailed);
  });

  it("keeps copy the browser already localized and adds no technical noise", () => {
    expect(describeApiError(tr, new DocumentApiError("unknown", tr.errors.workspaceLoadFailed))).toEqual({ message: tr.errors.workspaceLoadFailed, technical: null });
    expect(describeApiError(en, new DocumentApiError("incompatible_lineage", en.errors.pipelineOtherDocument))).toEqual({ message: en.errors.pipelineOtherDocument, technical: null });
  });

  it("does not repeat a raw message that is already the shown copy", () => {
    const local = new DocumentApiError("invalid_file_type", en.errors.invalidPdf);
    expect(describeApiError(en, local)).toEqual({ message: en.errors.invalidPdf, technical: { code: "invalid_file_type", message: null } });
    // Without a code or a different message there is nothing technical to show.
    expect(describeApiError(en, new Error(en.documents.sample.failed), en.documents.sample.failed)).toEqual({ message: en.documents.sample.failed, technical: null });
  });

  it("ignores values that are not errors", () => {
    expect(describeApiError(en, null)).toBeNull();
    expect(describeApiError(en, undefined)).toBeNull();
    expect(describeApiError(en, "boom")).toBeNull();
    expect(describeApiError(en, {})).toBeNull();
  });

  it("has a Turkish sentence for every English one", () => {
    for (const key of Object.keys(en.apiErrors) as (keyof typeof en.apiErrors)[]) {
      expect(tr.apiErrors[key], key).toBeTruthy();
      expect(tr.apiErrors[key], key).not.toBe(en.apiErrors[key]);
    }
  });
});
