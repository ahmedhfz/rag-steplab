import { expect, test, type Page } from "@playwright/test";

import { assertNoSeriousA11yViolations, installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi, type SeededScenario } from "../support/seeded-api";
import { selectSeededDocument } from "../support/seeded-workspace";

type Screen = {
  name: string;
  route: string;
  scenario: SeededScenario;
  /** Brings the screen to the scanned state once the route is open. */
  ready: (page: Page) => Promise<void>;
};

const screens: Screen[] = [
  { name: "overview", route: "/", scenario: "complete", ready: async (page) => {
    await expect(page.getByTestId("continue-surface")).toBeVisible();
  } },
  { name: "documents", route: "/documents", scenario: "documents-populated", ready: async (page) => {
    await expect(page.getByTestId("document-library")).toBeVisible();
  } },
  { name: "parsing", route: "/parse", scenario: "parsing-result", ready: async (page) => {
    await expect(page.getByTestId("parse-result-summary")).toBeVisible();
  } },
  { name: "chunking", route: "/chunking", scenario: "chunking-result", ready: async (page) => {
    await expect(page.getByTestId("chunk-results")).toBeVisible();
  } },
  { name: "embeddings", route: "/embeddings", scenario: "embeddings-result", ready: async (page) => {
    await expect(page.getByTestId("embedding-result-details")).toBeVisible();
  } },
  { name: "playground-answer", route: "/playground", scenario: "playground-answer", ready: async (page) => {
    await expect(page.getByTestId("experiment-stage-trace")).toBeVisible();
    await page.getByTestId("experiment-stage-trace").getByRole("button", { name: /^Answer\b/ }).click();
    await expect(page.getByTestId("playground-stage-content").getByRole("heading", { name: "Answer", level: 2 })).toBeVisible();
  } },
  { name: "evaluation-results", route: "/evaluation", scenario: "evaluation-results", ready: async (page) => {
    await expect(page.getByTestId("evaluation-panel-results")).toBeVisible();
  } },
  { name: "settings", route: "/settings", scenario: "settings", ready: async (page) => {
    await expect(page.getByTestId("settings-card")).toBeVisible();
  } },
];

for (const theme of ["light", "dark"] as const) {
  test.describe(`axe ${theme}`, () => {
    for (const screen of screens) {
      test(`${screen.name} has no serious or critical accessibility violations (${theme})`, async ({ page }) => {
        const quality = installBrowserQualityGuards(page);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
        const seeded = await installSeededApi(page, { scenario: screen.scenario, theme });
        await page.goto("/parse");
        await selectSeededDocument(page);
        await page.goto(screen.route);
        await screen.ready(page);
        await expect(page.locator("html")).toHaveClass(theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);

        await assertNoSeriousA11yViolations(page, `${screen.name} (${theme})`);
        // Seeded runs stay deterministic: every API call the screen made has a fixture.
        expect(seeded.unmatchedApiRequests, "API requests without a seeded fixture").toEqual([]);
        quality.assertClean();
      });
    }
  });
}

test.describe("axe login", () => {
  // Anonymous, but keeps the protected Preview's bypass cookie (see the visual suite).
  test.use({ storageState: "output/playwright/.auth/vercel-bypass.json" });

  for (const theme of ["light", "dark"] as const) {
    test(`login has no serious or critical accessibility violations (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await page.addInitScript((preferredTheme) => {
        window.localStorage.setItem("rag-steplab.preferences.v3", JSON.stringify({ locale: "en", showLearningHints: true, theme: preferredTheme }));
      }, theme);
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in", level: 1 })).toBeVisible();

      await assertNoSeriousA11yViolations(page, `login (${theme})`);
    });
  }
});
