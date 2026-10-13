import { expect, test } from "@playwright/test";

import { installBrowserQualityGuards } from "../support/browser-quality";
import { expectNoHorizontalOverflow } from "../support/overflow";
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
  await expect(page.getByRole("button", { name: "Regenerate answer" })).toBeEnabled();

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
  await expectNoHorizontalOverflow(page, "documents at 390px");
  await page.screenshot({ path: "output/playwright/responsive-shell/documents-390.png", fullPage: true });

  await page.goto("/settings");
  // The row title is the anchor; the redundant "Interface language." description is gone.
  const languageDescription = page.getByTestId("settings-language-row").getByRole("heading", { name: "Language", level: 2 });
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
    // Screen roots no longer clip: nothing may spill out of, or be cut off inside, its box.
    await expectNoHorizontalOverflow(page, `settings at ${width}px`);

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

test("bilinmeyen rota uygulama kabuğunda markalı 404 gösterir ve Overview'a döner", async ({ page }) => {
  const response = await page.goto("/this-route-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
  await expect(page.getByTestId("app-shell-sidebar")).toBeVisible();
  await expect(page).toHaveTitle("Page not found · RAG StepLab");

  await page.getByTestId("route-fallback-overview-link").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Build your RAG, one step at a time.", level: 1 })).toBeVisible();
});
