import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { LIVE_ORIGIN, verifyDeployment } from "./deployment-artifact-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const local = process.argv.includes("--local");
const baseUrlIndex = process.argv.indexOf("--base-url");
const explicitBaseUrl = baseUrlIndex >= 0 ? process.argv[baseUrlIndex + 1] : undefined;
if (baseUrlIndex >= 0 && !explicitBaseUrl) throw new Error("--base-url requires a URL");
if (local && explicitBaseUrl) throw new Error("Choose either --local or --base-url");
if (!local && !explicitBaseUrl) throw new Error(`Usage: smoke-deployment.mjs --local | --base-url ${LIVE_ORIGIN}`);

const baseUrl = explicitBaseUrl ?? "http://127.0.0.1:8787";
let server;
let output = "";

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolveExit) => server.once("exit", () => resolveExit(true)));
  if (process.platform === "win32") server.kill("SIGTERM");
  else {
    try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
  }
  const stopped = await Promise.race([exited, delay(5_000).then(() => false)]);
  if (stopped || server.exitCode !== null) return;
  if (process.platform === "win32") server.kill("SIGKILL");
  else {
    try { process.kill(-server.pid, "SIGKILL"); } catch { server.kill("SIGKILL"); }
  }
  const killed = await Promise.race([exited, delay(2_000).then(() => false)]);
  if (!killed && server.exitCode === null) throw new Error(`Wrangler dev did not stop cleanly (pid ${server.pid})`);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Wrangler dev exited before smoke testing:\n${output}`);
    try {
      const response = await globalThis.fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The local socket is expected to reject connections while Wrangler boots.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}\n${output}`);
}

try {
  if (local) {
    server = spawn(process.execPath, [join(root, "node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--ip", "127.0.0.1", "--port", "8787"], {
      cwd: root,
      detached: process.platform !== "win32",
      env: { ...process.env, CLOUDFLARE_API_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => { output += chunk; });
    server.stderr.on("data", (chunk) => { output += chunk; });
    await waitForServer();
  }
  const proof = await verifyDeployment({ baseUrl, distDirectory: dist });
  console.log(`Deployment smoke passed at ${baseUrl}: ${proof.manifest.files.length} files and ${proof.results.length} route/file responses matched SHA-256 and MIME.`);
} finally {
  await stopServer();
}
