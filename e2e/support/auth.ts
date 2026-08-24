import { expect, type Page } from "@playwright/test";

export type E2ECredentials = { email: string; password: string };

export function requireE2ECredentials(): E2ECredentials {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_USER_EMAIL and E2E_USER_PASSWORD are required. Do not print their values in logs.");
  }
  return { email, password };
}

export async function signIn(page: Page, credentials = requireE2ECredentials()) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /Account menu/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
}
