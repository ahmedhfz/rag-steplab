import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "figma-overview.spec.ts",
  outputDir: "../../output/playwright/figma-visual/test-results",
  snapshotPathTemplate: "reference/{arg}{ext}",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 45_000,
  reporter: process.env.CI ? "line" : "list",
  expect: { timeout: 10_000 },
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1441, height: 1041 },
    deviceScaleFactor: 1,
    colorScheme: "light",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
