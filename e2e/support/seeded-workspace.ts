import { expect, type Page } from "@playwright/test";

export async function selectSeededDocument(page: Page, documentName = "e2e-seeded-golden.pdf") {
  const documentContext = page.getByRole("combobox", { name: "Document context" });
  await expect(documentContext).toBeEnabled();
  await documentContext.click();
  await page.getByRole("option", { name: documentName }).click();
  await expect(documentContext).toContainText(documentName);
  const lineage = page.getByRole("navigation", { name: /lineage/i });
  if (await lineage.count()) await expect(lineage).toContainText("Parse");
}
