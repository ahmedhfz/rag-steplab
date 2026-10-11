import type { DocumentLineageSelection, DocumentSummary, RunSummary } from "@/lib/rag-api-types";

/**
 * Scratch mode (no saved pipeline) has no server-side reference lineage, so
 * the in-use lineage is the scratch selection itself. Same rule as the
 * backend (`app/lineage.py::is_historical`): a completed run is historical
 * when it is not part of the in-use lineage.
 */
export function withSelectionLineageFlags(
  detail: DocumentSummary,
  selection: DocumentLineageSelection,
): DocumentSummary {
  const flag = <T extends RunSummary>(run: T, historical: boolean): T =>
    run.historicalLineage === historical ? run : { ...run, historicalLineage: historical };
  const completed = (run: RunSummary) => run.status === "completed";
  return {
    ...detail,
    parseRuns: detail.parseRuns.map((run) => flag(run, completed(run) && run.id !== selection.selectedParseRunId)),
    chunkRuns: detail.chunkRuns.map((run) => flag(run, completed(run) && run.id !== selection.selectedChunkRunId)),
    embeddingRuns: detail.embeddingRuns.map((run) => flag(run, completed(run) && run.id !== selection.selectedEmbeddingRunId)),
    experiments: detail.experiments.map((run) => flag(
      run,
      completed(run) && (
        run.chunkRunId !== selection.selectedChunkRunId
        || (run.embeddingRunId !== null && run.embeddingRunId !== selection.selectedEmbeddingRunId)
      ),
    )),
  };
}

/**
 * Copy only the `historicalLineage` flags of a refreshed summary onto the
 * current one; every other field (and therefore inspection/selection state
 * derived from it) is left untouched.
 */
export function withLineageFlagsFrom(detail: DocumentSummary, refreshed: DocumentSummary): DocumentSummary {
  const merge = <T extends RunSummary>(runs: T[], source: RunSummary[]): T[] => {
    const flags = new Map(source.map((run) => [run.id, run.historicalLineage]));
    return runs.map((run) => {
      const historical = flags.get(run.id);
      return historical === undefined || historical === run.historicalLineage ? run : { ...run, historicalLineage: historical };
    });
  };
  return {
    ...detail,
    parseRuns: merge(detail.parseRuns, refreshed.parseRuns),
    chunkRuns: merge(detail.chunkRuns, refreshed.chunkRuns),
    embeddingRuns: merge(detail.embeddingRuns, refreshed.embeddingRuns),
    experiments: merge(detail.experiments, refreshed.experiments),
  };
}
