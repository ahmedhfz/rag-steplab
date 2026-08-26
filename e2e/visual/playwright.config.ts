import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile?.(".env.e2e.local");
} catch {}

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseURL);

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
    baseURL,
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
  webServer: isLocal
    ? {
        command: "npm run dev:frontend",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
