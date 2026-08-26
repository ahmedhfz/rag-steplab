import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

const viewport = { width: 1441, height: 1041 } as const;
const tolerance = 1;

type Geometry = { x: number; y: number; width: number; height: number };

const expectedGeometry: Record<string, Geometry> = {
  "figma-overview-root": { x: 0, y: 0, width: 1441.449, height: 1040.856 },
  "figma-overview-sidebar": { x: 0, y: 0, width: 247.99, height: 1040.856 },
  "figma-overview-main": { x: 247.99, y: 0, width: 1193.459, height: 1040.856 },
  "figma-overview-header": { x: 288.219, y: 40, width: 1113, height: 82 },
  "figma-overview-continue": { x: 288.219, y: 150, width: 1113, height: 77.424 },
  "figma-overview-journey": { x: 317.931, y: 307.136, width: 1054, height: 216 },
  "figma-overview-prepare": { x: 342.965, y: 323.136, width: 441, height: 192 },
  "figma-overview-test": { x: 794.287, y: 323.136, width: 428, height: 192 },
  "figma-overview-measure": { x: 1232.74, y: 323.136, width: 114, height: 192 },
  "figma-overview-current-setup": { x: 288.219, y: 576.848, width: 615.788, height: 277.761 },
  "figma-overview-recent-activity": { x: 928.007, y: 576.848, width: 473.671, height: 277.761 },
  "figma-overview-learning-note": { x: 288.219, y: 878.848, width: 1113, height: 97 },
  "figma-overview-node-documents": { x: 380.082, y: 375.115, width: 40, height: 40 },
  "figma-overview-node-parsing": { x: 491.813, y: 435.113, width: 40, height: 40 },
  "figma-overview-node-chunking": { x: 601.457, y: 375.115, width: 40, height: 40 },
  "figma-overview-node-embeddings": { x: 713.187, y: 435.113, width: 40, height: 40 },
  "figma-overview-node-retrieval": { x: 824.918, y: 375.115, width: 40, height: 40 },
  "figma-overview-node-reranking": { x: 932.449, y: 435.113, width: 40, height: 40 },
  "figma-overview-node-context": { x: 1044.179, y: 375.115, width: 40, height: 40 },
  "figma-overview-node-answer": { x: 1153.796, y: 435.113, width: 40, height: 40 },
  "figma-overview-node-evaluation": { x: 1265.527, y: 375.115, width: 40, height: 40 },
};

function pngDimensions(buffer: Buffer) {
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("Figma Overview 4:147 golden visual contract", async ({ page }) => {
  await page.setViewportSize(viewport);
  const response = await page.goto("/__visual__/figma-overview.html", { waitUntil: "networkidle" });
  expect(response?.ok()).toBe(true);

  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) =>
        image.complete && image.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((resolve, reject) => {
              image.addEventListener("load", () => resolve(), { once: true });
              image.addEventListener("error", () => reject(new Error(`Asset failed: ${image.src}`)), { once: true });
            }),
      ),
    );
  });

  const browserViewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(browserViewport).toEqual(viewport);

  for (const [testId, expectedRect] of Object.entries(expectedGeometry)) {
    const actualRect = await page.getByTestId(testId).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });

    for (const property of ["x", "y", "width", "height"] as const) {
      expect(Math.abs(actualRect[property] - expectedRect[property]), `${testId}.${property}`).toBeLessThanOrEqual(tolerance);
    }
  }

  const screenshot = await page.screenshot({ animations: "disabled", caret: "hide", fullPage: false });
  expect(pngDimensions(screenshot)).toEqual(viewport);

  const artifactDirectory = path.resolve("output/playwright/figma-visual");
  const actualPath = path.join(artifactDirectory, "overview-4-147-actual.png");
  const diffPath = path.join(artifactDirectory, "overview-4-147-diff.png");
  const metricsPath = path.join(artifactDirectory, "overview-4-147-metrics.json");
  await mkdir(artifactDirectory, { recursive: true });
  await writeFile(actualPath, screenshot);

  execFileSync(
    process.execPath,
    [
      path.resolve("e2e/visual/figma-visual-diff.mjs"),
      path.resolve("e2e/visual/reference/overview-4-147.png"),
      actualPath,
      diffPath,
      metricsPath,
      "3.5",
      "20",
    ],
    { stdio: "inherit" },
  );

  expect(screenshot).toMatchSnapshot("overview-4-147.png", {
    threshold: 0.2,
    maxDiffPixelRatio: 0.05,
  });
});
