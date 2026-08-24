import { expect, type Page } from "@playwright/test";

export async function selectSeededDocument(page: Page) {
  const documentContext = page.getByRole("combobox", { name: "Document context" });
  await expect(documentContext).toBeEnabled();
  await documentContext.click();
  await page.getByRole("option", { name: "e2e-seeded-golden.pdf" }).click();
  await expect(documentContext).toContainText("e2e-seeded-golden.pdf");
  await expect(page.getByLabel("Selected lineage")).toContainText("P1");
}
