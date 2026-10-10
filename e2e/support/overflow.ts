import { expect, type Page } from "@playwright/test";

/**
 * Horizontal overflow that a document-level `scrollWidth` check cannot see: an
 * element whose content is wider than its box without being a scroller. The
 * content then either spills out (`overflow-x: visible`) or is cut off out of
 * reach (`hidden`/`clip`). Local scrollers (`auto`/`scroll`), text truncated
 * with an ellipsis, visually-hidden (sr-only) text and form controls, which
 * scroll their own value, are intentional and skipped.
 */
export async function findHorizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const skippedTags = new Set(["INPUT", "SELECT", "TEXTAREA"]);
    const offenders: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      if (!(element instanceof HTMLElement) || skippedTags.has(element.tagName)) continue;
      if (element.scrollWidth <= element.clientWidth + 1 || element.clientWidth <= 1) continue;
      const style = getComputedStyle(element);
      if (style.display === "inline" || style.display === "contents" || style.visibility === "hidden") continue;
      if (style.overflowX === "auto" || style.overflowX === "scroll" || style.textOverflow === "ellipsis") continue;
      if (element.getClientRects().length === 0) continue;

      const owner = element.closest("[data-testid]")?.getAttribute("data-testid");
      const classes = element.getAttribute("class")?.trim().split(/\s+/).slice(0, 4).join(".");
      offenders.push(`${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}${owner ? ` in [data-testid="${owner}"]` : ""}: content ${element.scrollWidth}px > box ${element.clientWidth}px (overflow-x: ${style.overflowX})`);
    }
    return offenders;
  });
}

/** No document scroll and no element-level spill/clip; polls past entrance transitions. */
export async function expectNoHorizontalOverflow(page: Page, label = "page") {
  await expect.poll(async () => {
    const dimensions = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      html: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    const contentWidth = Math.max(dimensions.body, dimensions.html);
    const documentOverflow = contentWidth > dimensions.viewport
      ? [`document: content ${contentWidth}px > viewport ${dimensions.viewport}px`]
      : [];
    return [...documentOverflow, ...await findHorizontalOverflow(page)];
  }, { message: `${label} has horizontal overflow` }).toEqual([]);
}
