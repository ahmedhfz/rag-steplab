import { expect, test, type Locator, type Page } from "@playwright/test";

import { installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi, seededStressNames } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

const viewports = [
  { width: 1440, height: 900 },
  { width: 1280, height: 900 },
  { width: 1024, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
] as const;

const journeyViewports = [
  { width: 1439, height: 900 },
  { width: 1440, height: 900 },
  { width: 1441, height: 900 },
  { width: 1536, height: 900 },
  { width: 1600, height: 900 },
  { width: 1920, height: 900 },
] as const;

async function assertNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    html: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.body, "body horizontal overflow").toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.html, "html horizontal overflow").toBeLessThanOrEqual(dimensions.viewport);
}

async function assertSingleLineTrigger(trigger: Locator) {
  const value = trigger.locator("[data-slot='select-value']");
  await expect(value).toBeVisible();
  const metrics = await value.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    return { height: rect.height, lineHeight: styles.lineHeight, whiteSpace: styles.whiteSpace };
  });
  expect(metrics.whiteSpace).toBe("nowrap");
  expect(metrics.height).toBeLessThanOrEqual(24);
}

async function assertOverviewSelectors(page: Page) {
  const documentSelector = page.getByTestId("overview-document-selector");
  const pipelineSelector = page.getByTestId("overview-pipeline-selector");
  await expect(documentSelector).toContainText(seededStressNames.document);
  await expect(pipelineSelector).toContainText(seededStressNames.pipeline);
  await expect(documentSelector).toHaveAttribute("title", seededStressNames.document);
  await expect(pipelineSelector).toHaveAttribute("title", seededStressNames.pipeline);
  await assertSingleLineTrigger(documentSelector);
  await assertSingleLineTrigger(pipelineSelector);
}

async function assertStageContext(page: Page) {
  const context = page.getByTestId("pipeline-context-bar");
  await expect(context).toContainText(seededStressNames.document);
  await expect(context).toContainText(seededStressNames.pipeline);
  await expect(page.getByTestId("pipeline-context-document-selector")).toHaveAttribute("title", seededStressNames.document);
  await expect(page.getByTestId("pipeline-context-pipeline-selector")).toHaveAttribute("title", seededStressNames.pipeline);
  await assertSingleLineTrigger(page.getByTestId("pipeline-context-document-selector"));
  await assertSingleLineTrigger(page.getByTestId("pipeline-context-pipeline-selector"));
}

async function assertCompleteDesktopJourney(page: Page) {
  const canvas = page.getByTestId("overview-journey-connectors");
  const nodes = page.locator('[data-testid^="overview-journey-node-"]');
  const expectedStates = ["Completed", "Completed", "Completed", "Completed", "Completed", "Skipped", "Completed", "Completed", "Completed"];

  await expect(nodes).toHaveCount(9);
  await expect(canvas.locator("path")).toHaveCount(8);
  await expect(page.getByTestId("overview-journey-connector-parse-chunk")).toHaveAttribute("data-state", "Completed");
  await expect(page.getByTestId("overview-journey-glyph-chunk")).toHaveAttribute("data-state", "Completed");

  const nodeStateAndX = await nodes.evaluateAll((elements) => elements.map((element) => ({
    state: element.getAttribute("data-state"),
    x: element.getBoundingClientRect().x,
  })));
  expect(nodeStateAndX.map(({ state }) => state)).toEqual(expectedStates);
  expect(nodeStateAndX.slice(1).every(({ x }, index) => x > nodeStateAndX[index].x)).toBe(true);

  const completedIconColor = await page.getByTestId("overview-journey-glyph-chunk").evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(completedIconColor).toBe("rgb(63, 122, 85)");
  await expect(canvas).toHaveAttribute("viewBox", "0 0 1054.1 199.975");
  await expect(canvas).toHaveAttribute("preserveAspectRatio", "none");
  await expect(canvas.locator("path").first()).toHaveAttribute("vector-effect", "non-scaling-stroke");

  const geometry = await page.evaluate(() => {
    const rectOf = (testId: string) => {
      const element = document.querySelector(`[data-testid="${testId}"]`);
      if (!element) throw new Error(`Missing ${testId}`);
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, center: rect.left + rect.width / 2 };
    };
    return {
      journey: rectOf("overview-journey-desktop"),
      canvas: rectOf("overview-journey-connectors"),
      prepare: rectOf("figma-overview-prepare"),
      test: rectOf("figma-overview-test"),
      measure: rectOf("figma-overview-measure"),
      evaluation: rectOf("overview-journey-node-evaluate"),
    };
  });
  expect(Math.abs(geometry.canvas.width - geometry.journey.width)).toBeLessThanOrEqual(1);
  expect(geometry.prepare.right).toBeLessThanOrEqual(geometry.test.left + 1);
  expect(geometry.test.right).toBeLessThanOrEqual(geometry.measure.left + 1);
  expect(geometry.measure.left).toBeGreaterThan(geometry.test.left);
  expect(geometry.journey.right - geometry.measure.right).toBeLessThanOrEqual(geometry.journey.width * 0.03 + 1);
  expect(geometry.evaluation.center).toBeGreaterThanOrEqual(geometry.measure.left);
  expect(geometry.evaluation.center).toBeLessThanOrEqual(geometry.measure.right);
}

