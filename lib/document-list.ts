import type { DocumentSummary, PersistedDocument } from "@/lib/rag-api-types";

/**
 * Library rows show each document's latest parse state. Only the list endpoint
 * projects it (`latestParseStatus`/`latestParseError`); the upload response is
 * the bare document row, so a re-uploaded PDF must not reset a known state.
 */
export function upsertUploadedDocument(documents: PersistedDocument[], uploaded: PersistedDocument, reused: boolean): PersistedDocument[] {
  const existing = reused ? documents.find((item) => item.id === uploaded.id) : undefined;
  const row = existing
    ? {
        ...existing,
        ...uploaded,
        latestParseStatus: uploaded.latestParseStatus ?? existing.latestParseStatus ?? null,
        latestParseError: uploaded.latestParseError ?? existing.latestParseError ?? null,
      }
    : uploaded;
  return [row, ...documents.filter((item) => item.id !== uploaded.id)];
}

/**
 * Brings a document's library row in line with a freshly loaded summary: page
 * count, in-use run ids and the latest parse state (summary parse runs are
 * newest first). Returns the same array when nothing changed.
 */
export function withSummaryProjection(documents: PersistedDocument[], summary: DocumentSummary): PersistedDocument[] {
  const index = documents.findIndex((item) => item.id === summary.id);
  if (index < 0) return documents;
  const current = documents[index];
  const latest = summary.parseRuns[0] ?? null;
  const next: PersistedDocument = {
    ...current,
    pageCount: summary.pageCount,
    activeParseRunId: summary.activeParseRunId,
    activeChunkRunId: summary.activeChunkRunId,
    activeEmbeddingRunId: summary.activeEmbeddingRunId,
    latestParseStatus: latest?.status ?? null,
    latestParseError: latest?.error ?? null,
  };
  const unchanged = (Object.keys(next) as (keyof PersistedDocument)[]).every((key) => next[key] === current[key]);
  if (unchanged) return documents;
  return documents.map((item, position) => (position === index ? next : item));
}
