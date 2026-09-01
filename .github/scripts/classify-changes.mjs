import assert from "node:assert/strict";

const categories = [
  "node",
  "frontend",
  "frontend_full_tests",
  "backend",
  "database",
  "migration",
  "auth_e2e",
  "critical_e2e",
  "playwright_list",
  "modal_deploy",
  "worker_provider",
  "docs_only",
];

const frontendRoots = ["app/", "components/", "lib/", "test/", "public/"];
const frontendConfig = new Set([
  "package.json",
  "package-lock.json",
  "proxy.ts",
  "next.config.ts",
  "postcss.config.mjs",
  "eslint.config.mjs",
  "tsconfig.json",
  "vitest.config.mts",
  "components.json",
  "next-env.d.ts",
]);
const fullVitestFallback = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vitest.config.mts",
  "test/setup.ts",
]);
const authPaths = [
  "app/auth/",
  "app/login/",
  "components/auth-provider.tsx",
  "components/auth-shell.tsx",
  "components/login-screen.tsx",
  "components/reset-password-screen.tsx",
  "lib/supabase/",
  "proxy.ts",
  "e2e/auth/",
  "e2e/setup/",
];
const criticalContractPaths = [
  "backend/app/main.py",
  "backend/app/schemas.py",
  "backend/app/document_pipelines.py",
  "backend/app/pipeline.py",
  "components/document-pipeline-provider.tsx",
  "components/document-upload-panel.tsx",
  "components/parse-screen.tsx",
  "components/chunks-pipeline.tsx",
  "components/pipeline-stage-screens.tsx",
  "components/retrieval-screen.tsx",
  "components/source-inspector.tsx",
  "lib/document-api.ts",
  "lib/document-parse-types.ts",
  "lib/rag-api.ts",
  "lib/rag-api-types.ts",
  "e2e/smoke/document-lifecycle.spec.ts",
  "e2e/smoke/rag-inspection.spec.ts",
  "e2e/support/seeded-api.ts",
  "e2e/support/seeded-workspace.ts",
  "scripts/e2e.mjs",
];
const workerProviderPaths = [
  "backend/modal_app.py",
  "backend/requirements-worker.txt",
  "backend/app/gemini.py",
  "backend/app/parser.py",
  "backend/app/pipeline.py",
];

function matches(file, candidates) {
  return candidates.some((candidate) => candidate.endsWith("/") ? file.startsWith(candidate) : file === candidate);
}

function classify(paths) {
  const result = Object.fromEntries(categories.map((category) => [category, false]));
  let hasFile = false;
  let docsOnly = true;

  for (const rawPath of paths) {
    const file = rawPath.trim().replaceAll("\\", "/");
    if (!file) continue;
    hasFile = true;

    if (file === "AGENTS.md" || file === "README.md" || file.startsWith("docs/") || file.endsWith(".md")) continue;
    docsOnly = false;

    if (file.startsWith(".github/")) continue;

    if (file === "supabase/config.toml" || file.startsWith("supabase/")) {
      result.database = true;
      result.migration ||= file.startsWith("supabase/migrations/");
      result.critical_e2e ||= result.migration;
      continue;
    }

    if (file === "scripts/check-migration-authority.mjs") {
      result.node = true;
      result.database = true;
      continue;
    }

    if (file.startsWith("backend/")) {
      result.backend = true;
      result.modal_deploy ||= file === "backend/modal_app.py" || file === "backend/requirements.txt" || file === "backend/requirements-worker.txt" || file.startsWith("backend/app/");
      result.worker_provider ||= matches(file, workerProviderPaths);
      result.critical_e2e ||= matches(file, criticalContractPaths);
      continue;
    }

    if (file.startsWith("e2e/") || file === "playwright.config.ts" || file === "scripts/e2e.mjs") {
      result.node = true;
      result.playwright_list = true;
      result.auth_e2e ||= matches(file, authPaths);
      result.critical_e2e ||= matches(file, criticalContractPaths);
      continue;
    }

    if (frontendRoots.some((root) => file.startsWith(root)) || frontendConfig.has(file)) {
      result.node = true;
      result.frontend = true;
      result.frontend_full_tests ||= fullVitestFallback.has(file);
      result.auth_e2e ||= matches(file, authPaths);
      result.critical_e2e ||= matches(file, criticalContractPaths);
      continue;
    }

    if (file === "scripts/smoke.mjs" || file === "scripts/dev.mjs") {
      result.node = true;
      result.frontend = true;
      result.frontend_full_tests = true;
      continue;
    }

    // Bilinmeyen source/config dosyalarında güvenli ama browser'sız fallback.
    result.node = true;
    result.frontend = true;
    result.frontend_full_tests = true;
  }

  if (result.auth_e2e || result.critical_e2e || result.playwright_list) result.node = true;
  result.docs_only = hasFile && docsOnly;
  return result;
}

function expected(overrides) {
  return { ...Object.fromEntries(categories.map((category) => [category, false])), ...overrides };
}

function assertClassification(paths, overrides) {
  assert.deepEqual(classify(paths), expected(overrides), paths.join(", "));
}

if (process.argv.includes("--self-test")) {
  assertClassification(["README.md"], { docs_only: true });
  assertClassification(["components/status-indicator.tsx"], { node: true, frontend: true });
  assertClassification(["package-lock.json"], { node: true, frontend: true, frontend_full_tests: true });
  assertClassification(["components/login-screen.tsx"], { node: true, frontend: true, auth_e2e: true });
  assertClassification(["backend/tests/test_main.py"], { backend: true });
  assertClassification(["backend/app/auth.py"], { backend: true, modal_deploy: true });
  assertClassification(["backend/app/schemas.py"], { node: true, backend: true, critical_e2e: true, modal_deploy: true });
  assertClassification(["backend/app/parser.py"], { backend: true, modal_deploy: true, worker_provider: true });
  assertClassification(["supabase/migrations/20260821083157_auth_owner_strict.sql"], { node: true, database: true, migration: true, critical_e2e: true });
  assertClassification(["e2e/visual/figma-production.spec.ts"], { node: true, playwright_list: true });
  assertClassification(["e2e/smoke/rag-inspection.spec.ts"], { node: true, critical_e2e: true, playwright_list: true });
  assertClassification(
    ["components/retrieval-screen.tsx", "backend/app/schemas.py", "supabase/migrations/20260821083157_auth_owner_strict.sql"],
    { node: true, frontend: true, backend: true, database: true, migration: true, critical_e2e: true, modal_deploy: true },
  );
  assertClassification([".github/workflows/ci.yml"], {});
  process.stdout.write("classification self-test passed\n");
} else {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const result = classify(input.split(/\r?\n/));
  for (const category of categories) process.stdout.write(`${category}=${result[category]}\n`);
}

export { categories, classify };
