export type PipelineStepKey =
  | "document"
  | "parse"
  | "chunk"
  | "embed"
  | "index"
  | "retrieve"
  | "rerank"
  | "context"
  | "generate"
  | "evaluate";

export type PipelineStepState = "Not started" | "Ready" | "Processing" | "Completed" | "Skipped" | "Error" | "Locked" | "Stale";

export type DocumentActivityEventType =
  | "documentSelected"
  | "parseRequested"
  | "parsing"
  | "parseCompleted"
  | "parseFailed";

export type PipelineStepDefinition = {
  key: PipelineStepKey;
  icon: PipelineStepKey;
};
