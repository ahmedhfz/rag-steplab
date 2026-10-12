import { execFileSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { expectNoHorizontalOverflow } from "../support/overflow";
import { installSeededApi, seededStressNames, type SeededScenario } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

const viewport = { width: 1441, height: 1041 } as const;
const mobileViewport = { width: 390, height: 844 } as const;
const artifactDirectory = path.resolve("output/playwright/production-visual");
const referenceDirectory = path.resolve("e2e/visual/reference/production");
const visualDiff = path.resolve("e2e/visual/visual-diff.mjs");
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
  /** Mobile states (390×844) assert the no-overflow contract instead of the desktop geometry. */
  viewport?: { width: number; height: number };
  locale?: "en" | "tr";
  /** Long single-token document/pipeline names (wrapping and truncation stress). */
  longNames?: boolean;
};

const visualStates: VisualState[] = [
  { key: "overview-first-use", scenario: "fresh", route: "/", group: "overview" },
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
  // Also the README's Dark screenshot source (docs/images/playground-dark.png).
  { key: "playground-answer-dark", canonicalKey: "playground-answer", scenario: "playground-answer", route: "/playground", group: "playground", theme: "dark" },
  { key: "evaluation-compare-dark", canonicalKey: "evaluation-compare", scenario: "evaluation-compare", route: "/evaluation", group: "evaluation", theme: "dark" },
  { key: "settings-dark", canonicalKey: "settings", scenario: "settings", route: "/settings", group: "settings", theme: "dark" },
];

// Turkish interface: no mixed-language leftovers in a dense Prepare and a dense Test screen.
const turkishVisualStates: VisualState[] = [
  { key: "chunking-result-tr", canonicalKey: "chunking-result", scenario: "chunking-result", route: "/chunking", group: "chunking", locale: "tr" },
  { key: "playground-answer-tr", canonicalKey: "playground-answer", scenario: "playground-answer", route: "/playground", group: "playground", locale: "tr" },
];

const mobileVisualStates: VisualState[] = [
  { key: "overview-mobile", canonicalKey: "overview", scenario: "complete", route: "/", group: "overview", viewport: mobileViewport },
  { key: "documents-populated-mobile", canonicalKey: "documents-populated", scenario: "documents-populated", route: "/documents", group: "documents", viewport: mobileViewport, longNames: true },
  { key: "parsing-result-mobile", canonicalKey: "parsing-result", scenario: "parsing-result", route: "/parse", group: "parsing", viewport: mobileViewport },
  { key: "playground-answer-mobile", canonicalKey: "playground-answer", scenario: "playground-answer", route: "/playground", group: "playground", viewport: mobileViewport },
  { key: "evaluation-compare-mobile", canonicalKey: "evaluation-compare", scenario: "evaluation-compare", route: "/evaluation", group: "evaluation", viewport: mobileViewport },
  { key: "playground-answer-mobile-dark", canonicalKey: "playground-answer", scenario: "playground-answer", route: "/playground", group: "playground", viewport: mobileViewport, theme: "dark" },
];

/**
 * References are generated in the CI Linux/Chromium image (`production-visual-update`),
 * so only rendering noise remains; any real layout or copy change exceeds this.
 */
const visualContract = { maxMae: 1.5, maxChangedPixelPercentage: 1.5 } as const;

/** Host chrome outside the app (Vercel Preview toolbar, Next dev overlay) never enters a frame. */
const hiddenHostChrome = "vercel-live-feedback, nextjs-portal { display: none !important; }";

/**
 * `fluid` widths were measured without a scrollbar; at >=768px `scrollbar-gutter: stable`
 * reserves the gutter, so the column (and `fluid` share of it) shrinks by that amount.
 */
type RectExpectation = { x?: number; y?: number; width?: number; height?: number; fluid?: number };

async function rect(locator: Locator) {
  return locator.evaluate((element) => {
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  });
}

