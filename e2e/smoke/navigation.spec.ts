import { expect, test } from "@playwright/test";

import { installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

const routes = [
  ["/", "Build your RAG, one step at a time.", false],
  ["/documents", "Documents", false],
  ["/parse", "Parsing", false],
  ["/chunking", "Chunking", false],
  ["/embeddings", "Embeddings", false],
  ["/playground", "Playground", false],
  ["/evaluation", "Evaluation", false],
  ["/settings", "Settings", false],
] as const;

test.beforeEach(async ({ page }) => {
  await installSeededApi(page);
});

test("authenticated seeded workspace kritik rotaları ve blocker durumlarını açar", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/parse");
  await selectSeededDocument(page);
  for (const [route, heading, hasPipelineContext] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    if (hasPipelineContext) await expect(page.getByTestId("pipeline-context-bar")).toBeVisible();
  }

  await page.goto("/playground");
  await expect(page.getByText("Skipped", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Run generation again" })).toBeEnabled();

  quality.assertClean();
});

test("seeded state reload sonrası korunur ve responsive gezinme çalışır", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/documents");
  await expect(page.getByText("e2e-seeded-golden.pdf").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("e2e-seeded-golden.pdf").first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();

  quality.assertClean();
});
