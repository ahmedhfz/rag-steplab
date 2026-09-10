import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { installSeededApi, type SeededScenario } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

const viewport = { width: 1441, height: 1041 } as const;
const artifactDirectory = path.resolve("output/playwright/figma-production");
const referenceDirectory = path.resolve("e2e/visual/reference/production");
const visualDiff = path.resolve("e2e/visual/figma-visual-diff.mjs");
const updateReferences = process.env.UPDATE_PRODUCTION_VISUAL_REFERENCES === "1";

type VisualGroup = "overview" | "documents" | "parsing" | "chunking" | "embeddings" | "playground" | "evaluation" | "settings" | "auth";

type VisualState = {
  key: string;
  scenario: SeededScenario;
  route: string;
  group: VisualGroup;
  theme?: "light" | "dark";
  canonicalKey?: string;
  openSelect?: boolean;
};

const visualStates: VisualState[] = [
  { key: "overview", scenario: "complete", route: "/", group: "overview" },
  { key: "documents-populated", scenario: "documents-populated", route: "/documents", group: "documents" },
  { key: "parsing-result", scenario: "parsing-result", route: "/parse", group: "parsing" },
  { key: "chunking-config", scenario: "chunking-config", route: "/chunking", group: "chunking" },
  { key: "chunking-result", scenario: "chunking-result", route: "/chunking", group: "chunking" },
  { key: "embeddings-ready", scenario: "embeddings-ready", route: "/embeddings", group: "embeddings" },
  { key: "embeddings-result", scenario: "embeddings-result", route: "/embeddings", group: "embeddings" },
  { key: "playground-empty", scenario: "playground-empty", route: "/playground", group: "playground" },
  { key: "playground-retrieval", scenario: "playground-retrieval", route: "/playground", group: "playground" },
  { key: "playground-reranking", scenario: "playground-reranking", route: "/playground", group: "playground" },
  { key: "playground-context", scenario: "playground-context", route: "/playground", group: "playground" },
  { key: "playground-answer", scenario: "playground-answer", route: "/playground", group: "playground" },
  { key: "evaluation-dataset", scenario: "evaluation-dataset", route: "/evaluation", group: "evaluation" },
  { key: "evaluation-results", scenario: "evaluation-results", route: "/evaluation", group: "evaluation" },
  { key: "evaluation-compare", scenario: "evaluation-compare", route: "/evaluation", group: "evaluation" },
  { key: "settings", scenario: "settings", route: "/settings", group: "settings" },
];

const darkVisualStates: VisualState[] = [
  { key: "overview-dark", canonicalKey: "overview", scenario: "complete", route: "/", group: "overview", theme: "dark" },
  { key: "chunking-config-select-dark", canonicalKey: "chunking-config", scenario: "chunking-config", route: "/chunking", group: "chunking", theme: "dark", openSelect: true },
  { key: "playground-context-dark", canonicalKey: "playground-context", scenario: "playground-context", route: "/playground", group: "playground", theme: "dark" },
  { key: "evaluation-compare-dark", canonicalKey: "evaluation-compare", scenario: "evaluation-compare", route: "/evaluation", group: "evaluation", theme: "dark" },
  { key: "settings-dark", canonicalKey: "settings", scenario: "settings", route: "/settings", group: "settings", theme: "dark" },
];

const visualContracts: Record<VisualGroup, { maxMae: number; maxChangedPixelPercentage: number }> = {
  overview: { maxMae: 3.7, maxChangedPixelPercentage: 5 },
  documents: { maxMae: 4.5, maxChangedPixelPercentage: 8 },
  parsing: { maxMae: 4.5, maxChangedPixelPercentage: 8 },
  chunking: { maxMae: 5, maxChangedPixelPercentage: 8 },
  embeddings: { maxMae: 4.5, maxChangedPixelPercentage: 8 },
  playground: { maxMae: 4.5, maxChangedPixelPercentage: 8 },
  evaluation: { maxMae: 4.5, maxChangedPixelPercentage: 8 },
  settings: { maxMae: 4.5, maxChangedPixelPercentage: 8 },
  auth: { maxMae: 4.5, maxChangedPixelPercentage: 8 },
};

type RectExpectation = { x?: number; y?: number; width?: number; height?: number };

async function rect(locator: Locator) {
  return locator.evaluate((element) => {
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  });
}

