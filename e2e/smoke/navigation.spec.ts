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
  const mobileLibrary = page.getByTestId("document-library-mobile");
  await expect(mobileLibrary).toBeVisible();
  await expect(page.getByTestId("document-library-table")).toBeHidden();
  const mobileDocument = page.getByTestId("document-library-mobile-item").first();
  await expect(mobileDocument).toBeVisible();
  await expect(mobileDocument.getByRole("button", { name: "Select document: e2e-seeded-golden.pdf" })).toBeVisible();
  await mobileDocument.locator("summary").click();
  await expect(mobileDocument.getByRole("link", { name: "Open parsed content" })).toBeVisible();
  await mobileDocument.locator("summary").click();
  await page.screenshot({ path: "output/playwright/responsive-shell/documents-390.png", fullPage: true });

  await page.goto("/settings");
  const languageDescription = page.getByText("Interface language.");
  const languageControl = page.getByRole("radiogroup", { name: "Language" });
  const descriptionBox = await languageDescription.boundingBox();
  const languageControlBox = await languageControl.boundingBox();
  expect(descriptionBox).not.toBeNull();
  expect(languageControlBox).not.toBeNull();
  expect(languageControlBox!.y).toBeGreaterThanOrEqual(descriptionBox!.y + descriptionBox!.height);

  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    // Taşma yok: içerik genişliği, ayrılmış scrollbar gutter'ı hariç görünür genişliği aşmaz.
    const layoutWidth = await page.evaluate(() => Math.round(document.body.getBoundingClientRect().width));
    expect(layoutWidth).toBeLessThanOrEqual(width);
    await expect(page.locator("html")).toHaveJSProperty("scrollWidth", layoutWidth);
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", layoutWidth);

    const openNavigation = page.getByRole("button", { name: "Open navigation" });
    await openNavigation.click();
    const mobileDialog = page.getByRole("dialog", { name: "Primary navigation" });
    await expect(mobileDialog).toBeVisible();
    await expect(mobileDialog.getByRole("button", { name: "Close" })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(mobileDialog).toHaveCount(0);
    await expect(openNavigation).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  }

  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();

  quality.assertClean();
});
