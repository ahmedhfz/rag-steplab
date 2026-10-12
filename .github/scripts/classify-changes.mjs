import assert from "node:assert/strict";

const categories = [
  "node",
  "frontend",
  "frontend_full_tests",
  "backend",
  "database",
  "migration",
  "lint_full",
  "auth_e2e",
  "seeded_e2e",
  "playwright_list",
  "modal_deploy",
  "modal_image",
  "worker_provider",
  "production_visual",
  "workflow_config",
  "dependabot_config",
  "docs_only",
];

// docs_only dışındaki her değişiklik en az bir kontrol üretmelidir; aksi classifier açığıdır.
const checkCategories = categories.filter((category) => category !== "docs_only");

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
  "next-env.d.ts",
]);
// ESLint kuralı/sürümü veya TS ayarı değişince yalnız değişen dosyalar değil, tüm repo lintlenir.
const fullLintTriggers = new Set([
  "package.json",
  "package-lock.json",
  "eslint.config.mjs",
  "tsconfig.json",
  ".nvmrc",
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
  "e2e/support/auth.ts",
];
// Seeded smoke API'yi mock'lar ve PR Preview'ı production backend'e bağlıdır; backend/migration
// değişikliği bu suite ile doğrulanamaz (backend testleri ve DB job'u kapsar).
const seededContractPaths = [
  "package.json",
  "next.config.ts",
  "app/globals.css",
  "app/layout.tsx",
  "public/samples/",
  "lib/sample-documents.ts",
  "components/sample-document-button.tsx",
  "components/document-pipeline-provider.tsx",
  "components/document-upload-panel.tsx",
  "components/documents-screen.tsx",
  "components/parse-screen.tsx",
  "components/chunks-pipeline.tsx",
  "components/pipeline-context-bar.tsx",
  "components/pipeline-stage-screens.tsx",
  "components/retrieval-screen.tsx",
  "components/source-inspector.tsx",
  "components/overview-screen.tsx",
  "components/evaluation-screen.tsx",
  "components/preferences-provider.tsx",
  "components/settings-screen.tsx",
  "lib/document-api.ts",
  "lib/document-parse-types.ts",
  "lib/overview-view-model.ts",
  "lib/overview-journey.ts",
  "lib/theme.ts",
  "lib/rag-api.ts",
  "lib/rag-api-types.ts",
  "e2e/smoke/",
  "e2e/support/",
  "e2e/setup/",
  "app/page.tsx",
  "app/documents/page.tsx",
  "app/parse/page.tsx",
  "app/chunking/page.tsx",
  "app/embeddings/page.tsx",
  "app/playground/page.tsx",
  "app/evaluation/page.tsx",
  "scripts/e2e.mjs",
  "playwright.config.ts",
];
const productionVisualPaths = [
  "e2e/visual/production-visual.spec.ts",
  "e2e/visual/visual-diff.mjs",
  "e2e/visual/reference/production/",
];
const productionVisualSourcePaths = [
  "app/globals.css",
  "app/layout.tsx",
  "app/page.tsx",
  "app/documents/page.tsx",
  "app/parse/page.tsx",
  "app/chunking/page.tsx",
  "app/embeddings/page.tsx",
  "app/playground/page.tsx",
  "app/evaluation/page.tsx",
  "app/settings/page.tsx",
  "components/app-shell.tsx",
  "components/auth-shell.tsx",
  "components/brand-mark.tsx",
  "components/chunks-pipeline.tsx",
  "components/document-library.tsx",
  "components/document-pipeline-provider.tsx",
  "components/documents-screen.tsx",
  "components/evaluation-screen.tsx",
  "components/login-hero.tsx",
  "components/login-screen.tsx",
  "components/overview-screen.tsx",
  "components/page-transition.tsx",
  "components/parse-screen.tsx",
  "components/pipeline-context-bar.tsx",
  "components/pipeline-learning-ui.tsx",
  "components/pipeline-stage-screens.tsx",
  "components/preferences-provider.tsx",
  "components/reset-password-screen.tsx",
  "components/retrieval-screen.tsx",
  "components/settings-screen.tsx",
  "components/source-inspector.tsx",
  "components/status-indicator.tsx",
  "components/ui/",
  "lib/overview-view-model.ts",
  "lib/overview-journey.ts",
  "lib/theme.ts",
];
const modalImagePaths = [
  "backend/requirements.txt",
  "backend/app/ocr.py",
  "backend/app/config.py",
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

    if (file === ".github/dependabot.yml") {
      result.dependabot_config = true;
      continue;
    }

    if (file === ".github/scripts/python-locks.mjs") {
      result.workflow_config = true;
      result.backend = true;
      continue;
    }

    if (file.startsWith(".github/")) {
      result.workflow_config = true;
      continue;
    }

    if (file === "supabase/config.toml" || file.startsWith("supabase/")) {
      result.database = true;
      result.migration ||= file.startsWith("supabase/migrations/");
      continue;
    }

    if (file === ".python-version") {
      result.backend = true;
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
      result.modal_image ||= matches(file, workerProviderPaths) || matches(file, modalImagePaths);
      continue;
    }

    if (file.startsWith("e2e/") || file === "playwright.config.ts" || file === "scripts/e2e.mjs") {
      result.node = true;
      result.playwright_list = true;
      result.auth_e2e ||= matches(file, authPaths);
      result.seeded_e2e ||= matches(file, seededContractPaths);
      result.production_visual ||= matches(file, productionVisualPaths);
      continue;
    }

    if (frontendRoots.some((root) => file.startsWith(root)) || frontendConfig.has(file)) {
      result.node = true;
      result.frontend = true;
      result.frontend_full_tests ||= fullVitestFallback.has(file);
      result.lint_full ||= fullLintTriggers.has(file);
      result.auth_e2e ||= matches(file, authPaths);
      result.seeded_e2e ||= matches(file, seededContractPaths);
      result.production_visual ||= matches(file, productionVisualSourcePaths);
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
    result.lint_full ||= fullLintTriggers.has(file);
  }

  if (result.auth_e2e || result.seeded_e2e || result.playwright_list) result.node = true;
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
  assertClassification(["components/status-indicator.tsx"], { node: true, frontend: true, production_visual: true });
  assertClassification(["package-lock.json"], { node: true, frontend: true, frontend_full_tests: true, lint_full: true });
  assertClassification(["package.json"], { node: true, frontend: true, frontend_full_tests: true, lint_full: true, seeded_e2e: true });
  assertClassification(["eslint.config.mjs"], { node: true, frontend: true, lint_full: true });
  assertClassification(["next.config.ts"], { node: true, frontend: true, seeded_e2e: true });
  assertClassification([".nvmrc"], { node: true, frontend: true, frontend_full_tests: true, lint_full: true });
  assertClassification([".python-version"], { backend: true });
  assertClassification(["public/samples/rag-steplab-sample-city-bikes.pdf"], { node: true, frontend: true, seeded_e2e: true });
  assertClassification(["components/login-screen.tsx"], { node: true, frontend: true, auth_e2e: true, production_visual: true });
  assertClassification(["components/brand-mark.tsx"], { node: true, frontend: true, production_visual: true });
  assertClassification(["components/login-hero.tsx"], { node: true, frontend: true, production_visual: true });
  assertClassification(["app/globals.css"], { node: true, frontend: true, seeded_e2e: true, production_visual: true });
  assertClassification(["lib/theme.ts"], { node: true, frontend: true, seeded_e2e: true, production_visual: true });
  assertClassification(["components/preferences-provider.tsx"], { node: true, frontend: true, seeded_e2e: true, production_visual: true });
  assertClassification(["backend/tests/test_main.py"], { backend: true });
  assertClassification(["backend/requirements-ci.in"], { backend: true });
  assertClassification(["backend/app/auth.py"], { backend: true, modal_deploy: true });
  assertClassification(["backend/app/schemas.py"], { backend: true, modal_deploy: true });
  assertClassification(["backend/app/ocr.py"], { backend: true, modal_deploy: true, modal_image: true });
  assertClassification(["backend/requirements.txt"], { backend: true, modal_deploy: true, modal_image: true });
  assertClassification(["backend/app/parser.py"], { backend: true, modal_deploy: true, modal_image: true, worker_provider: true });
  assertClassification(["backend/modal_app.py"], { backend: true, modal_deploy: true, modal_image: true, worker_provider: true });
  assertClassification(["supabase/migrations/20260821083157_auth_owner_strict.sql"], { database: true, migration: true });
  assertClassification(["e2e/visual/production-visual.spec.ts"], { node: true, playwright_list: true, production_visual: true });
  assertClassification(["e2e/visual/reference/production/overview.png"], { node: true, playwright_list: true, production_visual: true });
  assertClassification(["e2e/smoke/rag-inspection.spec.ts"], { node: true, seeded_e2e: true, playwright_list: true });
  assertClassification(["e2e/smoke/navigation.spec.ts"], { node: true, seeded_e2e: true, playwright_list: true });
  assertClassification(["components/overview-screen.tsx"], { node: true, frontend: true, seeded_e2e: true, production_visual: true });
  assertClassification(["components/evaluation-screen.tsx"], { node: true, frontend: true, seeded_e2e: true, production_visual: true });
  assertClassification(["app/page.tsx"], { node: true, frontend: true, seeded_e2e: true, production_visual: true });
  assertClassification(["e2e/support/auth.ts"], { node: true, auth_e2e: true, seeded_e2e: true, playwright_list: true });
  assertClassification(["e2e/support/seeded-api.ts"], { node: true, seeded_e2e: true, playwright_list: true });
  assertClassification(["playwright.config.ts"], { node: true, seeded_e2e: true, playwright_list: true });
  assertClassification(["e2e/visual/visual-diff.mjs"], { node: true, playwright_list: true, production_visual: true });
  assertClassification(["lib/overview-view-model.ts"], { node: true, frontend: true, seeded_e2e: true, production_visual: true });
  assertClassification(
    ["components/retrieval-screen.tsx", "backend/app/schemas.py", "supabase/migrations/20260821083157_auth_owner_strict.sql"],
    { node: true, frontend: true, backend: true, database: true, migration: true, seeded_e2e: true, modal_deploy: true, production_visual: true },
  );
  assertClassification([".github/workflows/ci.yml"], { workflow_config: true });
  assertClassification([".github/CODEOWNERS"], { workflow_config: true });
  assertClassification([".github/dependabot.yml"], { dependabot_config: true });
  assertClassification([".github/scripts/python-locks.mjs"], { backend: true, workflow_config: true });
  process.stdout.write("classification self-test passed\n");
} else {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  const paths = input.split(/\r?\n/).filter((line) => line.trim());
  const result = classify(paths);
  if (paths.length > 0 && !result.docs_only && !checkCategories.some((category) => result[category])) {
    process.stderr.write("Classifier produced no checks for a non-documentation change.\n");
    process.exit(1);
  }
  for (const category of categories) process.stdout.write(`${category}=${result[category]}\n`);
}

export { categories, classify };