async function assertRect(locator: Locator, expected: RectExpectation, label: string) {
  const actual = await rect(locator);
  for (const property of ["x", "y", "width", "height"] as const) {
    const expectedValue = expected[property];
    if (expectedValue === undefined) continue;
    expect(Math.abs(actual[property] - expectedValue), `${label}.${property}`).toBeLessThanOrEqual(1);
  }
}

async function settle(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.complete && image.naturalWidth > 0
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error(`Asset failed: ${image.src}`)), { once: true });
        })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function assertShellGeometry(page: Page) {
  const browserViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(browserViewport).toEqual(viewport);
  await assertRect(page.getByTestId("app-shell-sidebar"), { x: 0, y: 0, width: 248, height: viewport.height }, "sidebar");
  await assertRect(page.getByTestId("app-shell-main"), { x: 248, width: viewport.width - 248 }, "main");
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", viewport.width);
}

async function assertOverviewGeometry(page: Page, theme: "light" | "dark") {
  await assertRect(page.getByTestId("figma-overview-main"), { x: 248, y: 0, width: 1193 }, "overview-main");
  await assertRect(page.getByTestId("figma-overview-header"), { x: 288, y: 40, width: 1113, height: 82 }, "overview-header");
  const workspace = page.getByTestId("workspace-control-plane");
  await assertRect(workspace, { x: 288, y: 142, width: 1113 }, "overview-control-plane");
  await assertRect(workspace, { height: 194.5 }, "overview-control-plane-height");
  await expect(page.getByTestId("continue-surface")).toBeVisible();
  await expect(page.getByTestId("overview-lineage")).toHaveCount(0);
  await assertRect(page.getByTestId("figma-overview-pipeline"), { x: 288, width: 1113, height: 284 }, "overview-pipeline");
  await assertRect(page.getByTestId("overview-journey"), { x: 309, width: 1071, height: 216 }, "overview-journey");
  const journey = await rect(page.getByTestId("overview-journey"));
  const canvas = page.getByTestId("overview-journey-connectors");
  await expect(canvas).toHaveAttribute("viewBox", "0 0 1054.1 199.975");
  await expect(canvas).toHaveAttribute("preserveAspectRatio", "none");
  await expect(canvas.locator("path")).toHaveCount(8);

  const prepare = await rect(page.getByTestId("figma-overview-prepare"));
  const testGroup = await rect(page.getByTestId("figma-overview-test"));
  const measure = await rect(page.getByTestId("figma-overview-measure"));
  const expectedGroupRatios = {
    prepare: { left: 25.034 / 1054.1, width: 441 / 1054.1 },
    test: { left: 476.356 / 1054.1, width: 428 / 1054.1 },
    measure: { left: 914.809 / 1054.1, width: 114 / 1054.1 },
  };
  for (const [name, group, expected] of [
    ["prepare", prepare, expectedGroupRatios.prepare],
    ["test", testGroup, expectedGroupRatios.test],
    ["measure", measure, expectedGroupRatios.measure],
  ] as const) {
    expect(Math.abs((group.x - journey.x) / journey.width - expected.left), `${name}.left ratio`).toBeLessThanOrEqual(0.002);
    expect(Math.abs(group.width / journey.width - expected.width), `${name}.width ratio`).toBeLessThanOrEqual(0.002);
    expect(group.height, `${name}.height`).toBeCloseTo(192, 0);
  }
  expect(prepare.x + prepare.width).toBeLessThanOrEqual(testGroup.x + 1);
  expect(testGroup.x + testGroup.width).toBeLessThanOrEqual(measure.x + 1);
  expect(journey.x + journey.width - (measure.x + measure.width), "right-side journey remainder").toBeLessThanOrEqual(journey.width * 0.03 + 1);

  const nodes = page.locator('[data-testid^="overview-journey-node-"]');
  await expect(nodes).toHaveCount(9);
  const nodeGeometry = await nodes.evaluateAll((elements) => elements.map((element) => {
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height, state: element.getAttribute("data-state") };
  }));
  expect(nodeGeometry.every((node) => Math.abs(node.width - 40) <= 1 && Math.abs(node.height - 40) <= 1), "journey node dimensions").toBe(true);
  expect(nodeGeometry.slice(1).every(({ x }, index) => x > nodeGeometry[index].x), "journey node order").toBe(true);
  expect(nodeGeometry.map(({ state }) => state)).toEqual(["Completed", "Completed", "Completed", "Completed", "Completed", "Skipped", "Completed", "Completed", "Completed"]);
  await expect(page.getByTestId("overview-journey-connector-parse-chunk")).toHaveAttribute("data-state", "Completed");
  const chunkGlyph = page.getByTestId("overview-journey-desktop").getByTestId("overview-journey-glyph-chunk");
  await expect(chunkGlyph).toHaveAttribute("data-state", "Completed");
  expect(await chunkGlyph.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(theme === "dark" ? "rgb(117, 196, 143)" : "rgb(63, 122, 85)");
  const evaluation = nodeGeometry.at(-1);
  expect(evaluation).toBeDefined();
  expect(evaluation!.x + evaluation!.width / 2).toBeGreaterThanOrEqual(measure.x);
  expect(evaluation!.x + evaluation!.width / 2).toBeLessThanOrEqual(measure.x + measure.width);
  await assertRect(page.getByTestId("figma-overview-learning-note"), { x: 288, width: 1113 }, "overview-learning-note");
}

