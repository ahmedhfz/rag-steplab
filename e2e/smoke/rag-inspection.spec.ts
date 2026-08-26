import { expect, test } from "@playwright/test";

import { installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

test.beforeEach(async ({ page }) => {
  await installSeededApi(page);
});

test("Playground stage rail, provenance ve Source Inspector contractını gösterir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/playground");
  await selectSeededDocument(page);
  await expect(page.getByLabel("Experiment stages")).toBeVisible();
  await expect(page.getByLabel("Experiment stages")).toContainText("Retrieval");
  await expect(page.getByLabel("Experiment stages")).toContainText("Skipped");
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "Inspect source" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Source inspector" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Document → Page 1 → Parse element → Chunk → Retrieval/Context → Citation");
  await expect(dialog.locator("iframe")).toHaveAttribute("src", /#page=1$/);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "S1" }).click();
  await expect(page.getByRole("dialog", { name: "Source inspector" })).toContainText("laboratory beacon code is ORBIT-731");

  quality.assertClean();
});

test("Evaluation source picker, aggregate metrics, case diagnostics ve reload persistence gösterir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/evaluation");
  await selectSeededDocument(page);
  await expect(page.getByLabel("Select from parsed source elements")).toBeVisible();
  await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByText("Hit@K", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/What is the laboratory beacon code\?/).first()).toBeVisible();
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByText(/What is the laboratory beacon code\?/).first()).toBeVisible();

  quality.assertClean();
});

test("insan odaklı görünüm teknik kimlikleri global moda bağlamaz", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/chunking");
  await selectSeededDocument(page);
  await expect(page.getByText("e2e-seeded-chunk-item", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Chunk 1", { exact: true })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Technical" })).toHaveCount(0);
  await expect(page.getByText("Technical detail", { exact: true })).toHaveCount(0);

  quality.assertClean();
});
