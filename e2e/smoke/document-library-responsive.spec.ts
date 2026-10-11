import { expect, test } from "@playwright/test";

import { installBrowserQualityGuards } from "../support/browser-quality";
import { installSeededApi } from "../support/seeded-api";

// Tablet widths use the cards; the table appears only when its name column stays readable.
for (const locale of ["en", "tr"] as const) {
  test(`${locale}: document library keeps the file name readable at tablet and laptop widths`, async ({ page }) => {
    const quality = installBrowserQualityGuards(page);
    await installSeededApi(page, { scenario: "documents-populated", locale, longNames: true });
    const inUse = locale === "tr" ? "Kullanımda" : "In use";

    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/documents");
    await expect(page.getByTestId("document-library-mobile")).toBeVisible();
    await expect(page.getByTestId("document-library-table")).toBeHidden();

    await page.setViewportSize({ width: 1024, height: 900 });
    const table = page.getByTestId("document-library-table");
    await expect(table).toBeVisible();
    await expect(page.getByTestId("document-library-mobile")).toBeHidden();
    const row = table.getByTestId("document-library-row").first();
    await expect(row.getByText(inUse, { exact: true })).toBeVisible();
    const nameBox = await row.getByTestId("document-library-name").boundingBox();
    expect(nameBox?.width ?? 0).toBeGreaterThanOrEqual(120);

    quality.assertClean();
  });
}