async function assertRouteGeometry(page: Page, state: VisualState) {
  const stateKey = state.canonicalKey ?? state.key;
  await assertShellGeometry(page);
  const stage = state.group === "parsing" ? "parse" : state.group;
  if (["parse", "chunking", "embeddings"].includes(stage)) {
    const next = page.getByTestId(`${stage}-next-action`);
    if (["chunking-config", "embeddings-ready"].includes(stateKey)) {
      await expect(next).toHaveCount(0);
    } else {
      await expect(next).toHaveCount(1);
      const footer = page.getByTestId(`${stage}-next-action-footer`);
      await expect(footer.locator(`[data-testid="${stage}-next-action"]`)).toHaveCount(1);
      const history = page.getByTestId(stage === "parse" ? "parse-history" : stage === "chunking" ? "chunk-history" : "embedding-history");
      const historyRect = await rect(history);
      expect((await rect(footer)).y).toBeGreaterThanOrEqual(historyRect.y + historyRect.height);
    }
  }
  if (stateKey === "overview") {
    await assertOverviewGeometry(page, state.theme ?? "light");
    return;
  }

  const rootTestId = state.group === "documents"
    ? "documents-screen"
    : state.group === "parsing"
      ? "parse-screen"
      : state.group === "chunking"
        ? "chunking-screen"
        : state.group === "embeddings"
          ? "embeddings-screen"
          : state.group === "playground"
            ? "playground-screen"
            : state.group === "evaluation"
              ? "evaluation-screen"
              : "settings-screen";
  await assertRect(page.getByTestId(rootTestId), { x: 248, width: 1193 }, `${state.key}-root`);

  if (state.group === "documents") {
    await assertRect(page.getByTestId("documents-page-header"), { x: 288, y: 40, width: 1113 }, "documents-header");
  } else if (state.group === "parsing") {
    await assertRect(page.getByTestId("parse-page-header"), { x: 288, y: 40, width: 1113, height: 92 }, "parse-header");
    await assertRect(page.getByTestId("parse-workspace-controls"), { x: 288, y: 144, width: 1113, height: 58 }, "parse-workspace-controls");
    await assertRect(page.getByTestId("parse-document-status"), { x: 858, y: 144, width: 543, height: 58 }, "parse-status");
    await assertRect(page.getByTestId("parse-result-summary"), { x: 288, y: 226, width: 1113, height: 103 }, "parse-result");
  } else if (state.group === "chunking") {
    await assertRect(page.getByTestId("chunking-page-header"), { x: 288, y: 40, width: 1113, height: 92 }, "chunking-header");
    await assertRect(page.getByTestId("pipeline-context-bar"), { x: 289, y: 145, width: 556, height: 53 }, "chunking-context");
    await assertRect(page.getByTestId("chunking-workspace"), { x: 288, y: 223, width: 1113, height: stateKey === "chunking-config" ? 240 : 739 }, "chunking-workspace");
  } else if (state.group === "embeddings") {
    await assertRect(page.getByTestId("embeddings-page-header"), { x: 288, y: 40, width: 1113, height: 92 }, "embeddings-header");
    await assertRect(page.getByTestId("pipeline-context-bar"), { x: 289, y: 145, width: 556, height: 53 }, "embeddings-context");
    await expect(page.getByTestId("embedding-input")).toHaveCount(0);
    const embeddingWorkspace = page.getByTestId("embeddings-workspace");
    await assertRect(embeddingWorkspace, { x: 288, y: 223, width: 1113 }, "embeddings-workspace");
    expect((await rect(embeddingWorkspace)).height, `${state.key}-workspace-height`).toBeGreaterThan(stateKey === "embeddings-ready" ? 60 : 150);
    await expect(page.getByTestId("embedding-lineage")).toBeVisible();
    expect((await rect(page.getByTestId("embedding-action-card"))).width).toBeLessThanOrEqual(760);
    const inputRect = await rect(page.getByTestId("embedding-primary-result"));
    const outputRect = await rect(page.getByTestId("embedding-output-result"));
    expect(outputRect.x - inputRect.x - inputRect.width).toBeLessThan(80);
  } else if (state.group === "playground") {
    await assertRect(page.getByTestId("pipeline-context-bar"), { x: 248, y: 0, width: 1193, height: 53 }, "playground-context-bar");
    await assertRect(page.getByTestId("playground-page-header"), { x: 288, y: 93, width: 1113, height: 92 }, "playground-header");
    await assertRect(page.getByTestId("playground-input"), { x: 288, y: 217, width: 1113 }, "playground-input");
    const primaryControls = [
      page.getByTestId("playground-mode-control"),
      page.getByTestId("playground-top-k-control").locator(":scope > div"),
      page.getByTestId("playground-reranker-control"),
    ];
    const controlRects = await Promise.all(primaryControls.map((control) => rect(control)));
    expect(controlRects.every((control) => Math.abs(control.height - 36) <= 1), `${state.key}-primary-control-heights`).toBe(true);
    expect(Math.max(...controlRects.map((control) => control.y)) - Math.min(...controlRects.map((control) => control.y)), `${state.key}-primary-control-alignment`).toBeLessThanOrEqual(1);
    const rerankerSwitch = page.getByTestId("playground-reranker-control").locator('[data-slot="switch"]');
    const switchRect = await rect(rerankerSwitch);
    const thumbRect = await rect(rerankerSwitch.locator('[data-slot="switch-thumb"]'));
    const expectedThumbOffset = await rerankerSwitch.getAttribute("data-state") === "checked" ? 18 : 2;
    expect(Math.abs(thumbRect.x - switchRect.x - expectedThumbOffset), `${state.key}-reranker-thumb-offset`).toBeLessThanOrEqual(1);
    if (stateKey !== "playground-empty") {
      await assertRect(page.getByTestId("playground-stage-layout"), { x: 288, width: 1113 }, "playground-stage-layout");
      await assertRect(page.getByTestId("playground-stage-rail"), { width: 260 }, "playground-stage-rail");
      await assertRect(page.getByTestId("playground-stage-content"), { x: 568, width: 833 }, "playground-stage-content");
    }
  } else if (state.group === "evaluation") {
    await assertRect(page.getByTestId("pipeline-context-bar"), { x: 248, y: 0, width: 1193, height: 53 }, "evaluation-context-bar");
    await assertRect(page.getByTestId("evaluation-page-header"), { x: 288, y: 93, width: 1113 }, "evaluation-header");
    await assertRect(page.getByTestId("evaluation-workspace-context"), { x: 288, width: 1113 }, "evaluation-workspace-context");
    const panel = page.getByTestId(`evaluation-panel-${stateKey.replace("evaluation-", "")}`);
    await assertRect(panel, { x: 288, width: 1113 }, `${state.key}-panel`);
    if (stateKey === "evaluation-compare") {
      const cards = page.getByTestId("evaluation-compare-content").locator("article");
      await expect(cards).toHaveCount(2);
      const first = await rect(cards.nth(0));
      const second = await rect(cards.nth(1));
      expect(Math.abs(first.width - second.width), "evaluation compare card widths").toBeLessThanOrEqual(1);
      expect(second.x - first.x).toBeGreaterThan(first.width);
    }
  } else {
    await assertRect(page.getByTestId("settings-page-header"), { x: 288, y: 40, width: 1113 }, "settings-header");
    await assertRect(page.getByTestId("settings-card"), { x: 288, width: 720 }, "settings-card");
  }
}

