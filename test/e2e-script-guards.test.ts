import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const admin = vi.hoisted(() => ({
  listUsers: vi.fn(),
  updateUserById: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { admin } }),
}));

// @ts-expect-error -- Node script modülü; tip bildirimi yok.
const { assertCleanupTarget, cleanupScope, ensureUser, inCleanupScope } = await import("../scripts/e2e.mjs");

describe("E2E cleanup target guard", () => {
  beforeEach(() => {
    vi.stubEnv("E2E_TARGET", "");
    vi.stubEnv("E2E_ALLOW_PRODUCTION_CLEANUP", "");
    vi.stubEnv("E2E_TEST_HOSTS", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts loopback test targets", () => {
    vi.stubEnv("E2E_TARGET", "test");
    expect(() => assertCleanupTarget(["http://127.0.0.1:54321", "http://localhost:8000"])).not.toThrow();
  });

  it("refuses an undeclared hosted target, including production custom domains", () => {
    vi.stubEnv("E2E_TARGET", "test");
    expect(() => assertCleanupTarget(["https://auth.example.com", "http://localhost:8000"])).toThrow(/not a declared test host/);
    expect(() => assertCleanupTarget(["http://localhost:54321", "https://api.example.com"])).toThrow(/not a declared test host/);
  });

  it("accepts hosted test targets only when listed explicitly", () => {
    vi.stubEnv("E2E_TARGET", "test");
    vi.stubEnv("E2E_TEST_HOSTS", "staging-ref.supabase.co, staging-api.example.com");
    expect(() => assertCleanupTarget(["https://staging-ref.supabase.co", "https://staging-api.example.com"])).not.toThrow();
  });

  it("requires the explicit production opt-in", () => {
    vi.stubEnv("E2E_TARGET", "production");
    expect(() => assertCleanupTarget(["https://prod.supabase.co"])).toThrow(/E2E_ALLOW_PRODUCTION_CLEANUP/);
    vi.stubEnv("E2E_ALLOW_PRODUCTION_CLEANUP", "true");
    expect(() => assertCleanupTarget(["https://prod.supabase.co"])).not.toThrow();
  });
});

describe("E2E cleanup scope", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("limits post-run cleanup to the run namespace", () => {
    vi.stubEnv("E2E_RUN_ID", "123-1");
    const scope = cleanupScope(["node", "e2e.mjs", "cleanup"]);
    expect(inCleanupScope({ id: "a", fileName: "e2e-123-1-golden.pdf" }, scope)).toBe(true);
    expect(inCleanupScope({ id: "b", fileName: "e2e-456-1-golden.pdf" }, scope)).toBe(false);
    expect(inCleanupScope({ id: "c", fileName: "e2e-123-10-golden.pdf" }, scope)).toBe(false);
    expect(inCleanupScope({ id: "d", fileName: "report.pdf" }, scope)).toBe(false);
  });

  it("limits stale cleanup to old namespaced documents", () => {
    const scope = cleanupScope(["node", "e2e.mjs", "cleanup", "--stale-hours", "6"]);
    const old = new Date(Date.now() - 7 * 3_600_000).toISOString();
    const fresh = new Date(Date.now() - 3_600_000).toISOString();
    expect(inCleanupScope({ id: "a", fileName: "e2e-1-golden.pdf", createdAt: old }, scope)).toBe(true);
    expect(inCleanupScope({ id: "b", fileName: "e2e-2-golden.pdf", createdAt: fresh }, scope)).toBe(false);
    expect(inCleanupScope({ id: "c", fileName: "e2e-3-golden.pdf" }, scope)).toBe(false);
    expect(inCleanupScope({ id: "d", fileName: "notes.pdf", createdAt: old }, scope)).toBe(false);
  });

  it("rejects unsafe run identifiers and stale windows", () => {
    vi.stubEnv("E2E_RUN_ID", "../all");
    expect(() => cleanupScope(["node", "e2e.mjs", "cleanup"])).toThrow(/invalid format/);
    expect(() => cleanupScope(["node", "e2e.mjs", "cleanup", "--stale-hours", "0"])).toThrow(/stale-hours/);
  });
});

describe("dedicated E2E user provisioning", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("E2E_SUPABASE_SECRET_KEY", "test-only-key");
    vi.stubEnv("E2E_USER_EMAIL", "e2e@example.test");
    vi.stubEnv("E2E_USER_PASSWORD", "test-only-password");
    admin.updateUserById.mockResolvedValue({ error: null });
    admin.createUser.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuses to modify an existing account without the dedicated marker", async () => {
    admin.listUsers.mockResolvedValue({ data: { users: [{ id: "real", email: "e2e@example.test", app_metadata: {} }] }, error: null });
    await expect(ensureUser()).rejects.toThrow(/without the dedicated E2E marker/);
    expect(admin.updateUserById).not.toHaveBeenCalled();
  });

  it("updates an already marked dedicated account", async () => {
    admin.listUsers.mockResolvedValue({ data: { users: [{ id: "e2e", email: "E2E@example.test", app_metadata: { test_account: "rag-steplab-e2e" } }] }, error: null });
    await ensureUser();
    expect(admin.updateUserById).toHaveBeenCalledWith("e2e", expect.objectContaining({ app_metadata: { test_account: "rag-steplab-e2e" } }));
  });

  it("creates and marks a missing account", async () => {
    admin.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
    await ensureUser();
    expect(admin.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "e2e@example.test", app_metadata: { test_account: "rag-steplab-e2e" } }));
  });
});
