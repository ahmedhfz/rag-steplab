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
