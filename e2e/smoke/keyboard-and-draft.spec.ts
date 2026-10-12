import { expect, test } from "@playwright/test";
import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

test("@critical desktop parse summary and strategy keyboard navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1441, height: 1041 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installSeededApi(page);
  await page.goto("/parse");
  await selectSeededDocument(page);
  // The summary is already on screen; there is no "View results" scroll button any more.
  await expect(page.getByTestId("parse-result-summary")).toBeVisible();
  await expect(page.getByTestId("parse-reports-action")).toHaveCount(0);
  await page.goto("/chunking");
  const radios = page.getByRole("radiogroup").getByRole("radio");
  const selected = page.getByRole("radio", { checked: true });
  // Native radios (SegmentedControl) carry the strategy in `value`, not in text content.
  const before = await selected.getAttribute("value");
  await selected.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { checked: true })).toBeFocused();
  await expect(page.getByRole("radio", { checked: true })).not.toHaveAttribute("value", before!);
  expect(await radios.evaluateAll((items) => items.filter((item) => (item as HTMLElement).tabIndex === 0).length)).toBe(1);
});

test("@critical desktop saved Playground draft and clipboard feedback", async ({ page }) => {
  await page.setViewportSize({ width: 1441, height: 1041 });
  await installSeededApi(page);
  await page.goto("/playground");
  await selectSeededDocument(page);
  const question = page.getByTestId("playground-question");
  await expect(question).not.toHaveValue("");
  await expect(page.getByTestId("playground-run-state")).toHaveCount(0);
  await question.fill("My edited question");
  await expect(page.getByTestId("playground-run-state")).toContainText("Settings changed");
  await page.getByTestId("playground-history").locator("summary").click();
  await page.getByRole("button", { name: /^Load Experiment/ }).first().click();
  await expect(question).not.toHaveValue("My edited question");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => undefined } }));
  await page.getByRole("button", { name: "Copy trace" }).click();
  await expect(page.getByText("Trace copied.", { exact: true })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.getByRole("button", { name: "Copy trace" }).click();
  await expect(page.getByText("Copy failed. Try again.", { exact: true })).toBeVisible();
});
