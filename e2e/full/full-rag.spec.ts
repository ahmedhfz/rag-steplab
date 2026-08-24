import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { requireE2ECredentials, signIn, signOut } from "../support/auth";
import { installBrowserQualityGuards } from "../support/browser-quality";
import { generatedFixturePath } from "../support/fixture-path";

test("tek gerçek Docling + Gemini golden path kalıcı RAG lifecycle'ını doğrular", async ({ page }) => {
  test.setTimeout(25 * 60 * 1_000);
  const quality = installBrowserQualityGuards(page);
  const runId = process.env.E2E_RUN_ID ?? `${Date.now()}`;
  const fileName = `e2e-${runId}-rag-steplab-golden.pdf`;
  const pdf = await readFile(generatedFixturePath);

  await signIn(page, requireE2ECredentials());
  await page.goto("/documents");
  await page.getByRole("button", { name: "Add PDF" }).click();
  await page.getByLabel("Choose PDF").setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page.getByRole("status")).toContainText(/ready to parse|reused/i);
  await page.getByRole("link", { name: "Continue to Parse" }).click();

  // Retry aynı e2e kullanıcısı ve dosya adıyla devam edebilir; bu durumda backend
  // parse'ı zaten tamamlamış olur ve UI yalnızca Reparse aksiyonu gösterir.
  const parseButton = page.getByRole("button", { name: /^Parse$/ });
  if ((await parseButton.count()) > 0 && (await parseButton.isEnabled())) {
    await parseButton.click();
  }
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText(/Queued|Worker started|Docling starting|Source loaded/).first()).toBeVisible();
  await expect(page.getByRole("progressbar", { name: /Progress 100%/ })).toBeVisible({ timeout: 15 * 60 * 1_000 });
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();
  await page.getByRole("link", { name: "Continue to Chunking" }).click();

  await page.getByRole("button", { name: "Create chunks" }).click();
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  await page.goto("/embeddings");
  await page.getByRole("button", { name: "Create embeddings" }).click();
  await expect(page.getByText("gemini-embedding-2", { exact: false }).first()).toBeVisible({ timeout: 2 * 60_000 });

  await page.goto("/playground");
  await page.getByLabel("Question").fill("What is the laboratory beacon code? Answer briefly.");
  await page.getByRole("button", { name: "Run experiment" }).click();
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible({ timeout: 3 * 60_000 });
  await expect(page.getByText("S1", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "S1" }).click();
  await expect(page.getByRole("dialog", { name: "Source inspector" })).toContainText("ORBIT-731");
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/evaluation");
  await page.getByLabel("Dataset name").fill(`e2e-${runId}-golden-dataset`);
  await page.getByLabel("Golden question").fill("What is the laboratory beacon code?");
  await page.getByLabel("Select from parsed source elements").getByRole("button", { name: /ORBIT-731/ }).click();
  await page.getByLabel("Reference answer").fill("ORBIT-731");
  await page.getByRole("button", { name: "Create dataset" }).click();
  await page.getByRole("button", { name: "Run evaluation" }).click();
  await expect(page.getByText("Hit@K", { exact: true }).first()).toBeVisible({ timeout: 5 * 60_000 });
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();

  await page.reload();
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();
  await signOut(page);
  await page.goto("/playground");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);

  quality.assertClean();
});
