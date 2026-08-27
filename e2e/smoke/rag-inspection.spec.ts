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
  await expect(page.getByTestId("pipeline-context-bar")).toContainText("e2e-seeded-golden.pdf");
  await expect(page.getByTestId("pipeline-context-bar")).toContainText("Seeded indexing pipeline");
  await expect(page.getByLabel("Indexing lineage")).toContainText("Embedding");
  await expect(page.getByTestId("playground-draft-configuration")).toContainText("Draft configuration");
  await expect(page.getByRole("button", { name: "Hybrid", exact: true })).toHaveAttribute("aria-pressed", "true");
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

  await page.getByRole("button", { name: /Answer/ }).click();
  await expect(page.getByText("Citation reference valid", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "S1" }).click();
  await expect(page.getByRole("dialog", { name: "Source inspector" })).toContainText("laboratory beacon code is ORBIT-731");

  quality.assertClean();
});

test("Evaluation source picker, aggregate metrics, case diagnostics ve reload persistence gösterir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/evaluation");
  await selectSeededDocument(page);
  const workspaceContext = page.getByTestId("evaluation-workspace-context");
  await expect(workspaceContext).toContainText("e2e-seeded-golden.pdf");
  await expect(workspaceContext).toContainText("Seeded indexing pipeline");
  await expect(workspaceContext).toContainText("e2e-seeded-golden-dataset");
  await expect(page.getByTestId("evaluation-config-summary")).toContainText("Hybrid");
  await expect(page.getByLabel("Select from parsed source elements")).toBeVisible();
  await expect(page.getByText("element-fact", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByTestId("evaluation-results-config")).toContainText("Hybrid");
  await expect(page.getByTestId("evaluation-retrieval-metrics")).toBeVisible();
  await expect(page.getByTestId("evaluation-answer-metrics")).toBeVisible();
  await expect(page.getByTestId("evaluation-answer-metrics")).toContainText("Abstention accuracy");
  await expect(page.getByText("Hit@K", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/What is the laboratory beacon code\?/).first()).toBeVisible();
  await expect(page.getByText(/What is the launch code\?/).first()).toBeVisible();
  await expect(page.getByText("correct abstention", { exact: true })).toBeVisible();
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByText(/What is the laboratory beacon code\?/).first()).toBeVisible();
  await expect(page.getByText("correct abstention", { exact: true })).toBeVisible();

  quality.assertClean();
});

test("Evaluation dataset normal cevap ve yetersiz bağlam case'lerini ayrı kontratlarla gönderir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/evaluation");
  await selectSeededDocument(page);
  await page.getByLabel("Dataset name").fill("Mixed outcome dataset");
  await page.getByLabel("Golden question").fill("What is the laboratory beacon code?");
  await page.getByTestId("source-picker-relevant-elements").getByRole("button", { name: /Golden fact: The laboratory/ }).click();
  await page.getByRole("button", { name: "Add case" }).click();
  await page.getByLabel("Golden question").nth(1).fill("What is the launch code?");
  await page.getByRole("combobox", { name: "Expected outcome" }).nth(1).click();
  await page.getByRole("option", { name: "Insufficient context / no answer" }).click();
  await expect(page.getByText("Source evidence is not required.", { exact: true })).toBeVisible();

  const requestPromise = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/evaluation/datasets");
  await page.getByRole("button", { name: "Create dataset" }).click();
  const request = await requestPromise;
  const payload = request.postDataJSON() as { cases: Array<{ expectedOutcome: string; relevantElementIds: string[] }> };
  expect(payload.cases).toHaveLength(2);
  expect(payload.cases[0]).toMatchObject({ expectedOutcome: "answer", relevantElementIds: ["element-fact"] });
  expect(payload.cases[1]).toMatchObject({ expectedOutcome: "insufficient_context", relevantElementIds: [] });

  quality.assertClean();
});

test("Evaluation compare gerçek run bağlamını ve değişen ayarları gösterir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await installSeededApi(page, { scenario: "evaluation-compare" });
  await page.goto("/evaluation");
  await selectSeededDocument(page);
  await page.getByRole("tab", { name: "Compare" }).click();

  const history = page.getByTestId("evaluation-history");
  await history.locator("summary").click();
  const checks = history.getByRole("checkbox");
  await expect(checks).toHaveCount(2);
  await checks.nth(0).check();
  await checks.nth(1).check();

  await expect(page.getByTestId("evaluation-compare-content")).toContainText("Evaluation");
  const compatibility = page.getByTestId("evaluation-compare-context");
  await expect(compatibility).toContainText("Context compatibility");
  await expect(compatibility).toContainText("Only changed");
  await expect(compatibility).toContainText("Changed settings");
  await expect(compatibility).toContainText("Retrieval mode");
  await expect(compatibility).toContainText("Same");
  await expect(compatibility).toContainText("RUN A: Dense");
  await expect(compatibility).toContainText("RUN B: Hybrid");

  quality.assertClean();
});

test("Reranking tablosu ham ordering değerini pozisyon bilgisinden ayırır", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await installSeededApi(page, { scenario: "playground-reranking" });
  await page.goto("/playground");
  await selectSeededDocument(page);
  await page.getByTestId("experiment-stage-trace").getByRole("button", { name: /^Reranking\b/ }).click();

  const content = page.getByTestId("playground-stage-content");
  await expect(content.getByRole("heading", { name: "Reranking", level: 2 })).toBeVisible();
  await expect(content).toContainText("Reranked position");
  await expect(content).toContainText("Original rank");
  await expect(content).not.toContainText("Rerank score");

  quality.assertClean();
});

test("Embedding yokken Keyword çalışabilir, Dense ve Hybrid remediation gösterir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await installSeededApi(page, { scenario: "embeddings-ready" });
  await page.goto("/playground");
  await selectSeededDocument(page);
  await page.getByRole("textbox", { name: "Question" }).fill("What is the laboratory beacon code?");

  const blocker = page.getByTestId("playground-blocker");
  await expect(blocker).toContainText("Dense and hybrid retrieval require embeddings");
  await expect(blocker.getByRole("link", { name: "Go to Embeddings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run experiment" })).toBeDisabled();

  await page.getByRole("button", { name: "Keyword", exact: true }).click();
  await expect(blocker).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run experiment" })).toBeEnabled();

  quality.assertClean();
});

test("Geçmiş experiment yüklemek aktif indexing pipeline'ı değiştirmez", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/playground");
  await selectSeededDocument(page);
  const pipelineSelector = page.getByRole("combobox", { name: "Indexing pipeline" });
  await expect(pipelineSelector).toContainText("Seeded indexing pipeline");
  await page.getByTestId("playground-stage-rail").getByRole("button", { name: "Load Experiment 1" }).click();
  await expect(page.getByTestId("playground-run-state")).toContainText("Viewing experiment");
  await expect(pipelineSelector).toContainText("Seeded indexing pipeline");

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
