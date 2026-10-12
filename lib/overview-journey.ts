import type { PipelineStepKey, PipelineStepState } from "@/lib/rag-ui-types";

export type JourneyStepKey = Exclude<PipelineStepKey, "index">;
export type JourneyLabelPlacement = "above" | "below";

export const JOURNEY_CANVAS = {
  width: 1054.1,
  height: 200,
} as const;

export const JOURNEY_NODE_SIZE = 40;

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

// Emphasis discipline: completed stages are green, only the next step carries
// the brand colour; amber/destructive are reserved for real exceptions.
// Semantic tokens from app/theme.css (light and dark resolve through the same names).
const CHERRY = "var(--color-text-brand-secondary)";
const WARNING = "var(--color-text-warning-primary)";
const ERROR = "var(--color-text-error-primary)";
const MUTED = "var(--color-text-quaternary)";
const SUBTLE = "var(--color-text-tertiary)";
const BORDER = "var(--color-border-secondary)";
const LINE = "var(--color-border-control)";
const SURFACE = "var(--color-bg-primary)";
const WELL = "var(--color-bg-secondary)";
const SUCCESS = "var(--color-text-success-primary)";
const SUCCESS_LINE = "var(--color-fg-success-secondary)";

export const JOURNEY_NODE_VISUALS: Readonly<Record<PipelineStepState, JourneyNodeVisual>> = {
  Completed: { borderColor: "var(--color-utility-success-200)", backgroundColor: "var(--color-bg-success-primary)", iconColor: SUCCESS, opacity: 1 },
  Ready: { borderColor: "var(--color-utility-brand-200)", backgroundColor: "var(--color-bg-brand-secondary)", iconColor: CHERRY, opacity: 1 },
  Processing: { borderColor: "var(--color-utility-warning-200)", backgroundColor: "var(--color-bg-warning-primary)", iconColor: WARNING, opacity: 1 },
  Error: { borderColor: "var(--color-utility-error-200)", backgroundColor: "var(--color-bg-error-primary)", iconColor: ERROR, opacity: 1 },
  Stale: { borderColor: "var(--color-utility-warning-200)", backgroundColor: "var(--color-bg-warning-primary)", iconColor: WARNING, opacity: 1 },
  Skipped: { borderColor: BORDER, backgroundColor: WELL, iconColor: MUTED, opacity: 1 },
  Locked: { borderColor: BORDER, backgroundColor: SURFACE, iconColor: MUTED, opacity: 0.65 },
  "Not started": { borderColor: BORDER, backgroundColor: WELL, iconColor: SUBTLE, opacity: 1 },
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
  Completed: { color: SUCCESS_LINE, opacity: 1, width: 2 },
  Ready: { color: CHERRY, opacity: 1, width: 2 },
  Processing: { color: WARNING, opacity: 0.9, width: 2 },
  Error: { color: ERROR, opacity: 0.9, width: 2 },
  Stale: { color: WARNING, opacity: 0.9, width: 2 },
  Skipped: { color: LINE, opacity: 1, width: 2 },
  Locked: { color: LINE, opacity: 0.4, width: 1.5 },
  "Not started": { color: LINE, opacity: 0.4, width: 1.5 },
};

export function journeyConnectorVisualForState(state: PipelineStepState): JourneyConnectorVisual {
  return JOURNEY_CONNECTOR_VISUALS[state];
}

/** Neutral track drawn under the completed (green) connectors while the fill sweeps over it. */
export const JOURNEY_FILL_TRACK: JourneyConnectorVisual = { color: LINE, opacity: 1, width: 2 };

/** Horizontal span, in canvas units, that the completed fill covers: first stage to the last completed one. */
export type JourneyFill = {
  startX: number;
  endX: number;
};

export function journeyFillExtent(stateFor: (step: JourneyStepKey) => PipelineStepState): JourneyFill | null {
  let endX: number | null = null;
  for (const { source, destination } of JOURNEY_CONNECTOR_PAIRS) {
    if (deriveJourneyConnectorState(stateFor(source), stateFor(destination)) === "Completed") endX = JOURNEY_NODE_ANCHORS[destination].x;
  }
  return endX === null ? null : { startX: JOURNEY_NODE_ANCHORS[JOURNEY_STAGE_KEYS[0]].x, endX };
}

const FILL_MIN_MS = 300;
const FILL_FULL_MS = 1200;

/** The sweep keeps a constant speed, so a longer completed span takes proportionally longer. */
export function journeyFillDurationMs(fill: JourneyFill): number {
  const fullSpan = JOURNEY_NODE_ANCHORS[JOURNEY_STAGE_KEYS[JOURNEY_STAGE_KEYS.length - 1]].x - fill.startX;
  return Math.round(Math.max(FILL_MIN_MS, (FILL_FULL_MS * (fill.endX - fill.startX)) / fullSpan));
}

/** When the linear sweep reaches a node, so its completion badge appears in step with the line. */
export function journeyFillDelayMs(step: JourneyStepKey, fill: JourneyFill | null): number {
  if (!fill || fill.endX <= fill.startX) return 0;
  const progress = (JOURNEY_NODE_ANCHORS[step].x - fill.startX) / (fill.endX - fill.startX);
  return Math.round(journeyFillDurationMs(fill) * Math.min(1, Math.max(0, progress)));
}
