import { describe, expect, it } from "vitest";

import {
  DEFAULT_API_BASE_URL,
  LOCAL_API_PROXY_PATH,
  resolveApiBaseUrl,
  shouldProxyRemoteApi,
} from "@/lib/api-base-url";

describe("local RAG API routing", () => {
  it("routes a hosted development API through the same-origin proxy", () => {
    const hostedApi = "https://example--rag-api.modal.run/";

    expect(shouldProxyRemoteApi(hostedApi, "development")).toBe(true);
    expect(resolveApiBaseUrl(hostedApi, "development")).toBe(LOCAL_API_PROXY_PATH);
  });

  it("keeps local backend URLs direct", () => {
    expect(resolveApiBaseUrl("http://127.0.0.1:8000/", "development")).toBe(DEFAULT_API_BASE_URL);
    expect(resolveApiBaseUrl("http://localhost:8000", "development")).toBe("http://localhost:8000");
  });

  it("keeps the configured production API direct", () => {
    expect(resolveApiBaseUrl("https://api.example.com/", "production")).toBe("https://api.example.com");
  });

  it("requires an explicit API URL in production", () => {
    expect(resolveApiBaseUrl(undefined, "production")).toBeNull();
  });
});
