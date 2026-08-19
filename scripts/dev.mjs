import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const nextCli = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
const backendPython = resolve(
  projectRoot,
  "backend",
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);

if (!existsSync(nextCli)) {
  console.error("[dev] Frontend dependencies are missing. Run: npm install");
  process.exit(1);
}

if (!existsSync(backendPython)) {
  console.error("[dev] Backend virtual environment is missing. Follow backend/README.md first.");
  process.exit(1);
}

const services = [];
let shuttingDown = false;

function stopService(child) {
  if (!child.pid || child.exitCode !== null) return;

  if (process.platform === "win32") {
    // Uvicorn reload bir alt proses açtığı için yalnız parent PID'yi kapatmak portu açık bırakabilir.
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  child.kill("SIGTERM");
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const service of services) stopService(service.child);
  process.exitCode = exitCode;
}

function startService(name, command, args) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });

  services.push({ name, child });

  child.on("error", (error) => {
    console.error(`[dev] ${name} could not start: ${error.message}`);
    shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    const reason = signal ? `signal ${signal}` : `exit code ${code ?? 1}`;
    console.error(`[dev] ${name} stopped (${reason}). Stopping the other service.`);
    shutdown(code ?? 1);
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => {
  for (const service of services) stopService(service.child);
});

console.log("[dev] Starting Next.js on http://localhost:3000");
console.log("[dev] Starting FastAPI on http://127.0.0.1:8000");

startService("frontend", process.execPath, [nextCli, "dev"]);
startService("backend", backendPython, [
  "-m",
  "uvicorn",
  "app.main:app",
  "--app-dir",
  "backend",
  "--reload",
  "--port",
  "8000",
]);
