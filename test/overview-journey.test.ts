import { describe, expect, it } from "vitest";

import {
  buildJourneyConnectorPath,
  deriveJourneyConnectorState,
  JOURNEY_CANVAS,
  JOURNEY_CONNECTOR_PAIRS,
  JOURNEY_GROUP_BOUNDS,
  JOURNEY_NODE_ANCHORS,
  JOURNEY_NODE_VISUALS,
  JOURNEY_STAGE_KEYS,
  journeyNodeVisualForState,
  mapJourneyX,
  normalizeJourneyPipelineState,
  normalizeJourneyX,
} from "@/lib/overview-journey";
import type { PipelineStepState } from "@/lib/rag-ui-types";

const allStates: PipelineStepState[] = [
  "Completed",
  "Ready",
  "Processing",
  "Error",
  "Stale",
  "Skipped",
  "Locked",
  "Not started",
];

describe("Overview journey presentation", () => {
  it("highlights only the first actionable Ready step while preserving completed work", () => {
    const normalized = normalizeJourneyPipelineState({
      document: "Completed",
      parse: "Completed",
      chunk: "Completed",
      embed: "Ready",
      index: "Ready",
      retrieve: "Ready",
      rerank: "Locked",
      context: "Locked",
      generate: "Locked",
      evaluate: "Ready",
    });

    expect(normalized).toMatchObject({
      document: "Completed",
      parse: "Completed",
      chunk: "Completed",
      embed: "Ready",
      index: "Ready",
      retrieve: "Locked",
      evaluate: "Locked",
    });
  });

  it("keeps real downstream processing and error signals visible", () => {
    const normalized = normalizeJourneyPipelineState({
      document: "Completed",
      parse: "Stale",
      chunk: "Ready",
      embed: "Locked",
      index: "Locked",
      retrieve: "Locked",
      rerank: "Locked",
      context: "Locked",
      generate: "Error",
      evaluate: "Processing",
    });

    expect(normalized.parse).toBe("Stale");
    expect(normalized.chunk).toBe("Locked");
    expect(normalized.generate).toBe("Error");
    expect(normalized.evaluate).toBe("Processing");
  });

  it.each([
    ["Completed", "Completed", "Completed"],
    ["Completed", "Ready", "Ready"],
    ["Completed", "Processing", "Processing"],
    ["Completed", "Error", "Error"],
    ["Completed", "Stale", "Stale"],
    ["Completed", "Skipped", "Skipped"],
    ["Completed", "Locked", "Locked"],
    ["Completed", "Not started", "Locked"],
    ["Skipped", "Completed", "Completed"],
    ["Skipped", "Ready", "Ready"],
  ] as const)("derives %s → %s as %s", (source, destination, expected) => {
    expect(deriveJourneyConnectorState(source, destination)).toBe(expected);
  });

  it.each([
    "Ready",
    "Processing",
    "Error",
    "Stale",
    "Locked",
    "Not started",
  ] as const)("keeps a %s source connector neutral", (source) => {
    expect(deriveJourneyConnectorState(source, "Completed")).toBe("Locked");
  });

  it("exposes a complete visual mapping for every pipeline state", () => {
    expect(Object.keys(JOURNEY_NODE_VISUALS).sort()).toEqual([...allStates].sort());
    for (const state of allStates) {
      const visual = journeyNodeVisualForState(state);
      expect(visual.iconColor).toMatch(/^var\(--/);
      expect(visual.backgroundColor).toBeTruthy();
      expect(visual.borderColor).toBeTruthy();
      expect(visual.opacity).toBeGreaterThan(0);
    }
    expect(journeyNodeVisualForState("Completed").iconColor).toBe("var(--success)");
    expect(journeyNodeVisualForState("Ready").iconColor).toBe("var(--brand)");
    expect(journeyNodeVisualForState("Locked").iconColor).toBe("var(--subtle-foreground)");
    expect(journeyNodeVisualForState("Not started").iconColor).toBe("var(--muted-foreground)");
  });

  it("keeps canonical X values normalized and ordered while mapping to a real width", () => {
    const ratios = JOURNEY_STAGE_KEYS.map((key) => normalizeJourneyX(JOURNEY_NODE_ANCHORS[key].x));
    expect(ratios.every((ratio) => ratio > 0 && ratio < 1)).toBe(true);
    expect(ratios).toEqual([...ratios].sort((left, right) => left - right));
    expect(mapJourneyX(JOURNEY_CANVAS.width, 1377)).toBeCloseTo(1377, 8);
    expect(mapJourneyX(JOURNEY_NODE_ANCHORS.document.x, JOURNEY_CANVAS.width)).toBeCloseTo(JOURNEY_NODE_ANCHORS.document.x, 8);
  });

  it("keeps the rightmost group inside the canvas with a small canonical remainder", () => {
    const measure = JOURNEY_GROUP_BOUNDS.measure;
    const remainder = JOURNEY_CANVAS.width - (measure.left + measure.width);
    expect(remainder / JOURNEY_CANVAS.width).toBeLessThan(0.03);
    expect(measure.left + measure.width).toBeLessThan(JOURNEY_CANVAS.width);
  });

  it("creates eight adjacent connector segments from the canonical anchors", () => {
    expect(JOURNEY_CONNECTOR_PAIRS).toHaveLength(8);
    expect(JOURNEY_CONNECTOR_PAIRS[0]).toEqual({ source: "document", destination: "parse" });
    expect(JOURNEY_CONNECTOR_PAIRS.at(-1)).toEqual({ source: "generate", destination: "evaluate" });
    const firstPath = buildJourneyConnectorPath("document", "parse");
    expect(firstPath).toContain(`${JOURNEY_NODE_ANCHORS.document.x} ${JOURNEY_NODE_ANCHORS.document.y}`);
    expect(firstPath).toContain(`${JOURNEY_NODE_ANCHORS.parse.x} ${JOURNEY_NODE_ANCHORS.parse.y}`);
  });
});
