import { expect, test } from "@playwright/test";
import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

test("Parse ve chunk kaynak incelemesinde OCR tanısal verileri izlenebilir", async ({ page }) => {
  await installSeededApi(page, { ocrDiagnostics: true });
  await page.goto("/parse");
  await selectSeededDocument(page);
  await expect(page.getByText("Native PDF + OCR text").first()).toBeVisible();
  await page.goto("/playground");
  await page.getByRole("button", { name: "Inspect source" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Source inspector" });
  await dialog.getByText("Native PDF + OCR text", { exact: true }).click();
  await expect(dialog.getByText("OCR confidence (diagnostic score): 0.9906")).toBeVisible();
  await expect(dialog.getByText(/Source region: 1/)).toContainText("TOPLEFT");
  await dialog.getByRole("button", { name: "Inspect on PDF page" }).click();
  await expect(dialog.locator("iframe")).toHaveAttribute("src", /#page=1&view=FitR,30,722,300,742$/);
  await expect(dialog).not.toContainText("99% correct");
});
