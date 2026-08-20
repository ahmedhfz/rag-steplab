import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const toRepoPath = (filePath) => relative(root, filePath).split(sep).join("/");
const failures = [];

const requiredPaths = [
  "supabase/config.toml",
  "supabase/migrations",
];

for (const requiredPath of requiredPaths) {
  if (!existsSync(join(root, requiredPath))) {
    failures.push("Missing required path: " + requiredPath);
  }
}

for (const forbiddenPath of ["backend/alembic", "backend/alembic.ini"]) {
  if (existsSync(join(root, forbiddenPath))) {
    failures.push("Legacy migration path must not exist: " + forbiddenPath);
  }
}

const migrationsDir = join(root, "supabase", "migrations");
const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .filter((name) => statSync(join(migrationsDir, name)).isFile())
      .sort()
  : [];
const versionPattern = /^(\d{14})_[a-z0-9_]+\.sql$/;
const versions = new Set();

for (const fileName of migrationFiles) {
  const match = versionPattern.exec(fileName);
  if (!match) {
    failures.push("Invalid migration filename: supabase/migrations/" + fileName);
    continue;
  }
  if (versions.has(match[1])) {
    failures.push("Duplicate migration version: " + match[1]);
  }
  versions.add(match[1]);
}

const allowedHistoricalFiles = new Set([
  "docs/architecture/migrations.md",
  "supabase/tests/database/01_schema.sql",
  "supabase/migrations/20260820212643_rag_lab_production_baseline.sql",
  "supabase/migrations/20260820212718_remove_alembic_version.sql",
]);
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".codex",
  ".playwright-cli",
  ".playwright-mcp",
  ".pytest_cache",
  ".temp",
  "__pycache__",
  "node_modules",
  "output",
]);
const forbiddenLegacyReference =
  /\balembic_version\b|\b(?:from|import)\s+alembic\b|\balembic\s+(?:upgrade|revision|downgrade|history|current)\b|(?:^|[\\/])backend[\\/]alembic(?:[\\/]|\.ini)|(?:^|[\\/])alembic\.ini\b/gi;

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(filePath);
      continue;
    }
    const repoPath = toRepoPath(filePath);
    if (
      repoPath === "scripts/check-migration-authority.mjs" ||
      allowedHistoricalFiles.has(repoPath)
    ) {
      continue;
    }
    let content;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    if (forbiddenLegacyReference.test(content)) {
      failures.push("Legacy migration reference found: " + repoPath);
    }
    forbiddenLegacyReference.lastIndex = 0;
  }
}

walk(root);

if (existsSync(join(root, "backend", "requirements.txt"))) {
  const requirements = readFileSync(
    join(root, "backend", "requirements.txt"),
    "utf8",
  );
  if (/^\s*alembic(?:[<>=!~]|\s|$)/im.test(requirements)) {
    failures.push("Alembic remains in backend/requirements.txt");
  }
}

const config = existsSync(join(root, "supabase", "config.toml"))
  ? readFileSync(join(root, "supabase", "config.toml"), "utf8")
  : "";
for (const requiredConfig of ["project_id", "[db.migrations]"]) {
  if (!config.includes(requiredConfig)) {
    failures.push("Supabase config is missing " + requiredConfig);
  }
}
if (/SUPABASE_(?:ACCESS_TOKEN|DB_PASSWORD)|service_role|postgres(?:ql)?:\/\//i.test(config)) {
  failures.push("Secret or remote credential-shaped value found in supabase/config.toml");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => "- " + failure).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Migration authority check passed (" +
      migrationFiles.length +
      " Supabase migrations).",
  );
}
