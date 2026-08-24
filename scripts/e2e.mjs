import { createHash, randomBytes } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile?.(".env.e2e.local");
} catch {}
try {
  process.loadEnvFile?.(".env.local");
} catch {}
try {
  process.loadEnvFile?.(".env");
} catch {}

const command = process.argv[2];
const fixturePath = path.resolve("e2e/fixtures/generated/rag-steplab-golden.pdf");
const namespacePrefix = "e2e-";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required. Do not print secret values in logs.`);
  return value;
}

function pdfText(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function textPage(lines) {
  const commands = ["BT", "/F1 11 Tf", "72 760 Td"];
  lines.forEach((line, index) => {
    if (index > 0) commands.push("0 -24 Td");
    commands.push(`(${pdfText(line)}) Tj`);
  });
  commands.push("ET");
  return `${commands.join("\n")}\n`;
}

function buildPdf() {
  const pageOne = textPage([
    "RAG StepLab Golden Fixture",
    "Purpose",
    "This deterministic PDF validates the real RAG learning pipeline.",
    "Golden fact: The laboratory beacon code is ORBIT-731.",
    "Checklist",
    "1. Parse the source without OCR.",
    "2. Preserve page provenance and citations.",
    "3. Retrieve ORBIT-731 from this page.",
  ]);
  const pageTwo = textPage([
    "Stable Reference Table",
    "Field | Value",
    "Beacon | ORBIT-731",
    "Owner | RAG StepLab",
    "Expected source page | 1",
    "The stable answer must cite the source containing ORBIT-731.",
  ]);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(pageOne)} >>\nstream\n${pageOne}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${Buffer.byteLength(pageTwo)} >>\nstream\n${pageTwo}endstream`,
  ];
  let body = "%PDF-1.4\n% deterministic-rag-steplab-fixture\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /ID [<${createHash("sha256").update(body).digest("hex").slice(0, 32)}> <${"0".repeat(32)}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

async function createFixture() {
  await mkdir(path.dirname(fixturePath), { recursive: true });
  const expected = buildPdf();
  let current = null;
  try {
    current = await readFile(fixturePath);
  } catch {}
  if (!current?.equals(expected)) await writeFile(fixturePath, expected);
  console.log(`Deterministic E2E PDF ready (${expected.length} bytes, 2 pages, marker ORBIT-731).`);
}

function adminClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.E2E_SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error("SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL is required.");
  if (!secret) throw new Error("E2E_SUPABASE_SECRET_KEY or SUPABASE_SECRET_KEY is required.");
  return { url, client: createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } }) };
}

async function findUser(client, email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match;
    if (data.users.length < 100) return null;
  }
  throw new Error("E2E user lookup exceeded the safe pagination limit.");
}

async function ensureUser() {
  const { client } = adminClient();
  const email = required("E2E_USER_EMAIL");
  const password = required("E2E_USER_PASSWORD");
  const existing = await findUser(client, email);
  const attributes = {
    email,
    password,
    email_confirm: true,
    app_metadata: { ...(existing?.app_metadata ?? {}), test_account: "rag-steplab-e2e" },
  };
  const result = existing
    ? await client.auth.admin.updateUserById(existing.id, attributes)
    : await client.auth.admin.createUser(attributes);
  if (result.error) throw result.error;
  console.log(existing ? "Dedicated E2E user verified and updated." : "Dedicated E2E user created and confirmed.");
}

