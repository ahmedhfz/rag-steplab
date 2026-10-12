import type {
  ChunkConfig,
  ChunkStrategy,
  DocumentLineageSelection,
  DocumentPipeline,
  DocumentSummary,
  ExperimentSummary,
  RunSummary,
} from "@/lib/rag-api-types";

/**
 * Pure lineage rules shared by the workspace provider and screens. A saved
 * pipeline (or the scratch selection) is the canonical identity; a downstream
 * run is usable only while it is a completed, compatible child of the selected
 * upstream run.
 */

export type PipelineOperationStatus = "locked" | "ready" | "processing" | "completed" | "skipped" | "error" | "stale";

export function emptyLineageSelection(): DocumentLineageSelection {
  return { selectedParseRunId: null, selectedChunkRunId: null, selectedEmbeddingRunId: null };
}

export function pipelineSelection(pipeline: Pick<DocumentPipeline, "parseRunId" | "chunkRunId" | "embeddingRunId">): DocumentLineageSelection {
  return {
    selectedParseRunId: pipeline.parseRunId,
    selectedChunkRunId: pipeline.chunkRunId,
    selectedEmbeddingRunId: pipeline.embeddingRunId,
  };
}

export function sameLineageSelection(a: DocumentLineageSelection, b: DocumentLineageSelection) {
  return a.selectedParseRunId === b.selectedParseRunId
    && a.selectedChunkRunId === b.selectedChunkRunId
    && a.selectedEmbeddingRunId === b.selectedEmbeddingRunId;
}

export function normalizeLineageSelection(value: unknown): DocumentLineageSelection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyLineageSelection();
  const payload = value as Record<string, unknown>;
  const id = (key: keyof DocumentLineageSelection) => typeof payload[key] === "string" ? payload[key] as string : null;
  return {
    selectedParseRunId: id("selectedParseRunId"),
    selectedChunkRunId: id("selectedChunkRunId"),
    selectedEmbeddingRunId: id("selectedEmbeddingRunId"),
  };
}

export function completedCompatibleRun(run: Pick<RunSummary, "status" | "isCompatible"> | undefined | null) {
  return Boolean(run && run.status === "completed" && run.isCompatible);
}

/**
 * The experiment a use screen shows for the working lineage: the newest
 * compatible run on its chunk run (keyword runs need no embedding). A saved
 * pipeline whose lineage did not resolve intact, e.g. because its embedding
 * format changed, has no current experiment: retrieval is blocked as
 * incompatible, so no earlier run may be presented as its result.
 */
export function currentExperimentSummary<T extends Pick<ExperimentSummary, "isCompatible" | "upstream" | "embeddingRunId">>(
  experiments: T[],
  selection: DocumentLineageSelection,
  pipelineLineage: DocumentLineageSelection | null,
): T | null {
  if (pipelineLineage && !sameLineageSelection(pipelineLineage, selection)) return null;
  return experiments.find((run) => run.isCompatible
    && run.upstream.chunkRunId === selection.selectedChunkRunId
    && (run.embeddingRunId === null || run.embeddingRunId === selection.selectedEmbeddingRunId)) ?? null;
}

export function pipelineStatusFromRun(run: Pick<RunSummary, "status">): PipelineOperationStatus {
  if (run.status === "queued" || run.status === "running") return "processing";
  if (run.status === "completed") return "completed";
  return "error";
}

/**
 * Resolves a stored selection against the document summary. In strict mode
 * (saved pipelines) missing runs stay empty; otherwise the document's active
 * runs fill the gaps for the scratch workspace.
 */
