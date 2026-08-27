import { mkdir } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { installSeededApi } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

const viewport = { width: 1441, height: 1041 } as const;
const artifactDirectory = path.resolve("output/playwright/figma-production");

async function settle(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.complete && image.naturalWidth > 0
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error(`Asset failed: ${image.src}`)), { once: true });
        })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function assertShellGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, width: value.width, height: value.height };
    };
    return {
      sidebar: rect('[data-testid="app-shell-sidebar"]'),
      main: rect('[data-testid="app-shell-main"]'),
    };
  });
  expect(geometry.sidebar).toMatchObject({ x: 0, width: 248 });
  expect(geometry.main).toMatchObject({ x: 248 });
}

test.describe("canonical desktop production route inventory", () => {
  test.beforeEach(async ({ page }) => {
    await installSeededApi(page);
    await page.setViewportSize(viewport);
    await page.goto("/parse", { waitUntil: "networkidle" });
    await selectSeededDocument(page);
  });

  for (const route of [
    ["overview", "/", "Build your RAG, one step at a time."],
    ["documents-populated", "/documents", "Documents"],
    ["parsing-result", "/parse", "Parsing"],
    ["chunking-result", "/chunking", "Chunking"],
    ["embeddings-result", "/embeddings", "Embeddings"],
    ["playground-answer", "/playground", "Playground"],
    ["evaluation-dataset", "/evaluation", "Evaluation"],
    ["evaluation-results", "/evaluation", "Evaluation"],
    ["evaluation-compare", "/evaluation", "Evaluation"],
    ["settings", "/settings", "Settings"],
  ] as const) {
    test(`${route[0]} route screenshot`, async ({ page }) => {
      await page.goto(route[1], { waitUntil: "networkidle" });
      await expect(page.getByRole("heading", { name: route[2], level: 1 })).toBeVisible();
      await assertShellGeometry(page);
      if (route[0] === "playground-answer") {
        await expect(page.getByTestId("experiment-stage-trace")).toBeVisible();
        await page.getByTestId("experiment-stage-trace").getByRole("button", { name: "Answer" }).click();
        await expect(page.getByRole("heading", { name: "Answer", level: 2 })).toBeVisible();
      }
      if (route[0] === "evaluation-results" || route[0] === "evaluation-compare") {
        const tab = route[0] === "evaluation-results" ? "Results" : "Compare";
        await page.getByTestId(`evaluation-tab-${route[0].replace("evaluation-", "")}`).click();
        await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
      }
      await settle(page);
      await mkdir(artifactDirectory, { recursive: true });
      await page.screenshot({ animations: "disabled", caret: "hide", path: path.join(artifactDirectory, `${route[0]}.png`) });
    });
  }
});

test.describe("canonical desktop auth route inventory", () => {
  // Auth ekranlarını anonim tutarken korumalı Preview'ın bypass cookie'sini koruyoruz.
  // Boş storage state kullanmak Vercel'de uygulama yerine Vercel login ekranını açar.
  test.use({ storageState: "output/playwright/.auth/vercel-bypass.json" });

  for (const route of [
    ["auth-login", "/login", "Sign in"],
    ["auth-signup", "/login", "Create account"],
    ["auth-forgot", "/login", "Sign in"],
  ] as const) {
    test(`${route[0]} route screenshot`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(route[1], { waitUntil: "networkidle" });
      if (route[0] === "auth-signup") {
        await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
        await page.getByRole("button", { name: "Create account", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Create account", level: 1 })).toBeVisible();
      } else if (route[0] === "auth-forgot") {
        await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();
        await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Reset your password", level: 1 })).toBeVisible();
      } else {
        await expect(page.getByRole("heading", { name: route[2], level: 1 })).toBeVisible();
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      await mkdir(artifactDirectory, { recursive: true });
      await page.screenshot({ animations: "disabled", caret: "hide", path: path.join(artifactDirectory, `${route[0]}.png`) });
    });
  }
});