async function assertRect(locator: Locator, expected: RectExpectation, label: string) {
  const actual = await rect(locator);
  const gutter = expected.fluid ? viewport.width - await contentWidth(locator.page()) : 0;
  for (const property of ["x", "y", "width", "height"] as const) {
    let expectedValue = expected[property];
    if (expectedValue === undefined) continue;
    if (property === "width" && expected.fluid) expectedValue -= gutter * expected.fluid;
    // Soft: one run reports every geometry drift and still writes references in update mode.
    expect.soft(Math.abs(actual[property] - expectedValue), `${label}.${property}`).toBeLessThanOrEqual(1);
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

/** Structural contract: `below` starts under `above` (no overlap), independent of exact heights. */
async function assertBelow(above: Locator, below: Locator, label: string) {
  const top = await rect(above);
  const bottom = await rect(below);
  expect(bottom.y, label).toBeGreaterThanOrEqual(top.y + top.height - 1);
}

/** Stage screens carry the document/pipeline context as a breadcrumb inside the header, above the title. */
async function assertInlineStageContext(header: Locator, label: string) {
  const context = header.getByTestId("pipeline-context-bar");
  await expect(context, `${label} context sits in the header`).toBeVisible();
  const headerRect = await rect(header);
  const contextRect = await rect(context);
  // A plain h1 locator: an open Select marks the rest of the page aria-hidden, so role queries miss it.
  const titleRect = await rect(header.locator("h1"));
  expect(contextRect.x, `${label} context starts in the header column`).toBeGreaterThanOrEqual(headerRect.x - 8);
  expect(contextRect.x + contextRect.width, `${label} context stays in the header`).toBeLessThanOrEqual(headerRect.x + headerRect.width + 1);
  expect(contextRect.y + contextRect.height, `${label} context above the title`).toBeLessThanOrEqual(titleRect.y + 1);
}

/** Layout width without the reserved scrollbar gutter (`scrollbar-gutter: stable` at >=768px). */
async function contentWidth(page: Page) {
  return page.evaluate(() => Math.round(document.body.getBoundingClientRect().width));
}

async function assertShellGeometry(page: Page) {
  const browserViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(browserViewport).toEqual(viewport);
  await assertRect(page.getByTestId("app-shell-sidebar"), { x: 0, y: 0, width: 248, height: viewport.height }, "sidebar");
  await assertRect(page.getByTestId("app-shell-main"), { x: 248, width: (await contentWidth(page)) - 248 }, "main");
  await expect(page.locator("html")).toHaveJSProperty("scrollWidth", await contentWidth(page));
}

async function assertOverviewGeometry(page: Page, theme: "light" | "dark") {
  await assertRect(page.getByTestId("overview-main"), { x: 248, y: 0, width: (await contentWidth(page)) - 248 }, "overview-main");
  // PageHeader has no fixed height; only the column and the stacking order are contracts.
  const header = page.getByTestId("overview-page-header");
  await assertRect(header, { x: 288, y: 40, width: 1113, fluid: 1 }, "overview-header");
  const workspace = page.getByTestId("workspace-control-plane");
  await assertRect(workspace, { x: 288, width: 1113, fluid: 1 }, "overview-control-plane");
  await assertBelow(header, workspace, "overview-control-plane below header");
  await expect(page.getByTestId("continue-surface")).toBeVisible();
  await expect(page.getByTestId("overview-lineage")).toHaveCount(0);
  const pipeline = page.getByTestId("overview-pipeline");
  await assertRect(pipeline, { x: 288, width: 1113, fluid: 1 }, "overview-pipeline");
  await assertBelow(workspace, pipeline, "overview-pipeline below control plane");
  // The panel edge is an inset ring (no border box), so the journey starts 1px earlier and is 2px wider.
  await assertRect(page.getByTestId("overview-journey"), { x: 308, width: 1073, fluid: 1, height: 216 }, "overview-journey");
  const journey = await rect(page.getByTestId("overview-journey"));
  const canvas = page.getByTestId("overview-journey-connectors");
  await expect(canvas).toHaveAttribute("viewBox", "0 0 1054.1 200");
  await expect(canvas).toHaveAttribute("preserveAspectRatio", "none");
  await expect(canvas.locator("path")).toHaveCount(8);

  const prepare = await rect(page.getByTestId("overview-group-prepare"));
  const testGroup = await rect(page.getByTestId("overview-group-test"));
  const measure = await rect(page.getByTestId("overview-group-measure"));
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
  // Iconoir SVG'lerinde Journey state rengi currentColor/stroke üzerinden taşınır.
  // Tamamlanan aşama nötrdür (--muted-foreground); marka yalnız sıradaki adımda.
  expect(await chunkGlyph.evaluate((element) => getComputedStyle(element).color)).toBe(theme === "dark" ? "rgb(146, 137, 142)" : "rgb(96, 87, 92)");
  const evaluation = nodeGeometry.at(-1);
  expect(evaluation).toBeDefined();
  expect(evaluation!.x + evaluation!.width / 2).toBeGreaterThanOrEqual(measure.x);
  expect(evaluation!.x + evaluation!.width / 2).toBeLessThanOrEqual(measure.x + measure.width);
  // "How it works" lives in the PageHeader help slot, under the title block.
  const learningNote = page.getByTestId("overview-learning-note");
  await assertRect(learningNote, { x: 288 }, "overview-learning-note");
  const headerRect = await rect(header);
  const noteRect = await rect(learningNote);
  expect(noteRect.y + noteRect.height, "learning note inside header").toBeLessThanOrEqual(headerRect.y + headerRect.height + 1);
}

async function assertThemeAndLocale(page: Page, state: VisualState) {
  const html = page.locator("html");
  await expect(html).toHaveClass(state.theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
  await expect(html).toHaveCSS("color-scheme", state.theme ?? "light");
  await expect(html).toHaveAttribute("lang", state.locale ?? "en");
}

/** Mobile: drawer navigation, full-width main and the no-overflow contract (content stays reachable). */
async function assertMobileGeometry(page: Page, state: VisualState) {
  const size = state.viewport ?? mobileViewport;
  expect(await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))).toEqual(size);
  await expect(page.getByTestId("app-shell-sidebar")).toBeHidden();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
  await assertRect(page.getByTestId("app-shell-main"), { x: 0, width: await contentWidth(page) }, `${state.key}-main`);
  await expectNoHorizontalOverflow(page, state.key);
}

async function assertRouteGeometry(page: Page, state: VisualState) {
  const stateKey = state.canonicalKey ?? state.key;
  await assertShellGeometry(page);
  const stage = state.group === "parsing" ? "parse" : state.group;
  if (["parse", "chunking", "embeddings"].includes(stage)) {
    const next = page.getByTestId(`${stage}-next-action`);
    const footer = page.getByTestId(`${stage}-next-action-footer`);
    await expect(footer.locator(`[data-testid="${stage}-next-action"]`)).toHaveCount(1);
    if (["chunking-config", "embeddings-ready"].includes(stateKey)) {
      // A locked next step stays visible (disabled) with its reason instead of disappearing.
      await expect(next).toBeDisabled();
    } else {
      await expect(next).toBeEnabled();
      const history = page.getByTestId(stage === "parse" ? "parse-history" : stage === "chunking" ? "chunk-history" : "embedding-history");
      const historyRect = await rect(history);
      expect((await rect(footer)).y).toBeGreaterThanOrEqual(historyRect.y + historyRect.height);
    }
  }
  if (stateKey === "overview") {
    await assertOverviewGeometry(page, state.theme ?? "light");
    return;
  }
  if (stateKey === "overview-first-use") {
    await assertRect(page.getByTestId("overview-main"), { x: 248, y: 0, width: (await contentWidth(page)) - 248 }, "overview-main");
    await assertRect(page.getByTestId("overview-page-header"), { x: 288, y: 40, width: 1113, fluid: 1 }, "overview-header");
    const firstUse = page.getByTestId("overview-first-use");
    await assertRect(firstUse, { x: 288, width: 1113, fluid: 1 }, "overview-first-use");
    await expect(page.getByTestId("workspace-control-plane")).toHaveCount(0);
    await expect(firstUse.getByRole("button", { name: "Try a sample PDF" })).toBeVisible();
    await expect(firstUse.getByRole("link", { name: "Add your own PDF" })).toBeVisible();
    expect((await rect(page.getByTestId("overview-pipeline"))).y).toBeGreaterThan((await rect(firstUse)).y + (await rect(firstUse)).height);
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
  await assertRect(page.getByTestId(rootTestId), { x: 248, width: (await contentWidth(page)) - 248 }, `${state.key}-root`);

  if (state.group === "documents") {
    await assertRect(page.getByTestId("documents-page-header"), { x: 288, y: 40, width: 1113, fluid: 1 }, "documents-header");
  } else if (state.group === "parsing") {
    const header = page.getByTestId("parse-page-header");
    const controls = page.getByTestId("parse-workspace-controls");
    await assertRect(header, { x: 288, y: 40, width: 1113, fluid: 1 }, "parse-header");
    // Status and the Parse action live in the header's action slot, right of the title.
    const headerRect = await rect(header);
    const controlsRect = await rect(controls);
    expect(controlsRect.x, "parse controls sit right of the header start").toBeGreaterThan(headerRect.x);
    expect(controlsRect.x + controlsRect.width, "parse controls stay in the header").toBeLessThanOrEqual(headerRect.x + headerRect.width + 1);
    expect(controlsRect.y, "parse controls start inside the header").toBeGreaterThanOrEqual(headerRect.y - 1);
    const statusRect = await rect(page.getByTestId("parse-document-status"));
    expect(statusRect.x, "parse-status starts within the controls").toBeGreaterThanOrEqual(controlsRect.x - 1);
    expect(statusRect.x + statusRect.width, "parse-status stays in the controls").toBeLessThanOrEqual(controlsRect.x + controlsRect.width + 1);
    expect(Math.abs(statusRect.y + statusRect.height / 2 - (controlsRect.y + controlsRect.height / 2)), "parse-status shares the controls row").toBeLessThanOrEqual(1);
    await assertRect(page.getByTestId("parse-result-summary"), { x: 288, width: 1113, fluid: 1 }, "parse-result");
    await assertBelow(header, page.getByTestId("parse-result-summary"), "parse result below header");
  } else if (state.group === "chunking") {
    const header = page.getByTestId("chunking-page-header");
    await assertRect(header, { x: 288, y: 40, width: 1113, fluid: 1 }, "chunking-header");
    await assertInlineStageContext(header, "chunking");
    await assertRect(page.getByTestId("chunking-workspace"), { x: 288, width: 1113, fluid: 1 }, "chunking-workspace");
    await assertBelow(header, page.getByTestId("chunking-workspace"), "chunking workspace below header");
  } else if (state.group === "embeddings") {
    const header = page.getByTestId("embeddings-page-header");
    await assertRect(header, { x: 288, y: 40, width: 1113, fluid: 1 }, "embeddings-header");
    await assertInlineStageContext(header, "embeddings");
    await expect(page.getByTestId("embedding-input")).toHaveCount(0);
    const embeddingWorkspace = page.getByTestId("embeddings-workspace");
    await assertRect(embeddingWorkspace, { x: 288, width: 1113, fluid: 1 }, "embeddings-workspace");
    await assertBelow(header, embeddingWorkspace, "embeddings workspace below header");
    expect((await rect(embeddingWorkspace)).height, `${state.key}-workspace-height`).toBeGreaterThan(stateKey === "embeddings-ready" ? 60 : 110);
    await expect(page.getByTestId("embedding-lineage")).toBeVisible();
    // The action card spans the workspace column (lineage strip + run footer), never past it.
    expect((await rect(page.getByTestId("embedding-action-card"))).width).toBeLessThanOrEqual((await rect(embeddingWorkspace)).width + 1);
    const inputRect = await rect(page.getByTestId("embedding-primary-result"));
    const outputRect = await rect(page.getByTestId("embedding-output-result"));
    // Chunks (left) → model → vectors (right) across the card: output after input, on the same row.
    expect(outputRect.x, "embedding output right of input").toBeGreaterThan(inputRect.x + inputRect.width);
    expect(Math.abs(outputRect.y + outputRect.height / 2 - (inputRect.y + inputRect.height / 2)), "embedding input/output share a row").toBeLessThanOrEqual(4);
  } else if (state.group === "playground") {
    await assertRect(page.getByTestId("pipeline-context-bar"), { x: 248, y: 0, width: (await contentWidth(page)) - 248, height: 49 }, "playground-context-bar");
    await assertRect(page.getByTestId("playground-page-header"), { x: 288, y: 89, width: 1113, fluid: 1 }, "playground-header");
    await assertRect(page.getByTestId("playground-input"), { x: 288, width: 1113, fluid: 1 }, "playground-input");
    await assertBelow(page.getByTestId("playground-page-header"), page.getByTestId("playground-input"), "playground input below header");
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
      await assertRect(page.getByTestId("playground-stage-layout"), { x: 288, width: 1113, fluid: 1 }, "playground-stage-layout");
      await assertRect(page.getByTestId("playground-stage-rail"), { width: 260 }, "playground-stage-rail");
      await assertRect(page.getByTestId("playground-stage-content"), { x: 568, width: 833, fluid: 1 }, "playground-stage-content");
    }
  } else if (state.group === "evaluation") {
    await assertRect(page.getByTestId("pipeline-context-bar"), { x: 248, y: 0, width: (await contentWidth(page)) - 248, height: 49 }, "evaluation-context-bar");
    await assertRect(page.getByTestId("evaluation-page-header"), { x: 288, y: 89, width: 1113, fluid: 1 }, "evaluation-header");
    await assertRect(page.getByTestId("evaluation-workspace-context"), { x: 288, width: 1113, fluid: 1 }, "evaluation-workspace-context");
    await assertBelow(page.getByTestId("evaluation-page-header"), page.getByTestId("evaluation-workspace-context"), "evaluation context below header");
    const panel = page.getByTestId(`evaluation-panel-${stateKey.replace("evaluation-", "")}`);
    await assertRect(panel, { x: 288, width: 1113, fluid: 1 }, `${state.key}-panel`);
    if (stateKey === "evaluation-compare") {
      const cards = page.getByTestId("evaluation-compare-content").locator("article");
      await expect(cards).toHaveCount(2);
      const first = await rect(cards.nth(0));
      const second = await rect(cards.nth(1));
      expect(Math.abs(first.width - second.width), "evaluation compare card widths").toBeLessThanOrEqual(1);
      // A and B share one panel with a hairline between them: adjacent, never overlapping.
      expect(second.x - first.x, "evaluation compare cards side by side").toBeGreaterThanOrEqual(first.width - 1);
    }
  } else {
    await assertRect(page.getByTestId("settings-page-header"), { x: 288, y: 40, width: 1113, fluid: 1 }, "settings-header");
    await assertRect(page.getByTestId("settings-card"), { x: 288, width: 720 }, "settings-card");
  }
}

/** The few UI strings prepareState clicks or reads, per seeded locale. */
const stateCopy = {
  en: { answer: "Answer", regenerate: "Regenerate answer", copyTrace: "Copy trace" },
  tr: { answer: "Cevap", regenerate: "Cevabı yeniden üret", copyTrace: "İzi kopyala" },
} as const;

async function prepareState(page: Page, state: VisualState) {
  const stateKey = state.canonicalKey ?? state.key;
  const text = stateCopy[state.locale ?? "en"];
  const documentName = state.longNames ? seededStressNames.document : "e2e-seeded-golden.pdf";
  await page.setViewportSize(state.viewport ?? viewport);
  await page.emulateMedia({ colorScheme: state.theme ?? "light", reducedMotion: "reduce" });
  if (stateKey === "overview-first-use") {
    await page.goto(state.route, { waitUntil: "networkidle" });
    await expect(page.getByTestId("overview-first-use")).toBeVisible();
    return;
  }
  await page.goto("/parse", { waitUntil: "networkidle" });
  await selectSeededDocument(page, documentName);
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
    await page.getByTestId("experiment-stage-trace").getByRole("button", { name: new RegExp(`^${text.answer}\\b`) }).click();
    await expect(page.getByTestId("playground-stage-content").getByRole("heading", { name: text.answer, level: 2 })).toBeVisible();
    await expect(page.getByTestId("playground-current-actions").getByRole("button", { name: text.regenerate, exact: true })).toBeVisible();
    await expect(page.getByTestId("playground-current-actions").getByRole("button", { name: text.copyTrace, exact: true })).toBeVisible();
  } else if (stateKey === "evaluation-dataset") {
    // A seeded dataset makes Results the default tab; the dataset state is one click away.
    await page.getByTestId("evaluation-tab-dataset").click();
  } else if (stateKey === "evaluation-results") {
    await expect(page.getByTestId("evaluation-tab-results")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("evaluation-panel-results")).toBeVisible();
    await expect(page.getByText("Hit@K", { exact: true }).first()).toBeVisible();
  } else if (stateKey === "evaluation-compare") {
    await page.getByTestId("evaluation-tab-compare").click();
    const history = page.getByTestId("evaluation-history");
    await expect(history).toBeVisible();
    // Fewer than two selected runs: the history starts open.
    await expect(history).toHaveAttribute("open", "");
    const checks = history.locator('input[type="checkbox"]');
    await expect(checks).toHaveCount(2);
    await checks.nth(0).check();
    await checks.nth(1).check();
    await expect(page.getByTestId("evaluation-compare-content")).toBeVisible();
    await expect(page.getByTestId("evaluation-compare-run-a")).toBeVisible();
    await expect(page.getByTestId("evaluation-compare-run-b")).toBeVisible();
    await expect(page.getByTestId("evaluation-compare-context")).toContainText("Changed settings");
  }

  if (stateKey === "playground-empty") {
    // Full lineage with an empty question is the ready state, not a blocker.
    await expect(page.getByTestId("playground-blocker")).toHaveCount(0);
    await expect(page.getByTestId("experiment-stage-trace")).toHaveCount(0);
  } else if (stateKey === "playground-retrieval") {
    await expect(page.getByTestId("experiment-stage-trace")).toBeVisible();
    await expect(page.getByTestId("playground-stage-content")).toContainText("ORBIT-731");
    await expect(page.getByTestId("playground-current-actions").getByRole("button", { name: "Run next stage", exact: true })).toBeVisible();
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
    await expect(page.getByTestId("embedding-result-details")).toHaveCount(0);
  } else if (stateKey === "embeddings-result") {
    await expect(page.getByTestId("embedding-result-details")).toBeVisible();
    await expect(page.getByTestId("embedding-lineage")).toContainText("dimensions");
  } else if (stateKey === "documents-populated") {
    await expect(page.getByTestId("document-library")).toBeVisible();
    await expect(page.getByRole("button", { name: documentName }).first()).toBeVisible();
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
  const contract = visualContract;
  const size = state.viewport ?? viewport;
  // Only the account name is dynamic; the user row itself stays visible. The mask
  // uses the sidebar card colour so the sidebar reads full-height in both themes.
  const dynamicMask = page.locator('[data-testid="app-shell-user-name"]:visible');

  await mkdir(artifactDirectory, { recursive: true });
  const screenshot = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    mask: state.group === "auth" ? [] : [dynamicMask],
    maskColor: state.theme === "dark" ? "#201b1e" : "#ffffff",
    path: actualPath,
    style: hiddenHostChrome,
  });
  expect(screenshot.readUInt32BE(16), `${state.key} screenshot width`).toBe(size.width);
  expect(screenshot.readUInt32BE(20), `${state.key} screenshot height`).toBe(size.height);

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
  // Referans üretiminde bir durumdaki sapma diğer durumların referansını engellemesin.
  test.describe.configure({ mode: updateReferences ? "default" : "serial" });

  for (const state of [...visualStates, ...darkVisualStates, ...turkishVisualStates]) {
    test(`${state.key} real React state preserves geometry and visual contract`, async ({ page }) => {
      await installSeededApi(page, { scenario: state.scenario, theme: state.theme ?? "light", locale: state.locale ?? "en" });
      await prepareState(page, state);
      await settle(page);
      await assertThemeAndLocale(page, state);
      await assertRouteGeometry(page, state);
      await captureAndCompare(page, state);
    });
  }
});

