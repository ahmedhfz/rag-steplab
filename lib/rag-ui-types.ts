export type PipelineStepKey = "document" | "parse" | "chunk" | "embed" | "index" | "retrieve" | "generate";

export type PipelineStepState = "Not started" | "Ready" | "Processing" | "Completed" | "Error" | "Locked";

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