function setGitHubSecret(name, value) {
  const result = spawnSync("gh", ["secret", "set", name], { input: value, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`GitHub secret ${name} could not be configured.`);
}

async function bootstrap() {
  const projectRef = process.env.SUPABASE_PROJECT_REF ?? "dronqqospsuhnjjitqls";
  if (!/^[a-z]{20}$/.test(projectRef)) throw new Error("SUPABASE_PROJECT_REF has an invalid format.");
  const args = ["projects", "api-keys", "--project-ref", projectRef, "--reveal", "--output", "json"];
  const raw = process.platform === "win32"
    ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `supabase ${args.join(" ")}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
    : execFileSync("supabase", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const keys = JSON.parse(raw);
  const secret = keys.find((item) => item.type === "secret" && item.name === "default")?.api_key
    ?? keys.find((item) => item.name === "service_role")?.api_key;
  if (!secret) throw new Error("A server-side Supabase secret key could not be obtained from the authenticated CLI.");
  const email = process.env.E2E_USER_EMAIL ?? "rag-steplab-e2e@ahmedhfz.dev";
  const password = process.env.E2E_USER_PASSWORD ?? `E2E-${randomBytes(24).toString("base64url")}aA1!`;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? `https://${projectRef}.supabase.co`;

  Object.assign(process.env, { E2E_USER_EMAIL: email, E2E_USER_PASSWORD: password, E2E_SUPABASE_SECRET_KEY: secret, SUPABASE_URL: supabaseUrl });
  await ensureUser();
  const localEnv = [
    `E2E_USER_EMAIL=${email}`,
    `E2E_USER_PASSWORD=${password}`,
    `E2E_SUPABASE_SECRET_KEY=${secret}`,
    `SUPABASE_URL=${supabaseUrl}`,
    "",
  ].join("\n");
  await writeFile(path.resolve(".env.e2e.local"), localEnv, { mode: 0o600 });

  if (process.env.E2E_BOOTSTRAP_GITHUB === "true") {
    setGitHubSecret("E2E_USER_EMAIL", email);
    setGitHubSecret("E2E_USER_PASSWORD", password);
    setGitHubSecret("E2E_SUPABASE_SECRET_KEY", secret);
    console.log("Dedicated E2E secrets configured in GitHub Actions.");
  }
  console.log("Local ignored E2E environment is ready.");
}

function assertCleanupTarget(url) {
  const target = process.env.E2E_TARGET ?? "test";
  const parsed = new URL(url);
  const productionProjectRef = process.env.E2E_PRODUCTION_PROJECT_REF
    ?? process.env.SUPABASE_PROJECT_REF
    ?? "dronqqospsuhnjjitqls";
  const productionHost = `${productionProjectRef}.supabase.co`;
  if (parsed.hostname === productionHost && target !== "production") {
    throw new Error("Cleanup refused: the production Supabase target must be declared with E2E_TARGET=production.");
  }
  if ((target === "production" || parsed.hostname === productionHost)
    && process.env.E2E_ALLOW_PRODUCTION_CLEANUP !== "true") {
    throw new Error("Production cleanup requires E2E_ALLOW_PRODUCTION_CLEANUP=true.");
  }
}

async function cleanup() {
  const { url, client } = adminClient();
  assertCleanupTarget(url);
  const email = required("E2E_USER_EMAIL");
  const password = required("E2E_USER_PASSWORD");
  const user = await findUser(client, email);
  if (!user || user.app_metadata?.test_account !== "rag-steplab-e2e") {
    throw new Error("Cleanup refused: the dedicated user marker is missing.");
  }

  const { data: session, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError || !session.session?.access_token) throw new Error("Cleanup could not authenticate the dedicated E2E user.");
  const apiBaseUrl = required("E2E_API_BASE_URL").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${session.session.access_token}` };
  const response = await fetch(`${apiBaseUrl}/documents`, { headers });
  if (!response.ok) throw new Error(`Cleanup document lookup failed with HTTP ${response.status}.`);
  const payload = await response.json();
  const documents = Array.isArray(payload?.items) ? payload.items : [];
  const namespaced = documents.filter((document) => typeof document?.id === "string"
    && typeof document?.fileName === "string"
    && document.fileName.startsWith(namespacePrefix));
  for (const document of namespaced) {
    const deleted = await fetch(`${apiBaseUrl}/documents/${encodeURIComponent(document.id)}`, { method: "DELETE", headers });
    if (deleted.status !== 204) throw new Error(`Namespaced cleanup failed with HTTP ${deleted.status}.`);
  }
  console.log(`Namespaced E2E cleanup completed (${namespaced.length} documents).`);
}

async function waitForDeployment() {
  const repository = required("GITHUB_REPOSITORY");
  const sha = process.env.DEPLOYMENT_SHA ?? required("GITHUB_SHA");
  const token = required("GITHUB_TOKEN");
  const environment = process.env.DEPLOYMENT_ENVIRONMENT ?? "Preview";
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
  const api = `https://api.github.com/repos/${repository}`;
  for (let attempt = 1; attempt <= 48; attempt += 1) {
    const deploymentsResponse = await fetch(`${api}/deployments?sha=${encodeURIComponent(sha)}&per_page=50`, { headers });
    if (!deploymentsResponse.ok) throw new Error(`GitHub deployments lookup failed with HTTP ${deploymentsResponse.status}.`);
    const deployments = await deploymentsResponse.json();
    const candidates = deployments.filter((item) => String(item.environment ?? "").toLowerCase().includes(environment.toLowerCase()));
    for (const deployment of candidates) {
      const statusResponse = await fetch(`${api}/deployments/${deployment.id}/statuses?per_page=20`, { headers });
      if (!statusResponse.ok) throw new Error(`GitHub deployment status lookup failed with HTTP ${statusResponse.status}.`);
      const statuses = await statusResponse.json();
      const latest = statuses[0];
      if (latest?.state === "failure" || latest?.state === "error") throw new Error(`${environment} deployment failed for the tested SHA.`);
      if (latest?.state !== "success") continue;
      const url = latest.environment_url ?? (String(latest.target_url ?? "").includes(".vercel.app") ? latest.target_url : null);
      if (!url) continue;
      const output = process.env.GITHUB_OUTPUT;
      if (!output) throw new Error("GITHUB_OUTPUT is required in CI.");
      await writeFile(output, `url=${url}\n`, { flag: "a" });
      console.log(`${environment} deployment is ready for E2E.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error(`No ready ${environment} Vercel deployment was found for the tested SHA.`);
}

if (command === "fixture") await createFixture();
else if (command === "bootstrap") await bootstrap();
else if (command === "ensure-user") await ensureUser();
else if (command === "cleanup") await cleanup();
else if (command === "wait-deployment") await waitForDeployment();
else if (command === "run-id") console.log(`e2e-${Date.now()}-${randomBytes(3).toString("hex")}`);
else throw new Error("Usage: node scripts/e2e.mjs <fixture|bootstrap|ensure-user|cleanup|wait-deployment|run-id>");
