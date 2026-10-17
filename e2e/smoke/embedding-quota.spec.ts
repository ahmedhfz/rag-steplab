import { expect, test } from "@playwright/test";

import { installBrowserQualityGuards } from "../support/browser-quality";
import { expectNoHorizontalOverflow } from "../support/overflow";
import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

// Production 2026-10-15: a 166-chunk document hit the provider's 100 inputs/minute embedding quota.
test("Büyük doküman embedding kotası için süre uyarısı ve tükenmiş kota için net hata gösterir", async ({ page }, testInfo) => {
  const quality = installBrowserQualityGuards(page);
  await installSeededApi(page, {
    scenario: "embeddings-ready",
    chunkCount: 166,
    embeddingFailure: { code: "gemini_quota_exhausted", message: "Gemini embedding quota exhausted (provider 429 RESOURCE_EXHAUSTED)." },
  });

  await page.goto("/embeddings");
  await selectSeededDocument(page);
  const quotaNotice = page.getByTestId("embedding-quota-notice");
  // The seeded chunk run has no detail loaded here, so tokens use the 512-token chunk size as an upper bound:
  // 166 x (512 + 12) = 86,984 tokens -> 3 minutes at 30,000 tokens/min, longer than 2 minutes by inputs.
  await expect(quotaNotice).toContainText("Embedding takes about 3 minutes");
  await expect(quotaNotice).toContainText("166 chunks to embed, and the AI provider accepts at most 100 chunks and 30,000 tokens a minute.");
  await expectNoHorizontalOverflow(page, "embeddings quota notice desktop");
  await testInfo.attach("embedding-quota-notice-desktop", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.getByTestId("embedding-run-action").click();
  const error = page.getByTestId("embedding-error");
  await expect(error).toContainText("The AI provider's usage quota has run out for now.");
  await expect(error).toHaveAttribute("role", "alert");
  // Retrying an exhausted quota fails the same way; the message says when to come back instead.
  await expect(error.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(quotaNotice).toHaveCount(0);
  // The run happens in the background: the failure is also announced with its cause.
  await expect(page.getByText("Embeddings couldn't be created")).toBeVisible();
  await testInfo.attach("embedding-quota-exhausted-desktop", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(error).toBeVisible();
  await expectNoHorizontalOverflow(page, "embeddings quota error mobile");
  await testInfo.attach("embedding-quota-exhausted-mobile", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  quality.assertClean();
});
