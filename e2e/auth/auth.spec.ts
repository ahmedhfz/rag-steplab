import { expect, test } from "@playwright/test";

import { requireE2ECredentials, signIn, signOut } from "../support/auth";
import { installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi } from "../support/seeded-api";

test("login, logout ve protected route gerçek Supabase auth ile çalışır", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);
  await installSeededApi(page);

  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);

  await signIn(page, requireE2ECredentials());
  await expect(page.getByRole("heading", { name: "Build your RAG, one step at a time." })).toBeVisible();

  await signOut(page);
  await page.goto("/evaluation");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);

  quality.assertClean();
});