test("UI context and CTA remain reachable without horizontal overflow at supported widths", async ({ page }) => {
  test.setTimeout(90_000);
  // Production Vercel navigations can exceed the shared 20s default during a cold start.
  page.setDefaultNavigationTimeout(60_000);
  const quality = installBrowserQualityGuards(page);
  await installSeededApi(page, { longNames: true, scenario: "complete" });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/parse", { waitUntil: "domcontentloaded" });
    await selectSeededDocument(page, seededStressNames.document);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("continue-surface")).toBeVisible();
    if (viewport.width >= 1440) {
      await expect(page.getByTestId("overview-journey-desktop")).toBeVisible();
      await expect(page.getByTestId("overview-journey-compact")).not.toBeVisible();
    } else {
      await expect(page.getByTestId("overview-journey-compact")).toBeVisible();
      await expect(page.getByTestId("overview-journey-desktop")).not.toBeVisible();
    }
    await assertOverviewSelectors(page);
    await assertNoHorizontalOverflow(page);

    for (const route of ["/parse", "/chunking", "/embeddings"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await assertStageContext(page);
      await assertNoHorizontalOverflow(page);
    }

    for (const route of ["/playground", "/evaluation"]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await assertStageContext(page);
      await assertNoHorizontalOverflow(page);
    }
  }

  quality.assertClean();
});

test("Overview journey keeps state semantics and responsive desktop geometry", async ({ page }) => {
  test.setTimeout(90_000);
  const quality = installBrowserQualityGuards(page);
  await installSeededApi(page, { scenario: "complete" });

  for (const viewport of journeyViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/parse", { waitUntil: "domcontentloaded" });
    await selectSeededDocument(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("continue-surface")).toBeVisible();
    await assertNoHorizontalOverflow(page);

    if (viewport.width < 1440) {
      await expect(page.getByTestId("overview-journey-compact")).toBeVisible();
      await expect(page.getByTestId("overview-journey-desktop")).not.toBeVisible();
    } else {
      await expect(page.getByTestId("overview-journey-desktop")).toBeVisible();
      await expect(page.getByTestId("overview-journey-compact")).not.toBeVisible();
      await assertCompleteDesktopJourney(page);
    }
  }

  quality.assertClean();
});

test("Creating a pipeline resets its lineage and Journey state", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);
  await installSeededApi(page, { scenario: "complete" });
  await page.setViewportSize({ width: 1441, height: 900 });
  await page.goto("/parse", { waitUntil: "domcontentloaded" });
  await selectSeededDocument(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("overview-journey-desktop")).toBeVisible();
  await expect(page.getByTestId("overview-pipeline-selector")).toContainText("Seeded indexing pipeline");

  await page.getByTestId("pipeline-management").locator("summary").click();
  await page.getByRole("button", { name: "New pipeline" }).click();
  await page.getByPlaceholder("Pipeline name").fill("Fresh pipeline");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByTestId("overview-pipeline-selector")).toContainText("Fresh pipeline");
  const states = await page.locator('[data-testid^="overview-journey-node-"]').evaluateAll(
    (elements) => elements.map((element) => element.getAttribute("data-state")),
  );
  expect(states).toEqual(["Completed", "Ready", "Locked", "Locked", "Locked", "Locked", "Locked", "Locked", "Locked"]);
  await expect(page.getByTestId("overview-continue-action")).toHaveAttribute("href", "/parse");
  quality.assertClean();
});
