import { expect, test } from "@playwright/test";

import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

for (const locale of ["tr", "en"] as const) {
  test(`@critical Dark/System-dark tema ve ${locale} dili ilk paint öncesi root'a uygulanır`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript((storedLocale) => {
      window.localStorage.setItem("rag-steplab.preferences.v3", JSON.stringify({ locale: storedLocale, showLearningHints: true, theme: "system" }));
    }, locale);
    // React bundle'ı yok: yalnız inline bootstrap script'leri çalışır.
    await page.route(/\/_next\/static\/.*\.js(?:\?.*)?$/, (route) => route.abort());

    await page.goto("/settings", { waitUntil: "domcontentloaded" });

    const html = page.locator("html");
    await expect(html).toHaveClass(/\bdark\b/);
    await expect(html).toHaveCSS("color-scheme", "dark");
    await expect(html).toHaveAttribute("lang", locale);
  });
}

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

  // The radio is sr-only (any outline on it is clipped away); keyboard focus must show
  // on the visible segment label instead. Tab from Language lands on the checked theme.
  await page.getByRole("radio", { name: "English" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeFocused();
  const indicator = await page.locator('label[for="theme-dark"]').evaluate((label) => {
    const style = getComputedStyle(label);
    const box = label.getBoundingClientRect();
    return { outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), outlineColor: style.outlineColor, width: box.width, height: box.height };
  });
  expect(indicator.outlineStyle).toBe("solid");
  expect(indicator.outlineWidth).toBeGreaterThanOrEqual(2);
  expect(indicator.outlineColor).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  expect(indicator.width, "focus indicator sits on a visible box").toBeGreaterThan(24);
  expect(indicator.height, "focus indicator sits on a visible box").toBeGreaterThan(16);
  await page.keyboard.press("Tab");
  expect(await page.locator('label[for="theme-dark"]').evaluate((label) => getComputedStyle(label).outlineStyle)).toBe("none");

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem("rag-steplab.preferences.v3") ?? "{}"));
  expect(stored).toMatchObject({ locale: "en", showLearningHints: true, theme: "dark" });
});

test("@critical Dark shell ikonları tema rengini ve Iconoir SVG’yi kullanır", async ({ page }) => {
  await installSeededApi(page, { theme: "dark" });
  await page.goto("/settings");

  const documentsLink = page.getByRole("link", { name: "Documents", exact: true });
  const appIcon = documentsLink.locator("svg[aria-hidden='true']");
  await expect(appIcon).toHaveCount(1);
  await expect(appIcon).toHaveCSS("color", "rgb(146, 137, 142)");
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
