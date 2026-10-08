import { expect, test } from "@playwright/test";

import { installSeededApi } from "../support/seeded-api";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`@critical transitions.dev controls preserve state and focus (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await installSeededApi(page);
    await page.goto("/settings");
    await page.getByText("Dark", { exact: true }).click();
    await expect(page.getByLabel("Dark", { exact: true })).toBeChecked();
    const pill = page.getByRole("radiogroup", { name: "Theme" }).locator(".t-tabs-pill");
    await expect(pill).toBeVisible();
    const duration = await pill.evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
    expect(reducedMotion === "reduce" ? duration < 0.001 : duration === 0.25).toBe(true);
    await page.getByRole("switch", { name: "Show learning hints" }).click();
    await expect(page.getByRole("switch", { name: "Show learning hints" })).not.toBeChecked();

    await page.goto("/documents");
    const library = page.getByTestId("document-library-table");
    await library.getByRole("button", { name: /Delete:/ }).first().click();
    const dialog = page.getByTestId("delete-document-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/t-modal/);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(library.getByRole("button", { name: /Delete:/ }).first()).toBeFocused();
  });
}
