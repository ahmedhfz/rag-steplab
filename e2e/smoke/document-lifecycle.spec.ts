import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { installBrowserQualityGuards } from "../support/browser-quality";
import { generatedFixturePath } from "../support/fixture-path";
import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

async function dropFile(page: import("@playwright/test").Page, name: string, mimeType: string, contents: Buffer) {
  await expect(page.getByTestId("pdf-drop-zone")).toBeVisible();
  await page.getByTestId("pdf-drop-zone").evaluate((element, file) => {
    const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
    element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, { name, mimeType, base64: contents.toString("base64") });
}

test.beforeEach(async ({ page }) => {
  await installSeededApi(page);
});

test("@critical click upload, drag/drop ve duplicate reuse notice birlikte çalışır", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);
  const pdf = await readFile(generatedFixturePath);

  await page.goto("/documents");
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByTestId("pdf-drop-zone").click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("not a pdf") });
  await expect(page.getByRole("alert").filter({ hasText: "Only PDF files are supported" })).toBeVisible();

  await dropFile(page, "e2e-seeded-golden.pdf", "application/pdf", pdf);
  await expect(page.getByRole("status")).toContainText("Existing document reused");

  quality.assertClean();
});

test("@critical document library deletes a document only after explicit confirmation", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/documents");
  await expect(page.getByRole("button", { name: "Delete: e2e-seeded-golden.pdf" })).toBeVisible();
  await page.getByRole("button", { name: "Delete: e2e-seeded-golden.pdf" }).click();
  const dialog = page.getByTestId("delete-document-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("e2e-seeded-golden.pdf");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No documents yet.")).toBeVisible();

  quality.assertClean();
});

test("@critical parse lifecycle gerçek UI progress, phase ve elapsed durumlarını gösterir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/parse");
  await selectSeededDocument(page);
  await page.getByRole("button", { name: "Parse again" }).click();
  await expect(page.getByRole("progressbar", { name: /Progress 0%/ })).toBeVisible();
  await expect(page.getByText("Reading document", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("progressbar", { name: /Progress 100%/ })).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Elapsed", { exact: true })).toBeVisible();

  quality.assertClean();
});

test("@critical chunk ve embedding UI yalnız ilgili katmanın seeded contractını kullanır", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/chunking");
  await selectSeededDocument(page);
  await expect(page.getByRole("heading", { name: "Chunking", level: 1, exact: true })).toBeVisible();
  await expect(page.getByText("ORBIT-731", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Run chunking" }).click();
  await expect(page.getByTestId("chunk-reuse-notice")).toBeVisible();

  await page.goto("/embeddings");
  await page.getByRole("button", { name: "Create embeddings" }).click();
  await expect(page.getByRole("status")).toContainText("1 chunks are being embedded. Individual chunk progress is not available.");
  await page.getByTestId("embedding-details").locator("summary").click();
  await expect(page.getByText("gemini-embedding-2", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("768", { exact: true }).first()).toBeVisible();

  quality.assertClean();
});
