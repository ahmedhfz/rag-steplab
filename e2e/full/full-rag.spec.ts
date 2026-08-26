import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { requireE2ECredentials, signIn, signOut } from "../support/auth";
import { installBrowserQualityGuards } from "../support/browser-quality";
import { generatedFixturePath } from "../support/fixture-path";

test("tek gerçek Docling + Gemini golden path kalıcı RAG lifecycle'ını doğrular", async ({ page }) => {
  test.setTimeout(25 * 60 * 1_000);
  const runId = process.env.E2E_RUN_ID ?? `${Date.now()}`;
  const fileName = `e2e-${runId}-rag-steplab-golden.pdf`;
  const pdf = await readFile(generatedFixturePath);

  await signIn(page, requireE2ECredentials());
  await page.goto("/documents");
  await expect(page.getByRole("button", { name: "Add PDF" })).toBeVisible();
  const quality = installBrowserQualityGuards(page);
  await page.getByRole("button", { name: "Add PDF" }).click();
  await page.getByLabel("Choose PDF").setInputFiles({ name: fileName, mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Save document" }).click();
  await expect(page.getByRole("status")).toContainText(/ready to parse|reused/i);
  await page.getByRole("link", { name: "Continue to Parse" }).click();

  // Upload sonrası document detail hydration kısa süre sonra parse aksiyonunu
  // enable eder; retry'da backend checkpoint'i zaten tamamlanmış olabilir.
  const parseButton = page.getByRole("button", { name: /^Parse$/ });
  const completedProgress = page.getByRole("progressbar", { name: /Progress 100%/ });
  await expect.poll(async () => {
    if ((await completedProgress.count()) > 0) return "completed";
    if ((await parseButton.count()) === 0) return "hydrating";
    return (await parseButton.isEnabled()) ? "parse-ready" : "parse-disabled";
  }, { timeout: 60_000, message: "Parse action did not become ready after document hydration." }).toMatch(/^(completed|parse-ready)$/);
  if ((await completedProgress.count()) === 0) {
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
  const createEmbeddingsButton = page.getByRole("button", { name: "Create embeddings" });
  await expect(createEmbeddingsButton).toBeEnabled({ timeout: 60_000 });
  await createEmbeddingsButton.click();
  await expect(page.getByText("gemini-embedding-2", { exact: false }).first()).toBeVisible({ timeout: 2 * 60_000 });

  await page.goto("/playground");
  await page.getByLabel("Question").fill("What is the laboratory beacon code? Answer briefly.");
  await page.getByRole("button", { name: "Run experiment" }).click();
  await expect(page.getByRole("heading", { name: "Grounded answer" })).toBeVisible({ timeout: 3 * 60_000 });
  await expect(page.getByText("C1", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "C1", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Source inspector" })).toContainText("ORBIT-731");
  await page.getByRole("button", { name: "Close" }).click();

  await page.goto("/evaluation");
  await page.getByLabel("Dataset name").fill(`e2e-${runId}-golden-dataset`);
  await page.getByLabel("Golden question").fill("What is the laboratory beacon code?");
  await page.getByLabel("Select from parsed source elements").getByRole("button", { name: /ORBIT-731/ }).click();
  await page.getByLabel("Reference answer").fill("ORBIT-731");
  await page.getByRole("button", { name: "Create dataset" }).click();
  await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByRole("button", { name: "Run evaluation" })).toBeEnabled();
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
