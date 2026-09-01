export const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";
export const LOCAL_API_PROXY_PATH = "/api/rag";

function normalizedUrl(value: string | undefined) {
  return value?.trim().replace(/\/$/, "") ?? "";
}

export function shouldProxyRemoteApi(configuredUrl: string | undefined, nodeEnv: string | undefined) {
  const value = normalizedUrl(configuredUrl);
  if (!value || nodeEnv !== "development") return false;

  try {
    const url = new URL(value);
    const isLoopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    return (url.protocol === "http:" || url.protocol === "https:") && !isLoopback;
  } catch {
    return false;
  }
}

export function resolveApiBaseUrl(configuredUrl: string | undefined, nodeEnv: string | undefined) {
  const value = normalizedUrl(configuredUrl);
  if (shouldProxyRemoteApi(value, nodeEnv)) return LOCAL_API_PROXY_PATH;
  if (value) return value;
  return nodeEnv === "production" ? null : DEFAULT_API_BASE_URL;
}
