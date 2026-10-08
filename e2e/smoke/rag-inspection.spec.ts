import { expect, test } from "@playwright/test";

import { installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

test.beforeEach(async ({ page }) => {
  await installSeededApi(page);
});

test("@critical Playground stage rail, provenance ve Source Inspector contractını gösterir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/playground");
  await selectSeededDocument(page);
  await expect(page.getByTestId("playground-workspace-context")).toBeVisible();
  await expect(page.getByTestId("pipeline-context-bar")).toContainText("e2e-seeded-golden.pdf");
  await expect(page.getByTestId("pipeline-context-bar")).toContainText("Seeded indexing pipeline");
  await expect(page.getByLabel("Indexing lineage")).toContainText("Embedding");
  await expect(page.getByTestId("playground-draft-configuration")).toHaveCount(0);
  await expect(page.getByTestId("playground-question-help")).toBeVisible();
  await expect(page.getByRole("button", { name: "Hybrid", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Experiment stages")).toBeVisible();
  await expect(page.getByLabel("Experiment stages")).toContainText("Retrieval");
  await expect(page.getByLabel("Experiment stages")).toContainText("Skipped");
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "Inspect source" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Source inspector" });
  await expect(dialog).toBeVisible();
  const evidence = dialog.getByTestId("source-inspector-evidence");
  await expect(evidence).toContainText("Source evidence");
  await expect(evidence).toContainText("Page 1");
  await expect(evidence).toContainText("laboratory beacon code is ORBIT-731");
  await expect(evidence).not.toContainText("Retrieval/Context");
  await expect(dialog.locator("iframe")).toHaveAttribute("src", /#page=1$/);
  await page.getByRole("button", { name: "Close" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Inspect source" }).first().click();
  const mobileDialog = page.getByRole("dialog", { name: "Source inspector" });
  await expect(mobileDialog).toBeVisible();
  const mobileDialogRect = () => mobileDialog.evaluate((element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  await expect.poll(mobileDialogRect).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await expect(mobileDialog.locator("aside")).toBeVisible();
  const evidenceTop = await mobileDialog.getByTestId("source-inspector-evidence").evaluate((element) => element.getBoundingClientRect().top);
  const previewTop = await mobileDialog.getByTestId("source-inspector-preview").evaluate((element) => element.getBoundingClientRect().top);
  expect(evidenceTop).toBeLessThan(previewTop);
  await expect(mobileDialog.locator("details").first()).toBeVisible();
  await page.screenshot({ path: "output/playwright/responsive-shell/source-inspector-390.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(mobileDialog).toHaveCount(0);
  await page.setViewportSize({ width: 1441, height: 1041 });

  await page.getByRole("button", { name: /Answer/ }).click();
  await expect(page.getByText("Reference found", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "S1" }).click();
  await expect(page.getByRole("dialog", { name: "Source inspector" })).toContainText("laboratory beacon code is ORBIT-731");
  await expect(page.getByTestId("playground-screen")).not.toContainText("persisted backend");

  quality.assertClean();
});

test("Evaluation source picker, aggregate metrics, case diagnostics ve reload persistence gösterir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/evaluation");
  await selectSeededDocument(page);
  const pipelineContext = page.getByTestId("pipeline-context-bar");
  const workspaceContext = page.getByTestId("evaluation-workspace-context");
  await expect(pipelineContext).toContainText("e2e-seeded-golden.pdf");
  await expect(pipelineContext).toContainText("Seeded indexing pipeline");
  await expect(workspaceContext).not.toContainText("e2e-seeded-golden.pdf");
  await expect(workspaceContext).not.toContainText("Seeded indexing pipeline");
  await expect(workspaceContext).toContainText("e2e-seeded-golden-dataset");
  await expect(page.getByTestId("evaluation-config-summary")).toContainText("Hybrid");
  await expect(page.getByLabel("Select from parsed source elements")).toBeVisible();
  await expect(page.getByText("element-fact", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByTestId("evaluation-config-summary")).toContainText("Hybrid");
  await expect(page.getByTestId("evaluation-retrieval-metrics")).toBeVisible();
  await expect(page.getByTestId("evaluation-answer-metrics")).toBeVisible();
  await expect(page.getByTestId("evaluation-answer-metrics")).toContainText("Abstention accuracy");
  await expect(page.getByText("Hit@K", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/What is the laboratory beacon code\?/).first()).toBeVisible();
  await expect(page.getByText(/What is the launch code\?/).first()).toBeVisible();
  await expect(page.getByText("Correct no-answer", { exact: true })).toBeVisible();
  await expect(page.getByText("ORBIT-731", { exact: false }).first()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Results" }).click();
  await expect(page.getByText(/What is the laboratory beacon code\?/).first()).toBeVisible();
  await expect(page.getByText("Correct no-answer", { exact: true })).toBeVisible();

  quality.assertClean();
});

test("Evaluation dataset normal cevap ve yetersiz bağlam case'lerini ayrı kontratlarla gönderir", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/evaluation");
  await selectSeededDocument(page);
  await page.getByLabel("Dataset name").fill("Mixed outcome dataset");
  await page.getByLabel("Golden question").fill("What is the laboratory beacon code?");
  const sourceButton = page.getByTestId("source-picker-relevant-elements").getByRole("button", { name: /Golden fact: The laboratory/ });
  await expect(sourceButton).toContainText("Golden fact: The laboratory beacon code is ORBIT-731.");
  await expect(sourceButton).toHaveCSS("font-size", "12px");
  await sourceButton.click();
  await page.getByRole("button", { name: "Add case" }).click();
  await page.getByLabel("Golden question").nth(1).fill("What is the launch code?");
  await page.getByRole("combobox", { name: "Expected result" }).nth(1).click();
  await page.getByRole("option", { name: "Insufficient context" }).click();
  await expect(page.getByText("Source evidence is not required.", { exact: true })).toBeVisible();

  const requestPromise = page.waitForRequest((request) => {
    const pathname = new URL(request.url()).pathname;
    return request.method() === "POST" && pathname.endsWith("/evaluation/datasets");
  });
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
  await expect(content).not.toContainText("confidence");

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
  const history = page.getByTestId("playground-history");
  await history.locator("summary").click();
  await history.getByRole("button", { name: "Load Experiment 1" }).click();
  await expect(page.getByTestId("experiment-stage-trace").getByRole("button", { name: /^Answer/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("playground-stage-content")).toContainText("Answer");
  await expect(page.getByTestId("playground-run-state")).toContainText("Viewing");
  await expect(page.getByTestId("playground-run-state")).toContainText("Exact experiment loaded");
  await expect(page.getByTestId("playground-run-state")).not.toContainText("Unsaved changes");
  await expect(pipelineSelector).toContainText("Seeded indexing pipeline");

  quality.assertClean();
});

test("Playground question CTA geometry and responsive overflow contractını korur", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);
  const viewports = [1440, 1280, 1024, 768, 390];

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/playground");
    await selectSeededDocument(page);

    const dimensions = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }));
    expect(dimensions.bodyScrollWidth, `body overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewportWidth);
    expect(dimensions.documentScrollWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(dimensions.viewportWidth);

    if (width >= 768) {
      const question = await page.getByTestId("playground-question").boundingBox();
      const cta = await page.getByTestId("playground-run-cta").boundingBox();
      expect(question).not.toBeNull();
      expect(cta).not.toBeNull();
      expect(Math.abs((question!.y + question!.height / 2) - (cta!.y + cta!.height / 2)), `CTA center alignment at ${width}px`).toBeLessThanOrEqual(1);
    }
  }

  quality.assertClean();
});

test("chunk teknik kimliği inspector içinde görünür ve global moda bağlanmaz", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);

  await page.goto("/chunking");
  await selectSeededDocument(page);
  await expect(page.getByTestId("chunk-inspector-detail")).toContainText("Chunk ID");
  await expect(page.getByTestId("chunk-inspector-detail")).toContainText("e2e-seeded-chunk-item");
  await expect(page.getByText("Chunk 1", { exact: true })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("radio", { name: "Technical" })).toHaveCount(0);
  await expect(page.getByText("Technical detail", { exact: true })).toHaveCount(0);

  quality.assertClean();
});