async function prepareState(page: Page, state: VisualState) {
  const stateKey = state.canonicalKey ?? state.key;
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: state.theme ?? "light", reducedMotion: "reduce" });
  await page.goto("/parse", { waitUntil: "networkidle" });
  await selectSeededDocument(page);
  await page.goto(state.route, { waitUntil: "networkidle" });

  if (stateKey === "playground-reranking") {
    await expect(page.getByTestId("experiment-stage-trace")).toBeVisible();
    await page.getByTestId("experiment-stage-trace").getByRole("button", { name: /^Reranking\b/ }).click();
    const rerankingContent = page.getByTestId("playground-stage-content");
    await expect(rerankingContent.getByRole("heading", { name: "Reranking", level: 2 })).toBeVisible();
    await expect(rerankingContent).toContainText("Reranked position");
    await expect(rerankingContent).not.toContainText("Rerank score");
    await expect(rerankingContent).not.toContainText("confidence");
  } else if (stateKey === "playground-context") {
    await expect(page.getByTestId("experiment-stage-trace")).toBeVisible();
    await page.getByTestId("experiment-stage-trace").getByRole("button", { name: /^Context\b/ }).click();
    await expect(page.getByTestId("playground-stage-content").getByRole("heading", { name: "Build context", level: 2 })).toBeVisible();
  } else if (stateKey === "playground-answer") {
    await expect(page.getByTestId("experiment-stage-trace")).toBeVisible();
    await page.getByTestId("experiment-stage-trace").getByRole("button", { name: /^Answer\b/ }).click();
    await expect(page.getByTestId("playground-stage-content").getByRole("heading", { name: "Answer", level: 2 })).toBeVisible();
    await expect(page.getByTestId("playground-current-actions").getByRole("button", { name: "Run generation again", exact: true })).toBeVisible();
    await expect(page.getByTestId("playground-current-actions").getByRole("button", { name: "Copy trace", exact: true })).toBeVisible();
  } else if (stateKey === "evaluation-results") {
    await page.getByTestId("evaluation-tab-results").click();
    await expect(page.getByTestId("evaluation-panel-results")).toBeVisible();
    await expect(page.getByText("Hit@K", { exact: true }).first()).toBeVisible();
  } else if (stateKey === "evaluation-compare") {
    await page.getByTestId("evaluation-tab-compare").click();
    const history = page.getByTestId("evaluation-history");
    await expect(history).toBeVisible();
    await history.locator("summary").click();
    const checks = history.locator('input[type="checkbox"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();
    await expect(page.getByTestId("evaluation-compare-content")).toBeVisible();
    await expect(page.getByTestId("evaluation-compare-content")).toContainText("RUN A");
    await expect(page.getByTestId("evaluation-compare-content")).toContainText("RUN B");
    await expect(page.getByTestId("evaluation-compare-context")).toContainText("Changed settings");
  }

  if (stateKey === "playground-empty") {
    await expect(page.getByTestId("playground-blocker")).toBeVisible();
    await expect(page.getByTestId("experiment-stage-trace")).toHaveCount(0);
  } else if (stateKey === "playground-retrieval") {
    await expect(page.getByTestId("experiment-stage-trace")).toBeVisible();
    await expect(page.getByTestId("playground-stage-content")).toContainText("ORBIT-731");
    await expect(page.getByTestId("playground-current-actions").getByRole("button", { name: "Continue", exact: true })).toBeVisible();
    await expect(page.getByTestId("playground-current-actions").getByRole("button", { name: "Copy trace", exact: true })).toBeVisible();
  } else if (stateKey === "parsing-result") {
    await expect(page.getByTestId("parse-result-summary")).toBeVisible();
  } else if (stateKey === "chunking-config") {
    await expect(page.getByTestId("chunking-workspace")).toBeVisible();
    await expect(page.getByTestId("chunk-results")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run chunking", exact: true })).toBeEnabled();
  } else if (stateKey === "chunking-result") {
    await expect(page.getByTestId("chunk-results")).toBeVisible();
  } else if (stateKey === "embeddings-ready") {
    await expect(page.getByRole("button", { name: "Create embeddings", exact: true })).toBeEnabled();
    await expect(page.getByText("RESULT SUMMARY", { exact: true })).toHaveCount(0);
  } else if (stateKey === "embeddings-result") {
    await expect(page.getByText("RESULT SUMMARY", { exact: true })).toBeVisible();
  } else if (stateKey === "documents-populated") {
    await expect(page.getByTestId("document-library")).toBeVisible();
    await expect(page.getByRole("button", { name: /e2e-seeded-golden\.pdf/ }).first()).toBeVisible();
  } else if (stateKey === "evaluation-dataset") {
    await expect(page.getByTestId("evaluation-panel-dataset")).toBeVisible();
    await expect(page.getByRole("button", { name: /e2e-seeded-golden-dataset/ }).first()).toBeVisible();
  } else if (stateKey === "settings") {
    await expect(page.getByTestId("settings-card")).toBeVisible();
  }

  if (state.openSelect) {
    await page.locator('[data-slot="select-trigger"]').first().click();
    await expect(page.locator('[data-slot="select-content"]')).toBeVisible();
  }
}

async function captureAndCompare(page: Page, state: VisualState) {
  const actualPath = path.join(artifactDirectory, `${state.key}-actual.png`);
  const diffPath = path.join(artifactDirectory, `${state.key}-diff.png`);
  const metricsPath = path.join(artifactDirectory, `${state.key}-metrics.json`);
  const referencePath = path.join(referenceDirectory, `${state.key}.png`);
  const contract = visualContracts[state.group];
  const dynamicMask = page.locator('[data-testid="app-shell-user"]:visible');

  await mkdir(artifactDirectory, { recursive: true });
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    mask: state.group === "auth" ? [] : [dynamicMask],
    maskColor: state.theme === "dark" ? "#141113" : "#ffffff",
    path: actualPath,
  });
  expect(screenshot.readUInt32BE(16), `${state.key} screenshot width`).toBe(viewport.width);
  expect(screenshot.readUInt32BE(20), `${state.key} screenshot height`).toBe(viewport.height);

  if (updateReferences) {
    await mkdir(referenceDirectory, { recursive: true });
    await writeFile(referencePath, screenshot);
    return;
  }

  try {
    await access(referencePath);
  } catch {
    throw new Error(`Missing production visual reference: ${referencePath}. Generate it once with UPDATE_PRODUCTION_VISUAL_REFERENCES=1.`);
  }

  execFileSync(process.execPath, [
    visualDiff,
    referencePath,
    actualPath,
    diffPath,
    metricsPath,
    String(contract.maxMae),
    "20",
    String(contract.maxChangedPixelPercentage),
  ], { stdio: "inherit" });

  const metrics = JSON.parse(await readFile(metricsPath, "utf8")) as { mae: number; changedPixelPercentage: number };
  expect(metrics.mae, `${state.key} MAE`).toBeLessThanOrEqual(contract.maxMae);
  expect(metrics.changedPixelPercentage, `${state.key} changed pixels`).toBeLessThanOrEqual(contract.maxChangedPixelPercentage);
}

