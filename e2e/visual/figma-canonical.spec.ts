import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Locator, type Page } from "@playwright/test";

// Figma's exported 1441.449 px frame rasterizes to 1442 px for these nodes.
// Overview keeps its historical 1441 px golden contract in its dedicated test.
const viewport = { width: 1442, height: 1041 } as const;
const artifactDirectory = path.resolve("output/playwright/figma-canonical");
const visualDiff = path.resolve("e2e/visual/figma-visual-diff.mjs");
const fixtureUrl = pathToFileURL(path.resolve("e2e/visual/fixtures/figma-canonical.html")).href;

const screens = [
  ["documents-populated", "documents-4-544.png"],
  ["parsing-result", "parsing-4-857.png"],
  ["chunking-config", "chunking-config-4-2123.png"],
  ["chunking-result", "chunking-result-4-2376.png"],
  ["embeddings-ready", "embeddings-ready-4-2976.png"],
  ["embeddings-result", "embeddings-result-4-3190.png"],
  ["playground-empty", "playground-empty-4-3500.png"],
  ["playground-retrieval", "playground-retrieval-4-3703.png"],
  ["playground-context", "playground-context-4-4121.png"],
  ["playground-answer", "playground-answer-4-4517.png"],
  ["evaluation-dataset", "evaluation-4-4858.png"],
  ["evaluation-results", "evaluation-results-4-5213.png"],
  ["evaluation-compare", "evaluation-compare-4-5568.png"],
  ["settings", "settings-4-5856.png"],
  ["auth-login", "auth-login-4-2.png"],
  ["auth-signup", "auth-signup-4-6328.png"],
  ["auth-forgot", "auth-forgot-4-6216.png"],
] as const;

type CanonicalScreen = (typeof screens)[number][0];
type VisualContract = { maxMae: number; maxChangedPixelPercentage: number };

// Statik Figma kopyalarında ekranın içerik yoğunluğuna göre ayrı tolerans kullanılır.
// Overview bu dosyadan ayrıdır ve kendi 3.7 / 5 sözleşmesini korur.
const visualContracts: Record<CanonicalScreen, VisualContract> = {
  "documents-populated": { maxMae: 4.5, maxChangedPixelPercentage: 8 },
  "parsing-result": { maxMae: 6, maxChangedPixelPercentage: 8 },
  "chunking-config": { maxMae: 4, maxChangedPixelPercentage: 6 },
  "chunking-result": { maxMae: 8.5, maxChangedPixelPercentage: 9 },
  "embeddings-ready": { maxMae: 4, maxChangedPixelPercentage: 6 },
  "embeddings-result": { maxMae: 6, maxChangedPixelPercentage: 8 },
  "playground-empty": { maxMae: 4, maxChangedPixelPercentage: 6 },
  "playground-retrieval": { maxMae: 8, maxChangedPixelPercentage: 8 },
  "playground-context": { maxMae: 8, maxChangedPixelPercentage: 9 },
  "playground-answer": { maxMae: 7, maxChangedPixelPercentage: 8 },
  "evaluation-dataset": { maxMae: 6, maxChangedPixelPercentage: 8 },
  "evaluation-results": { maxMae: 6, maxChangedPixelPercentage: 8 },
  "evaluation-compare": { maxMae: 12, maxChangedPixelPercentage: 10 },
  settings: { maxMae: 3, maxChangedPixelPercentage: 5 },
  "auth-login": { maxMae: 10, maxChangedPixelPercentage: 8 },
  "auth-signup": { maxMae: 12, maxChangedPixelPercentage: 9 },
  "auth-forgot": { maxMae: 10, maxChangedPixelPercentage: 8 },
};

async function settle(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, (image) => image.complete
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error(`Asset failed: ${image.src}`)), { once: true });
        })));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function assertGeometry(locator: Locator, expected: { x?: number; y?: number; width?: number; height?: number }) {
  const actual = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  for (const property of ["width", "height"] as const) {
    const expectedValue = expected[property];
    if (expectedValue === undefined) continue;
    expect(Math.abs(actual[property] - expectedValue), `${property} geometry`).toBeLessThanOrEqual(1);
  }
  for (const property of ["x", "y"] as const) {
    if (expected[property] === undefined) continue;
    expect(Math.abs(actual[property] - expected[property]), `${property} geometry`).toBeLessThanOrEqual(1);
  }
}

test.describe("Figma canonical static golden clones", () => {
  for (const [screen, referenceName] of screens) {
    test(`${screen} preserves the canonical desktop geometry and visual contract`, async ({ page }) => {
      await page.setViewportSize(viewport);
      // Preview ortamında kalıcı analytics/transport bağlantıları networkidle'ı bloke edebilir.
      // Statik fixture için DOM + aşağıdaki font/görsel beklemesi yeterlidir.
      await page.goto(`${fixtureUrl}?screen=${screen}`, { waitUntil: "load" });
      expect(page.url()).toContain("figma-canonical.html");
      await settle(page);

      const browserViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
      expect(browserViewport).toEqual(viewport);
      const isAuth = screen.startsWith("auth-");
      if (isAuth) {
        const root = page.locator(".auth-page");
        const card = page.locator(".auth-card");
        await assertGeometry(root, { width: 1441.449, height: 1040.856 });
        await assertGeometry(card, { x: 200.724, y: 186.106, width: 1040, height: 668.644 });
      } else {
        const root = page.getByTestId("figma-canonical-root");
        const sidebar = page.getByTestId("figma-canonical-sidebar");
        const main = page.getByTestId("figma-canonical-main");
        const fixturePage = page.getByTestId("figma-canonical-page");
        const header = page.getByTestId("figma-canonical-header");
        await assertGeometry(root, { width: 1441.449, height: 1040.856 });
        await assertGeometry(sidebar, { x: 0, y: 0, width: 247.99, height: 1040.856 });
        await assertGeometry(main, { x: 247.99, y: 0, width: 1193.459, height: 1040.856 });
        await assertGeometry(fixturePage, { x: 247.99, y: 0, width: 1193 });
        await assertGeometry(header, { x: 287.99, y: 40, width: 1113, height: 92 });
      }

      await mkdir(artifactDirectory, { recursive: true });
      const actualPath = path.join(artifactDirectory, `${screen}-actual.png`);
      const diffPath = path.join(artifactDirectory, `${screen}-diff.png`);
      const metricsPath = path.join(artifactDirectory, `${screen}-metrics.json`);
      const contract = visualContracts[screen];
      const screenshot = await page.screenshot({ animations: "disabled", caret: "hide", fullPage: false, path: actualPath });
      expect(screenshot.subarray(1, 4).toString("ascii")).toBe("PNG");
      expect(screenshot.readUInt32BE(16)).toBe(viewport.width);
      expect(screenshot.readUInt32BE(20)).toBe(viewport.height);

      execFileSync(process.execPath, [visualDiff, path.resolve("e2e/visual/reference", referenceName), actualPath, diffPath, metricsPath, String(contract.maxMae), "20", String(contract.maxChangedPixelPercentage)], { stdio: "inherit" });
      const metrics = JSON.parse(await readFile(metricsPath, "utf8")) as { changedPixelPercentage: number; mae: number };
      expect(metrics.mae, `${screen} MAE`).toBeLessThanOrEqual(contract.maxMae);
      expect(metrics.changedPixelPercentage, `${screen} changed pixels`).toBeLessThanOrEqual(contract.maxChangedPixelPercentage);
    });
  }
});
