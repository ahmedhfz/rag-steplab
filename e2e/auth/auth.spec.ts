import { expect, test } from "@playwright/test";

import { requireE2ECredentials, signIn, signOut } from "../support/auth";
import { installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi } from "../support/seeded-api";

test("Google-only login, oturum, logout ve protected route gerçek Supabase auth ile çalışır", async ({ page }) => {
  const quality = installBrowserQualityGuards(page);
  await installSeededApi(page);

  await page.goto("/documents");
  await expect(page).toHaveURL(/\/login\?next=%2Fdocuments$/);

  // The login page offers Google OAuth only and carries the protected deep link to it.
  await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveAttribute("href", "/auth/google?next=%2Fdocuments");
  await expect(page.locator("main").getByRole("textbox")).toHaveCount(0);
  await expect(page.locator('main form, main input[type="password"], main input[type="email"]')).toHaveCount(0);

  // The dedicated E2E user keeps a password on the hosted project; its session is created from Node.
  await signIn(page, requireE2ECredentials());
  await expect(page.getByRole("heading", { name: "Build your RAG, one step at a time." })).toBeVisible();

  await signOut(page);
  await page.goto("/evaluation");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);

  quality.assertClean();
});
