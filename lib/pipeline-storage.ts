import { normalizeLineageSelection } from "@/lib/pipeline-lineage";
import type { DocumentLineageSelection } from "@/lib/rag-api-types";

/**
 * Browser storage helpers for workspace conveniences. Saved pipelines on the
 * server stay canonical; these values only restore the last local cursor.
 */
export type LineageSelectionStore = Record<string, DocumentLineageSelection>;

export const ACTIVE_DOCUMENT_STORAGE_KEY = "rag-steplab-active-document-id";
const ACTIVE_DOCUMENT_STORAGE_PREFIX = `${ACTIVE_DOCUMENT_STORAGE_KEY}:`;
const LINEAGE_SELECTION_STORAGE_KEY = "rag-steplab-lineage-selections-v1";
const LINEAGE_SELECTION_STORAGE_PREFIX = `${LINEAGE_SELECTION_STORAGE_KEY}:`;
const ACTIVE_PIPELINE_STORAGE_KEY = "rag-steplab-active-pipeline-id";
const ACTIVE_PIPELINE_STORAGE_PREFIX = `${ACTIVE_PIPELINE_STORAGE_KEY}:`;
const ACTIVE_PIPELINE_DOCUMENT_STORAGE_PREFIX = `${ACTIVE_PIPELINE_STORAGE_KEY}:document:`;
const SCRATCH_PIPELINE_STORAGE_VALUE = "__scratch__";

export function activeDocumentStorageKey(userId?: string | null) {
  return userId ? `${ACTIVE_DOCUMENT_STORAGE_PREFIX}${userId}` : ACTIVE_DOCUMENT_STORAGE_KEY;
}

export function rememberActiveDocument(documentId: string | null, userId?: string | null) {
  try {
    const key = activeDocumentStorageKey(userId);
    if (documentId) window.localStorage.setItem(key, documentId);
    else window.localStorage.removeItem(key);
  } catch {
    // Kalıcı seçim bir kolaylıktır; storage engeli gerçek pipeline'ı durdurmamalıdır.
  }
}

/** Reads the last active document, migrating the pre-user-scoped key once. */
export function readActiveDocument(userId?: string | null): string | null {
  try {
    const scoped = window.localStorage.getItem(activeDocumentStorageKey(userId));
    if (scoped || !userId) return scoped;
    const legacy = window.localStorage.getItem(ACTIVE_DOCUMENT_STORAGE_KEY);
    if (legacy) rememberActiveDocument(legacy, userId);
    return legacy;
  } catch {
    // Browser storage kapalıysa kalıcı backend verisi yine kullanılabilir.
    return null;
  }
}

function activePipelineStorageKey(userId?: string | null, documentId?: string | null) {
  if (documentId) return userId
    ? `${ACTIVE_PIPELINE_DOCUMENT_STORAGE_PREFIX}${userId}:${documentId}`
    : `${ACTIVE_PIPELINE_DOCUMENT_STORAGE_PREFIX}${documentId}`;
  return userId ? `${ACTIVE_PIPELINE_STORAGE_PREFIX}${userId}` : ACTIVE_PIPELINE_STORAGE_KEY;
}

export function rememberActivePipeline(pipelineId: string | null, userId?: string | null, documentId?: string | null) {
  try {
    const key = activePipelineStorageKey(userId, documentId);
    window.localStorage.setItem(key, pipelineId ?? SCRATCH_PIPELINE_STORAGE_VALUE);
  } catch {
    // Pipeline kimliği yalnız oturum kolaylığıdır; asıl seçim server state'idir.
  }
}

export function forgetActivePipeline(userId?: string | null, documentId?: string | null) {
  try {
    window.localStorage.removeItem(activePipelineStorageKey(userId, documentId));
  } catch {
    // Storage engeli silme akışını durdurmamalıdır.
  }
}

/** `undefined` means "nothing stored"; `null` means the scratch workspace. */
export function readActivePipeline(documentId: string, userId?: string | null): string | null | undefined {
  try {
    const scoped = window.localStorage.getItem(activePipelineStorageKey(userId, documentId));
    const value = scoped ?? window.localStorage.getItem(activePipelineStorageKey(userId));
    if (value === null) return undefined;
    return value === SCRATCH_PIPELINE_STORAGE_VALUE ? null : value;
  } catch {
    return undefined;
  }
}

function lineageSelectionStorageKey(userId?: string | null) {
  return userId ? `${LINEAGE_SELECTION_STORAGE_PREFIX}${userId}` : LINEAGE_SELECTION_STORAGE_KEY;
}

export function readLineageSelections(userId?: string | null): LineageSelectionStore {
  try {
    const raw = window.localStorage.getItem(lineageSelectionStorageKey(userId));
    if (!raw) return {};
    const payload = JSON.parse(raw) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
    return Object.fromEntries(Object.entries(payload).map(([documentId, selection]) => [documentId, normalizeLineageSelection(selection)]));
  } catch {
    return {};
  }
}

export function rememberLineageSelections(selections: LineageSelectionStore, userId?: string | null) {
  try {
    window.localStorage.setItem(lineageSelectionStorageKey(userId), JSON.stringify(selections));
  } catch {
    // Seçim persistence yalnız bir kolaylıktır; pipeline'ı durdurmamalıdır.
  }
}
