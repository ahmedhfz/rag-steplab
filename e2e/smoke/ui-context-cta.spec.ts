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

test("UI context and CTA remain reachable without horizontal overflow at supported widths", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);
  await installSeededApi(page, { longNames: true, scenario: "complete" });

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/parse", { waitUntil: "networkidle" });
    if (viewport === viewports[0]) await selectSeededDocument(page, seededStressNames.document);

    await page.goto("/", { waitUntil: "networkidle" });
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
      await page.goto(route, { waitUntil: "networkidle" });
      await assertStageContext(page);
      await assertNoHorizontalOverflow(page);
    }
  }

  quality.assertClean();
});
