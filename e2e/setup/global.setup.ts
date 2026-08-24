import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { request } from "@playwright/test";

const bypassStatePath = path.resolve("output/playwright/.auth/vercel-bypass.json");

export default async function globalSetup() {
  execFileSync(process.execPath, [path.resolve("scripts/e2e.mjs"), "fixture"], { stdio: "inherit" });

  await mkdir(path.dirname(bypassStatePath), { recursive: true });

  const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const needsVercelBypass = /\.vercel\.app(?:\/|$)/i.test(baseURL);

  if (!needsVercelBypass) {
    await writeFile(bypassStatePath, JSON.stringify({ cookies: [], origins: [] }));
    return;
  }

  if (!bypassSecret) {
    throw new Error(
      "Protected Vercel Preview E2E requires VERCEL_AUTOMATION_BYPASS_SECRET.",
    );
  }

  // Bypass yalnız API context'inde kurulur; secret URL, trace veya browser storage'a yazılmaz.
  const bypassContext = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      "x-vercel-protection-bypass": bypassSecret,
      "x-vercel-set-bypass-cookie": "true",
    },
  });

  try {
    const response = await bypassContext.get("/");
    if (!response.ok() || /vercel\.com\/login/i.test(response.url())) {
      throw new Error(`Vercel automation bypass failed with HTTP ${response.status()}.`);
    }

    await bypassContext.storageState({ path: bypassStatePath });
  } finally {
    await bypassContext.dispose();
  }
}
