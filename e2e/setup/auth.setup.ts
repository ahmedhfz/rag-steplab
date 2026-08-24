import { expect, test as setup } from "@playwright/test";

import { requireE2ECredentials, signIn } from "../support/auth";
import { installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi } from "../support/seeded-api";

const authFile = "output/playwright/.auth/user.json";

setup("dedicated E2E user storageState oluşturur", async ({ page }) => {
  const credentials = requireE2ECredentials();
  const quality = installBrowserQualityGuards(page);
  // Storage-state hazırlığı auth'u gerçek, RAG boot çağrılarını deterministic tutar.
  await installSeededApi(page);

  await signIn(page, credentials);
  await expect(page.getByRole("heading", { name: "RAG Pipeline" })).toBeVisible();
  await page.context().storageState({ path: authFile });

  quality.assertClean();
});
