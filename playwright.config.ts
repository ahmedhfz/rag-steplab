import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile?.(".env.e2e.local");
} catch {}

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseURL);
const authState = "output/playwright/.auth/user.json";
const vercelBypassState = "output/playwright/.auth/vercel-bypass.json";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/setup/global.setup.ts",
  outputDir: "output/playwright/test-results",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "output/playwright/report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  use: {
    baseURL,
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
      use: { storageState: vercelBypassState },
    },
    {
      name: "chromium-seeded",
      testMatch: /smoke\/.*\.spec\.ts/,
      dependencies: ["auth-setup"],
      use: { ...devices["Desktop Chrome"], storageState: authState },
    },
    {
      name: "auth",
      testMatch: /auth\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: vercelBypassState },
    },
    {
      name: "full-rag",
      testMatch: /full\/.*\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], storageState: vercelBypassState },
    },
    {
      name: "figma-production",
      testMatch: /visual\/figma-production\.spec\.ts/,
      dependencies: ["auth-setup"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], storageState: authState, viewport: { width: 1441, height: 1041 } },
    },
    {
      name: "figma-canonical",
      testMatch: /visual\/figma-canonical\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1442, height: 1041 } },
    },
  ],
  webServer: isLocal
    ? {
        command: "npm run dev:frontend",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
