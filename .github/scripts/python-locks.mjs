// backend/requirements*.in girdilerinden hash'li, platformdan bağımsız lock'ları üretir/denetler.
//   node .github/scripts/python-locks.mjs            → lock'ları yeniden üret (mevcut pin'ler korunur)
//   node .github/scripts/python-locks.mjs -- --upgrade-package pyjwt
//   node .github/scripts/python-locks.mjs --check    → CI: lock'lar girdilerle, hash'lerle ve birbirleriyle tutarlı mı
// Dependabot (`uv` ekosistemi) aynı başlık seçenekleriyle `.in` → `.txt` derlemesini kendisi yapar.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const backend = path.resolve(import.meta.dirname, "../../backend");
// Sıra önemli: diğer girdiler requirements.txt'yi constraint olarak kullanır.
const locks = ["requirements", "requirements-ci", "requirements-worker", "requirements-dev"];
const compileOptions = ["--universal", "--generate-hashes", "--python-version", "3.13"];

function compile(name, outputFile, extraArgs = []) {
  execFileSync("uv", ["pip", "compile", ...compileOptions, ...extraArgs, "--output-file", outputFile, `${name}.in`], {
    cwd: backend,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

function normalizeName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

// Hash'ler hariç "paket==sürüm ; marker" / "paket @ url ; marker" girdileri.
function pins(file) {
  const entries = new Map();
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!/^[A-Za-z0-9]/.test(line)) continue;
    const entry = line.replace(/\s*\\$/, "").trim();
    const name = normalizeName(entry.match(/^[A-Za-z0-9._-]+/)[0]);
    const value = `${name}${entry.slice(entry.match(/^[A-Za-z0-9._-]+(\[[^\]]*\])?/)[0].length)}`;
    entries.set(name, [...(entries.get(name) ?? []), value].sort());
  }
  return entries;
}

// Gereksinim satırı ("paket==sürüm ; marker" / "paket @ url ; marker") → sıralı hash listesi.
// Yorumlar (başlık, `# via`) karşılaştırılmaz.
function hashedEntries(text) {
  const entries = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const hash = line.match(/^\s+--hash=(\S+)/);
    if (hash) {
      if (current) entries.get(current).push(hash[1]);
      continue;
    }
    current = /^[A-Za-z0-9]/.test(line) ? line.replace(/\s*\\$/, "").trim() : null;
    if (current) entries.set(current, []);
  }
  for (const hashes of entries.values()) hashes.sort();
  return entries;
}

// uv mevcut çıktı dosyasındaki pin'leri ve hash'leri korur. Hash satırları silinmiş kopya verilince
// sürümler korunur, hash'ler ise index'ten (URL pin'lerinde URL'deki #sha256'dan) yeniden alınır.
function stripHashes(text) {
  return text.split(/\r?\n/)
    .filter((line) => !/^\s+--hash=/.test(line))
    .map((line) => line.replace(/\s*\\$/, ""))
    .join("\n");
}

// Marker'lar platform kümesine göre farklı yazılabilir; tutarlılıkta yalnız sürüm/URL karşılaştırılır.
function versions(values) {
  return [...new Set(values.map((value) => value.split(" ; ")[0]))].sort().join(", ");
}

function check() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "python-locks-"));
  const failures = [];
  try {
    for (const name of locks) {
      const committed = path.join(backend, `${name}.txt`);
      const regenerated = path.join(tempDir, `${name}.txt`);
      const committedText = readFileSync(committed, "utf8");
      writeFileSync(regenerated, stripHashes(committedText));
      compile(name, regenerated);
      const before = hashedEntries(committedText);
      const after = hashedEntries(readFileSync(regenerated, "utf8"));
      const unhashed = [...before].filter(([, hashes]) => hashes.length === 0).map(([entry]) => entry);
      if (unhashed.length) {
        failures.push(`backend/${name}.txt has requirements without --hash: ${unhashed.join(", ")}`);
      }
      const missing = [...after.keys()].filter((entry) => !before.has(entry));
      const stale = [...before.keys()].filter((entry) => !after.has(entry));
      if (missing.length || stale.length) {
        failures.push(`backend/${name}.txt is out of date with backend/${name}.in`
          + `\n  expected: ${missing.join(", ") || "-"}\n  committed: ${stale.join(", ") || "-"}`);
      }
      // Elle düzenlenmiş/eksik/eski hash; paket sürümü kilitlendikten sonra yeni dosya yüklediyse de
      // görünür (yeniden üretilmeli: pip yeni wheel'i seçerse hash kontrolü kurulumda düşer).
      const hashDrift = [...after]
        .filter(([entry, hashes]) => before.has(entry) && before.get(entry).join() !== hashes.join())
        .map(([entry]) => entry);
      if (hashDrift.length) {
        failures.push(`backend/${name}.txt hashes differ from the package index for: ${hashDrift.join(", ")}`);
      }
    }

    // Runtime pin'leri CI, worker ve dev lock'larında birebir aynı olmalı (test edilen = deploy edilen).
    const runtime = pins(path.join(backend, "requirements.txt"));
    for (const name of locks.slice(1)) {
      const other = pins(path.join(backend, `${name}.txt`));
      for (const [pkg, values] of runtime) {
        if (other.has(pkg) && versions(other.get(pkg)) !== versions(values)) {
          failures.push(`backend/${name}.txt pins ${versions(other.get(pkg))} but backend/requirements.txt pins ${versions(values)}`);
        }
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  if (failures.length) {
    for (const failure of failures) console.error(`::error::${failure}`);
    console.error("Regenerate with: node .github/scripts/python-locks.mjs");
    process.exit(1);
  }
  console.log(`Python locks are consistent (${locks.map((name) => `${name}.txt`).join(", ")}).`);
}

if (process.argv.includes("--check")) {
  check();
} else {
  const separator = process.argv.indexOf("--");
  const extraArgs = separator === -1 ? [] : process.argv.slice(separator + 1);
  for (const name of locks) compile(name, `${name}.txt`, extraArgs);
  console.log("Python locks regenerated. Review the diff and run the backend tests.");
}
