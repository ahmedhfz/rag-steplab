/**
 * Post-login destination handling. `next` values come from the URL, so only a
 * same-origin relative path is ever honored; anything else falls back to "/"
 * (open-redirect protection).
 */
export const AUTH_NEXT_COOKIE = "rag-steplab-auth-next";
export const AUTH_NEXT_COOKIE_MAX_AGE_SECONDS = 10 * 60;

const AUTH_ROUTE_PREFIXES = ["/login", "/auth/"];
const ORIGIN_PROBE = "https://next-path.invalid";

export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || raw.length > 2048 || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Control characters and backslashes can be normalized into another origin by browsers.
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return fallback;
  let url: URL;
  try {
    url = new URL(raw, ORIGIN_PROBE);
  } catch {
    return fallback;
  }
  if (url.origin !== ORIGIN_PROBE) return fallback;
  if (AUTH_ROUTE_PREFIXES.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Login URL that returns to `path` after authentication; the root stays clean. */
export function loginPathWithNext(path: string): string {
  const next = safeNextPath(path);
  return next === "/" ? "/login" : `/login?${new URLSearchParams({ next }).toString()}`;
}

/** Reads a cookie value from a raw Cookie header without trusting its content. */
export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}
