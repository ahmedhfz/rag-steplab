import assert from "node:assert/strict";

const categories = ["frontend", "backend", "database", "modal", "docs_only", "full_ci"];

function classify(paths, forceFullCi = false) {
  const result = {
    frontend: false,
    backend: false,
    database: false,
    modal: false,
    docs_only: false,
    full_ci: forceFullCi,
  };
  let docs = paths.length > 0;

  for (const rawPath of paths) {
    const file = rawPath.trim().replaceAll("\\", "/");
    if (!file) continue;

    if (file.startsWith(".github/")) {
      result.full_ci = true;
      continue;
    }

    if (file === "supabase/config.toml" || file.startsWith("supabase/")) {
      result.database = true;
      docs = false;
      continue;
    }

    if (file === "scripts/check-migration-authority.mjs") {
      result.database = true;
      docs = false;
      continue;
    }

    if (file === "scripts/dev.mjs" || file === "scripts/smoke.mjs") {
      result.full_ci = true;
      docs = false;
      continue;
    }

    if (file === "backend/modal_app.py" || file.startsWith("backend/app/") || /^backend\/requirements[^/]*\.txt$/.test(file)) {
      result.backend = true;
      result.modal = true;
      if (file === "backend/app/main.py" || file === "backend/app/schemas.py") result.frontend = true;
      docs = false;
      continue;
    }

    if (file.startsWith("backend/tests/") || file === "backend/pyproject.toml") {
      result.backend = true;
      docs = false;
      continue;
    }

    if (
      file.startsWith("app/") ||
      file.startsWith("components/") ||
      file.startsWith("lib/") ||
      file.startsWith("test/") ||
      file.startsWith("public/") ||
      [
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
      ].includes(file)
    ) {
      result.frontend = true;
      docs = false;
      continue;
    }

    if (file === "AGENTS.md" || file === "README.md" || file.startsWith("docs/") || file.endsWith(".md")) {
      continue;
    }

    result.full_ci = true;
    docs = false;
  }

  result.docs_only = docs && !result.frontend && !result.backend && !result.database && !result.modal && !result.full_ci;
  return result;
}

function assertClassification(paths, expected) {
  const actual = classify(paths);
  for (const category of categories) assert.equal(actual[category], expected[category], `${paths.join(", ")} → ${category}`);
}

if (process.argv.includes("--self-test")) {
  assertClassification(["components/login-screen.tsx"], { frontend: true, backend: false, database: false, modal: false, docs_only: false, full_ci: false });
  assertClassification(["backend/app/auth.py"], { frontend: false, backend: true, database: false, modal: true, docs_only: false, full_ci: false });
  assertClassification(["backend/app/schemas.py"], { frontend: true, backend: true, database: false, modal: true, docs_only: false, full_ci: false });
  assertClassification(["supabase/migrations/20260821083157_auth_owner_strict.sql"], { frontend: false, backend: false, database: true, modal: false, docs_only: false, full_ci: false });
  assertClassification(["README.md"], { frontend: false, backend: false, database: false, modal: false, docs_only: true, full_ci: false });
  assertClassification([".github/workflows/ci.yml"], { frontend: false, backend: false, database: false, modal: false, docs_only: false, full_ci: true });
  assertClassification(["components/login-screen.tsx", "README.md"], { frontend: true, backend: false, database: false, modal: false, docs_only: false, full_ci: false });
  process.stdout.write("classification self-test passed\n");
} else {
  const forceFullCi = process.argv.includes("--full-ci");
  const result = classify((await new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => resolve(input.split(/\r?\n/)));
  })), forceFullCi);
  for (const category of categories) process.stdout.write(`${category}=${result[category]}\n`);
}

export { classify };
