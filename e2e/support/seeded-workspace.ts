import { expect, type Page } from "@playwright/test";

export async function selectSeededDocument(page: Page, documentName = "e2e-seeded-golden.pdf") {
  // Overview ve context bar aynı erişilebilir adı kullanır; sayfada aynı anda yalnız biri bulunur.
  // TR seeded oturumlar (locale: "tr") aynı yardımcıyı kullanır.
  const documentContext = page.getByRole("combobox", { name: /^(Document|Doküman)$/ });
  await expect(documentContext).toBeEnabled();
  await documentContext.click();
  await page.getByRole("option", { name: documentName }).click();
  await expect(documentContext).toContainText(documentName);
  const lineage = page.getByRole("navigation", { name: /lineage|aşamaları/i });
  if (await lineage.count()) await expect(lineage).toContainText(/Parsing|Ayrıştırma/);
}
