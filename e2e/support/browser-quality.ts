import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type Request } from "@playwright/test";

const BENIGN_CONSOLE_ERRORS: RegExp[] = [];
const BENIGN_FAILED_REQUESTS = [/\/favicon\.ico(?:\?|$)/];
const BENIGN_HTTP_ERRORS = [/\/favicon\.ico(?:\?|$)/];

function requestFailure(request: Request) {
  const failure = request.failure()?.errorText ?? "unknown failure";
  return `${request.method()} ${request.url()} (${failure})`;
}

export function installBrowserQualityGuards(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const httpErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const value = message.text();
    if (!BENIGN_CONSOLE_ERRORS.some((pattern) => pattern.test(value))) consoleErrors.push(value);
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    if (!BENIGN_FAILED_REQUESTS.some((pattern) => pattern.test(request.url()))) failedRequests.push(requestFailure(request));
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    if (!BENIGN_HTTP_ERRORS.some((pattern) => pattern.test(response.url()))) {
      httpErrors.push(`${response.request().method()} ${response.url()} (HTTP ${response.status()})`);
    }
  });

  return {
    assertClean() {
      expect(consoleErrors, "Unexpected browser console.error entries").toEqual([]);
      expect(pageErrors, "Unhandled page errors").toEqual([]);
      expect(failedRequests, "Unexpected failed browser requests").toEqual([]);
      expect(httpErrors, "Unexpected HTTP error responses").toEqual([]);
    },
  };
}

/** WCAG 2.0/2.1 A and AA rules; best-practice and WCAG 2.2 rules are not a gate. */
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/**
 * Deliberate rule exceptions, each with its reason. Keep empty unless a finding is
 * a verified false positive; a real violation is fixed, not listed here.
 */
const AXE_DISABLED_RULES: string[] = [];
/** Host chrome that is not part of the app: Next's dev overlay and the Vercel Preview toolbar. */
const AXE_EXCLUDED_HOSTS = ["nextjs-portal", "vercel-live-feedback"];

/** Fails on any serious or critical axe violation of the current page state. */
export async function assertNoSeriousA11yViolations(page: Page, label: string) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (AXE_DISABLED_RULES.length) builder = builder.disableRules(AXE_DISABLED_RULES);
  for (const host of AXE_EXCLUDED_HOSTS) builder = builder.exclude(host);
  const { violations } = await builder.analyze();
  const blocking = violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help} → ${violation.nodes.slice(0, 5).map((node) => node.target.join(" ")).join(" | ")}`);
  expect(blocking, `${label}: serious/critical accessibility violations`).toEqual([]);
}
