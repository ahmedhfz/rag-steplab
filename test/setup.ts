import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom pointer-capture API'sini sağlamaz; Radix Select gerçek tarayıcıda bu API'yi kullanır.
// Node-environment tests (route handlers, proxy) have no DOM.
if (typeof HTMLElement !== "undefined") {
  Object.defineProperties(HTMLElement.prototype, {
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: () => undefined },
    scrollIntoView: { configurable: true, value: () => undefined },
    setPointerCapture: { configurable: true, value: () => undefined },
  });
}

// Test seams live here instead of NODE_ENV branches in production code.
// Components rendered without AuthProvider act as a signed-in test user, and
// API requests carry a test token; files that need the real behavior mock
// these modules themselves (their vi.mock takes precedence).
vi.mock("@/lib/supabase/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase/browser")>();
  return { ...actual, getSupabaseAccessToken: async () => "test-access-token" };
});

vi.mock("@/components/auth-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/auth-provider")>();
  const testUser = { user: null, userId: "test-user", ready: true, error: false, retry: () => undefined };
  return {
    ...actual,
    useAuthBootstrap: () => {
      try {
        return actual.useAuthBootstrap();
      } catch {
        return testUser;
      }
    },
  };
});