test.describe("canonical desktop production React visual contracts", () => {
  test.describe.configure({ mode: "serial" });

  for (const state of [...visualStates, ...darkVisualStates]) {
    test(`${state.key} real React state preserves geometry and visual contract`, async ({ page }) => {
      await installSeededApi(page, { scenario: state.scenario, theme: state.theme ?? "light" });
      await prepareState(page, state);
      await settle(page);
      await expect(page.locator("html")).toHaveClass(state.theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      await expect(page.locator("html")).toHaveCSS("color-scheme", state.theme ?? "light");
      await assertRouteGeometry(page, state);
      await captureAndCompare(page, state);
    });
  }
});

test.describe("canonical desktop auth route inventory", () => {
  // Auth ekranlarını anonim tutarken korumalı Preview'ın bypass cookie'sini koruyoruz.
  // Boş storage state kullanmak Vercel'de uygulama yerine Vercel login ekranını açar.
  test.use({ storageState: "output/playwright/.auth/vercel-bypass.json" });

  test("auth-login-dark preserves its Dark visual contract", async ({ page }) => {
    const state: VisualState = { key: "auth-login-dark", scenario: "settings", route: "/login", group: "auth", theme: "dark" };
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("rag-steplab.preferences.v3", JSON.stringify({ locale: "en", showLearningHints: true, theme: "dark" }));
    });
    await page.goto(state.route, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
    await settle(page);
    await captureAndCompare(page, state);
  });

  for (const route of [
    ["auth-login", "/login", "Sign in"],
    ["auth-signup", "/login", "Create account"],
    ["auth-forgot", "/login", "Sign in"],
  ] as const) {
    test(`${route[0]} route screenshot`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(route[1], { waitUntil: "networkidle" });
      if (route[0] === "auth-signup") {
        await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Create account", level: 1 })).toBeVisible();
      } else if (route[0] === "auth-forgot") {
        await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
        await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Reset your password", level: 1 })).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: route[2], level: 1 })).toBeVisible();
      }
      await settle(page);
      await mkdir(artifactDirectory, { recursive: true });
      await page.screenshot({ animations: "disabled", caret: "hide", path: path.join(artifactDirectory, `${route[0]}.png`) });
    });
  }
});