test.describe("mobile production React visual contracts", () => {
  test.describe.configure({ mode: updateReferences ? "default" : "serial" });

  for (const state of mobileVisualStates) {
    test(`${state.key} real React state has no horizontal overflow and keeps its visual contract`, async ({ page }) => {
      await installSeededApi(page, { scenario: state.scenario, theme: state.theme ?? "light", longNames: state.longNames });
      await prepareState(page, state);
      await settle(page);
      await assertThemeAndLocale(page, state);
      await assertMobileGeometry(page, state);
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

  test.describe("authenticated reset-password form", () => {
    // Reset route requires the authenticated recovery session; keep its guard intact.
    test.use({ storageState: "output/playwright/.auth/user.json" });
    for (const state of [
      { key: "auth-reset-mobile-light-tr", viewport: { width: 390, height: 844 }, locale: "tr", theme: "light" },
      { key: "auth-reset-desktop-dark-en", viewport, locale: "en", theme: "dark" },
    ] as const) {
      test(`${state.key} preserves reset form geometry`, async ({ page }) => {
        const labels = state.locale === "tr"
          ? { form: "Şifre yenileme formu", title: "Yeni şifre oluştur", password: "Yeni şifre", submit: "Şifreyi güncelle" }
          : { form: "Password reset form", title: "Create a new password", password: "New password", submit: "Update password" };

        await page.setViewportSize(state.viewport);
        await page.emulateMedia({ colorScheme: state.theme, reducedMotion: "reduce" });
        await installSeededApi(page, { scenario: "fresh", locale: state.locale, theme: state.theme });
        await page.goto("/auth/reset-password", { waitUntil: "networkidle" });

        const html = page.locator("html");
        await expect(html).toHaveAttribute("lang", state.locale);
        await expect(html).toHaveClass(state.theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
        await expect(html).toHaveCSS("color-scheme", state.theme);
        await expect(page.getByRole("heading", { name: labels.title, level: 1 })).toBeVisible();

        const form = page.getByRole("region", { name: labels.form });
        const password = page.getByLabel(labels.password, { exact: true });
        const confirmation = page.locator("#reset-password-confirmation");
        const submit = page.getByRole("button", { name: labels.submit });
        // The split auth layout: the form column (<main>) is the card that must fit the viewport.
        const cardBounds = await rect(page.locator("main"));
        const formBounds = await rect(form);
        const passwordBounds = await rect(password);
        const submitBounds = await rect(submit);
        const headingBounds = await rect(page.getByRole("heading", { name: labels.title, level: 1 }));
        const confirmationBounds = await rect(confirmation);
        const minimumControlWidth = state.viewport.width < 768 ? 300 : 350;

        expect(cardBounds.x).toBeGreaterThanOrEqual(0);
        expect(cardBounds.x + cardBounds.width).toBeLessThanOrEqual(state.viewport.width);
        expect(passwordBounds.width).toBeGreaterThanOrEqual(minimumControlWidth);
        expect(Math.abs(passwordBounds.x - formBounds.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(passwordBounds.width - formBounds.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(submitBounds.x - formBounds.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(submitBounds.width - formBounds.width)).toBeLessThanOrEqual(1);
        expect(passwordBounds.y).toBeGreaterThan(headingBounds.y + headingBounds.height);
        expect(confirmationBounds.y).toBeGreaterThan(passwordBounds.y + passwordBounds.height);
        expect(submitBounds.y - (confirmationBounds.y + confirmationBounds.height)).toBeGreaterThanOrEqual(23);
        expect(submitBounds.y + submitBounds.height).toBeLessThanOrEqual(state.viewport.height);
        await expect(html).toHaveJSProperty("scrollWidth", await contentWidth(page));

        await settle(page);
        await mkdir(artifactDirectory, { recursive: true });
        await page.screenshot({ animations: "disabled", caret: "hide", path: path.join(artifactDirectory, `${state.key}.png`) });
      });
    }
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