export function resolveLineageSelection(
  detail: DocumentSummary,
  stored?: DocumentLineageSelection,
  strict = false,
): DocumentLineageSelection {
  const candidate = stored ?? emptyLineageSelection();
  const parse = detail.parseRuns.find((run) => run.id === candidate.selectedParseRunId && completedCompatibleRun(run))
    ?? (strict ? undefined : detail.parseRuns.find((run) => run.id === detail.activeParseRunId && completedCompatibleRun(run)));
  const parseRunId = parse?.id ?? null;
  const chunk = parseRunId
    ? detail.chunkRuns.find((run) => run.id === candidate.selectedChunkRunId && run.upstream.parseRunId === parseRunId && completedCompatibleRun(run))
      ?? (strict ? undefined : detail.chunkRuns.find((run) => run.id === detail.activeChunkRunId && run.upstream.parseRunId === parseRunId && completedCompatibleRun(run)))
    : undefined;
  const chunkRunId = chunk?.id ?? null;
  const embedding = chunkRunId
    ? detail.embeddingRuns.find((run) => run.id === candidate.selectedEmbeddingRunId && run.upstream.chunkRunId === chunkRunId && completedCompatibleRun(run))
      ?? (strict ? undefined : detail.embeddingRuns.find((run) => run.id === detail.activeEmbeddingRunId && run.upstream.chunkRunId === chunkRunId && completedCompatibleRun(run)))
    : undefined;
  return {
    selectedParseRunId: parseRunId,
    selectedChunkRunId: chunkRunId,
    selectedEmbeddingRunId: embedding?.id ?? null,
  };
}

export type ReparseImpact = {
  /** Where the new parse would be recorded: a saved pipeline or the scratch selection. */
  target: "pipeline" | "scratch";
  pipelineId: string | null;
  pipelineName: string | null;
  /** Selected downstream runs that a completed reparse removes from the working lineage. */
  clearsChunk: boolean;
  clearsEmbedding: boolean;
  /** True when the reparse discards a downstream selection, so the UI should confirm first. */
  requiresConfirmation: boolean;
};

/**
 * A completed reparse records `{parse: new, chunk: null, embedding: null}`.
 * Earlier artifacts remain in history but leave the working lineage.
 */
export function describeReparseImpact(
  pipeline: Pick<DocumentPipeline, "id" | "name"> | null,
  selection: DocumentLineageSelection,
): ReparseImpact {
  const clearsChunk = selection.selectedChunkRunId !== null;
  const clearsEmbedding = selection.selectedEmbeddingRunId !== null;
  return {
    target: pipeline ? "pipeline" : "scratch",
    pipelineId: pipeline?.id ?? null,
    pipelineName: pipeline?.name ?? null,
    clearsChunk,
    clearsEmbedding,
    requiresConfirmation: clearsChunk || clearsEmbedding,
  };
}

export const DEFAULT_CHUNK_STRATEGY: ChunkStrategy = "structure_aware";
export const DEFAULT_CHUNK_CONFIG: ChunkConfig = { chunkSizeTokens: 512, overlapTokens: 64 };

export type ChunkFormConfig = { strategy: ChunkStrategy; config: ChunkConfig };

/** The chunking form starts from the selected run so it reflects the result on screen. */
export function chunkFormConfigFromRun(run: Pick<RunSummary, "strategy" | "config"> | null | undefined): ChunkFormConfig {
  const size = run?.config?.chunkSizeTokens;
  const overlap = run?.config?.overlapTokens;
  return {
    strategy: run?.strategy ?? DEFAULT_CHUNK_STRATEGY,
    config: {
      chunkSizeTokens: typeof size === "number" && Number.isFinite(size) ? size : DEFAULT_CHUNK_CONFIG.chunkSizeTokens,
      overlapTokens: typeof overlap === "number" && Number.isFinite(overlap) ? overlap : DEFAULT_CHUNK_CONFIG.overlapTokens,
    },
  };
}

export type ChunkStageState = {
  /** The form differs from the selected chunk run (or there is no selected run). */
  isDirty: boolean;
  /** A completed, compatible chunk run of the selected parse matches the form; re-running is unnecessary. */
  isUpToDate: boolean;
};

export function chunkStageState(
  selectedRun: Pick<RunSummary, "status" | "isCompatible" | "strategy" | "config" | "upstream"> | null | undefined,
  selectedParseRunId: string | null,
  form: ChunkFormConfig,
): ChunkStageState {
  if (!selectedRun) return { isDirty: true, isUpToDate: false };
  const saved = chunkFormConfigFromRun(selectedRun);
  const isDirty = saved.strategy !== form.strategy
    || saved.config.chunkSizeTokens !== form.config.chunkSizeTokens
    || saved.config.overlapTokens !== form.config.overlapTokens;
  const isUpToDate = !isDirty
    && completedCompatibleRun(selectedRun)
    && selectedParseRunId !== null
    && selectedRun.upstream.parseRunId === selectedParseRunId;
  return { isDirty, isUpToDate };
}
