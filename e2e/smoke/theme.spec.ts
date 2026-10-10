import { expect, test } from "@playwright/test";

import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

test("@critical Dark ve System-dark ilk paint öncesi root temasını uygular", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    window.localStorage.setItem("rag-steplab.preferences.v3", JSON.stringify({ locale: "en", showLearningHints: true, theme: "system" }));
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, (route) => route.abort());

  await page.goto("/settings", { waitUntil: "domcontentloaded" });

  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
});

test("@critical tema tercihi kalıcıdır ve System canlı OS değişimini izler", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await installSeededApi(page, { scenario: "settings", theme: "system" });
  await page.goto("/settings");

  await expect(page.getByLabel("System")).toBeChecked();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await page.getByText("Light", { exact: true }).click();
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.getByLabel("Light")).toBeChecked();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");

  await page.getByText("Dark", { exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await page.getByLabel("Dark").focus();
  expect(await page.getByLabel("Dark").evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("rag-steplab.preferences.v3") ?? "{}"));
  expect(stored).toMatchObject({ locale: "en", showLearningHints: true, theme: "dark" });
});

test("@critical Dark shell ikonları tema rengini ve Iconoir SVG’yi kullanır", async ({ page }) => {
  await installSeededApi(page, { theme: "dark" });
  await page.goto("/settings");

  const documentsLink = page.getByRole("link", { name: "Documents", exact: true });
  const appIcon = documentsLink.locator("svg[aria-hidden='true']");
  await expect(appIcon).toHaveCount(1);
  await expect(appIcon).toHaveCSS("color", "rgb(176, 167, 171)");
  await expect(documentsLink.locator("img")).toHaveCount(0);
});

test("Dark kaynak portalı arka planı karartır ve klavye odağını korur", async ({ page }) => {
  await installSeededApi(page, { scenario: "playground-retrieval", theme: "dark" });
  await page.goto("/playground");
  await selectSeededDocument(page);
  const trigger = page.getByRole("button", { name: "Inspect source" }).first();
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Source inspector" })).toBeVisible();
  const overlay = page.getByTestId("source-inspector-overlay");
  const color = await overlay.evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(color).toMatch(/(?:0 0 0|0, 0, 0)/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
