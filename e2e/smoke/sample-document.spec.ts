import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { SAMPLE_DOCUMENTS } from "../../lib/sample-documents";
import { installBrowserQualityGuards } from "../support/browser-quality";
import { generatedFixturePath } from "../support/fixture-path";
import { installSeededApi } from "../support/seeded-api";

for (const locale of ["tr", "en"] as const) {
  test(`${locale}: first-use sample uploads shipped bytes and requires explicit parsing`, async ({ page }) => {
    const quality = installBrowserQualityGuards(page);
    const api = await installSeededApi(page, { scenario: "fresh", locale, sampleUpload: true });
    const sample = SAMPLE_DOCUMENTS[locale];
    const shippedBytes = await readFile(path.join(process.cwd(), "public", sample.path));

    await page.goto("/");
    const firstUse = page.getByTestId("overview-first-use");
    await expect(firstUse).toBeVisible();
    const sampleButton = firstUse.getByTestId("sample-document-button");
    await expect(sampleButton).toHaveText(locale === "tr" ? "Örnek PDF ile dene" : "Try a sample PDF");
    await sampleButton.click();

    await expect(page.getByTestId("overview-document-selector")).toContainText(sample.fileName);
    await expect(firstUse).toHaveCount(0);
    expect(api.uploads).toHaveLength(1);
    expect(api.uploads[0]).toMatchObject({ fileName: sample.fileName, mediaType: "application/pdf", sha256: sample.sha256 });
    expect(api.uploads[0].bytes.equals(shippedBytes)).toBe(true);
    expect(createHash("sha256").update(shippedBytes).digest("hex")).toBe(sample.sha256);
    expect(api.parseRequests).toEqual([]);

    const continueAction = page.getByTestId("overview-continue-action");
    await expect(continueAction).toHaveAttribute("href", "/parse");
    await continueAction.click();
    await expect(page).toHaveURL(/\/parse$/);
    await expect(page.getByTestId("pipeline-context-document-selector")).toContainText(sample.fileName);
    await expect(page.getByTestId("parse-result-summary")).toHaveCount(0);
    await expect(page.getByTestId("parse-run-action")).toBeEnabled();
    await expect(page.getByTestId("parse-run-action")).toHaveText(locale === "tr" ? "Ayrıştır" : "Parse");
    // Chunking stays visible but locked until this document is parsed.
    await expect(page.getByTestId("parse-next-action")).toBeDisabled();
    expect(api.parseRequests).toEqual([]);

    // Nothing parsed yet: the empty state carries the primary Parse action.
    await page.getByTestId("parse-empty-action").click();
    await expect(page.getByTestId("parse-result-summary")).toBeVisible();
    expect(api.parseRequests).toEqual(["e2e-uploaded-1"]);

    await page.locator('nav a[href="/playground"]').click();
    const questions = page.getByTestId("sample-questions");
    await expect(questions).toBeVisible();
    for (const question of sample.questions) await expect(questions.getByRole("button", { name: question, exact: true })).toBeVisible();
    await questions.getByRole("button", { name: sample.questions[0], exact: true }).click();
    await expect(page.getByTestId("playground-question")).toHaveValue(sample.questions[0]);

    // Upload a different PDF under the exact same filename: name must not identify a sample.
    await page.getByRole("link", { name: locale === "tr" ? "Dokümanlar" : "Documents", exact: true }).click();
    const libraryDocuments = page.locator('button[aria-pressed][aria-label*="' + sample.fileName + '"]:visible');
    await expect(libraryDocuments).toHaveCount(1);
    await expect(libraryDocuments).toHaveAttribute("aria-pressed", "true");
    const differentBytes = await readFile(generatedFixturePath);
    await page.locator('input[type="file"]').setInputFiles({ name: sample.fileName, mimeType: "application/pdf", buffer: differentBytes });
    await expect.poll(() => api.uploads.length).toBe(2);
    await expect(page.getByTestId("pdf-drop-zone")).toHaveAttribute("aria-busy", "false");
    await expect(libraryDocuments).toHaveCount(2);
    await expect(libraryDocuments.first()).toHaveAttribute("aria-pressed", "true");
    expect(api.uploads[1].sha256).not.toBe(sample.sha256);
    await page.locator('nav a[href="/playground"]').click();
    await expect(page.getByTestId("pipeline-context-document-selector")).toContainText(sample.fileName);
    await expect(questions).toHaveCount(0);

    await page.getByTestId("pipeline-context-document-selector").click();
    await page.getByRole("option", { name: sample.fileName, exact: true }).last().click();
    await expect(questions).toBeVisible();
    await expect(questions.getByRole("button", { name: sample.questions[0], exact: true })).toBeVisible();
    expect(api.parseRequests).toEqual(["e2e-uploaded-1"]);
    quality.assertClean();
  });
}
