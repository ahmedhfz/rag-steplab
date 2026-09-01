import type { PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";

export type JourneyStepKey = Exclude<PipelineStepKey, "index">;
export type JourneyLabelPlacement = "above" | "below";

export const JOURNEY_CANVAS = {
  width: 1054.1,
  height: 199.975,
} as const;

export const JOURNEY_NODE_SIZE = 40;
export const JOURNEY_GROUP_HEIGHT = 192;
export const JOURNEY_DESKTOP_HEIGHT = 216;

export const JOURNEY_STAGE_KEYS = [
  "document",
  "parse",
  "chunk",
  "embed",
  "retrieve",
  "rerank",
  "context",
  "generate",
  "evaluate",
] as const satisfies readonly JourneyStepKey[];

const ACTIVE_JOURNEY_STATES = new Set<PipelineStepState>(["Ready", "Processing", "Error", "Stale", "Not started"]);

export function normalizeJourneyPipelineState(
  pipelineState: Record<PipelineStepKey, PipelineStepState>,
): Record<PipelineStepKey, PipelineStepState> {
  const normalized = { ...pipelineState };
  let activeStepFound = false;

  for (const step of JOURNEY_STAGE_KEYS) {
    const state = pipelineState[step];
    if (!ACTIVE_JOURNEY_STATES.has(state)) continue;

    if (!activeStepFound) {
      activeStepFound = true;
      if (state === "Not started") normalized[step] = "Ready";
      continue;
    }

    // Aşağı akıştaki Ready durumları teknik erişilebilirliği gösterir.
    // Journey ise öğrenme sırasındaki yalnız ilk eyleme açık adımı vurgular.
    if (state === "Ready" || state === "Not started") normalized[step] = "Locked";
  }

  normalized.index = normalized.embed;
  return normalized;
}

export type JourneyAnchor = {
  x: number;
  y: number;
  label: JourneyLabelPlacement;
};

// These anchors are the centers of the nodes in the exported Figma curve.
export const JOURNEY_NODE_ANCHORS: Readonly<Record<JourneyStepKey, JourneyAnchor>> = {
  document: { x: 82.2198, y: 75.9905, label: "above" },
  parse: { x: 193.954, y: 135.983, label: "below" },
  chunk: { x: 303.581, y: 75.9905, label: "above" },
  embed: { x: 415.315, y: 135.983, label: "below" },
  retrieve: { x: 527.05, y: 75.9905, label: "above" },
  rerank: { x: 634.568, y: 135.983, label: "below" },
  context: { x: 746.303, y: 75.9905, label: "above" },
  generate: { x: 855.929, y: 135.983, label: "below" },
  evaluate: { x: 967.664, y: 75.9905, label: "above" },
};

export type JourneyGroupKey = "prepare" | "test" | "measure";

export type JourneyGroupBounds = {
  left: number;
  width: number;
};

export const JOURNEY_GROUP_BOUNDS: Readonly<Record<JourneyGroupKey, JourneyGroupBounds>> = {
  prepare: { left: 25.034, width: 441 },
  test: { left: 476.356, width: 428 },
  measure: { left: 914.809, width: 114 },
};

export type JourneyConnectorPair = {
  source: JourneyStepKey;
  destination: JourneyStepKey;
};

export const JOURNEY_CONNECTOR_PAIRS: readonly JourneyConnectorPair[] = JOURNEY_STAGE_KEYS
  .slice(0, -1)
  .map((source, index) => ({ source, destination: JOURNEY_STAGE_KEYS[index + 1] }));

export function normalizeJourneyX(canonicalX: number): number {
  return canonicalX / JOURNEY_CANVAS.width;
}

export function mapJourneyX(canonicalX: number, containerWidth: number): number {
  return normalizeJourneyX(canonicalX) * containerWidth;
}

export function journeyXPercent(canonicalX: number): string {
  return `${normalizeJourneyX(canonicalX) * 100}%`;
}

export function journeyNodePosition(key: JourneyStepKey) {
  const anchor = JOURNEY_NODE_ANCHORS[key];
  return {
    left: `calc(${journeyXPercent(anchor.x)} - ${JOURNEY_NODE_SIZE / 2}px)`,
    top: anchor.y - JOURNEY_NODE_SIZE / 2,
    label: anchor.label,
  };
}

export function journeyGroupPosition(key: JourneyGroupKey) {
  const bounds = JOURNEY_GROUP_BOUNDS[key];
  return {
    left: journeyXPercent(bounds.left),
    width: `${normalizeJourneyX(bounds.width) * 100}%`,
  };
}

export function buildJourneyConnectorPath(source: JourneyStepKey, destination: JourneyStepKey): string {
  const sourceAnchor = JOURNEY_NODE_ANCHORS[source];
  const destinationAnchor = JOURNEY_NODE_ANCHORS[destination];
  const controlX = (sourceAnchor.x + destinationAnchor.x) / 2;
  return `M ${sourceAnchor.x} ${sourceAnchor.y} C ${controlX} ${sourceAnchor.y} ${controlX} ${destinationAnchor.y} ${destinationAnchor.x} ${destinationAnchor.y}`;
}

export function deriveJourneyConnectorState(sourceState: PipelineStepState, destinationState: PipelineStepState): PipelineStepState {
  if (sourceState !== "Completed" && sourceState !== "Skipped") return "Locked";

  if (destinationState === "Completed") return "Completed";
  if (destinationState === "Ready") return "Ready";
  if (destinationState === "Processing") return "Processing";
  if (destinationState === "Error") return "Error";
  if (destinationState === "Stale") return "Stale";
  if (destinationState === "Skipped") return "Skipped";
  return "Locked";
}

export type JourneyNodeVisual = {
  borderColor: string;
  backgroundColor: string;
  iconColor: string;
  opacity: number;
};

const SUCCESS = "#3f7a55";
const CHERRY = "#711f3a";
const WARNING = "#8d651e";
const ERROR = "#a23b3b";
const MUTED = "#969093";
const SUBTLE = "#6e676a";
const BORDER = "#e7e2e4";

export const JOURNEY_NODE_VISUALS: Readonly<Record<PipelineStepState, JourneyNodeVisual>> = {
  Completed: { borderColor: "transparent", backgroundColor: "#eef4ef", iconColor: SUCCESS, opacity: 1 },
  Ready: { borderColor: "#e3a9b9", backgroundColor: "#f3d9e0", iconColor: CHERRY, opacity: 1 },
  Processing: { borderColor: "#eadfc9", backgroundColor: "#fffaf1", iconColor: WARNING, opacity: 1 },
  Error: { borderColor: "#edcfcf", backgroundColor: "#fbefef", iconColor: ERROR, opacity: 1 },
  Stale: { borderColor: "#eadfc9", backgroundColor: "#fffaf1", iconColor: WARNING, opacity: 1 },
  Skipped: { borderColor: BORDER, backgroundColor: "#f7f5f6", iconColor: MUTED, opacity: 1 },
  Locked: { borderColor: BORDER, backgroundColor: "white", iconColor: MUTED, opacity: 0.65 },
  "Not started": { borderColor: BORDER, backgroundColor: "#f2eff0", iconColor: SUBTLE, opacity: 1 },
};

export function journeyNodeVisualForState(state: PipelineStepState): JourneyNodeVisual {
  return JOURNEY_NODE_VISUALS[state];
}

export type JourneyConnectorVisual = {
  color: string;
  opacity: number;
  width: number;
};

export const JOURNEY_CONNECTOR_VISUALS: Readonly<Record<PipelineStepState, JourneyConnectorVisual>> = {
  Completed: { color: SUCCESS, opacity: 0.75, width: 2.56657 },
  Ready: { color: CHERRY, opacity: 1, width: 2.56657 },
  Processing: { color: WARNING, opacity: 0.9, width: 2.56657 },
  Error: { color: ERROR, opacity: 0.9, width: 2.56657 },
  Stale: { color: WARNING, opacity: 0.9, width: 2.56657 },
  Skipped: { color: MUTED, opacity: 0.9, width: 2.56657 },
  Locked: { color: "#d8d2d5", opacity: 1, width: 2.05326 },
  "Not started": { color: "#d8d2d5", opacity: 1, width: 2.05326 },
};

export function journeyConnectorVisualForState(state: PipelineStepState): JourneyConnectorVisual {
  return JOURNEY_CONNECTOR_VISUALS[state];
}
