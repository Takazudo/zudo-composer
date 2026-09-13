// @ts-check

// Run the disposable editor browser lane against one named demo host. With no
// name, each editor artifact is served and tested serially: every invocation
// owns the machine-global 4175 port and no two hosts may share it.

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { DEMO_EDITOR_HOSTS, resolveDemoEditorHost } from "./demo-editor-hosts.mjs";
import { verifyDemoEditorArtifact } from "./hosted-demo/artifact.mjs";
import { startHostedDemoStaticServer } from "./hosted-demo/static-server.mjs";

const root = resolve(import.meta.dirname, "..");
const config = resolve(root, "playwright.demo-editor.config.ts");
const PORT = 4175;
const names = /** @type {readonly string[]} */ (Object.keys(DEMO_EDITOR_HOSTS));

/** @typedef {{ status: number | null, signal: NodeJS.Signals | null }} RunResult */
/** @typedef {import("node:child_process").ChildProcess} ChildProcess */

const argumentsForRunner = process.argv.slice(2);
const requestedName = argumentsForRunner[0] && argumentsForRunner[0] !== "--" && !argumentsForRunner[0].startsWith("-")
  ? argumentsForRunner.shift()
  : undefined;
const playwrightArgs = argumentsForRunner.filter((argument) => argument !== "--");

if (requestedName !== undefined && !names.includes(requestedName)) {
  throw new Error(`Usage: pnpm test:browser:demo-editor [sample|shop|landing|blog] [-- playwright options]`);
}
const hosts = requestedName === undefined ? [...names] : [requestedName];

/** @type {ChildProcess | null} */
let runningChild = null;
/** @type {Awaited<ReturnType<typeof startHostedDemoStaticServer>> | undefined} */
let staticServer;
let stopping = false;

/** @param {string} command @param {string[]} args @param {import("node:child_process").SpawnOptions} options */
function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    runningChild = child;
    child.on("error", (error) => {
      if (runningChild === child) runningChild = null;
      reject(error);
    });
    child.on("close", (status, signal) => {
      if (runningChild === child) runningChild = null;
      resolveRun({ status, signal });
    });
  });
}

/** @param {string} value */
function assertBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch (error) { throw new Error(`DEMO_EDITOR_BASE_URL must be an absolute HTTP(S) URL: ${value}`, { cause: error }); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`DEMO_EDITOR_BASE_URL must use HTTP(S): ${value}`);
}

/** @param {NodeJS.Signals} signal */
function stop(signal) {
  if (stopping) return;
  stopping = true;
  runningChild?.kill(signal);
  void staticServer?.close().catch(() => undefined);
}

const handleSigint = () => stop("SIGINT");
const handleSigterm = () => stop("SIGTERM");
process.once("SIGINT", handleSigint);
process.once("SIGTERM", handleSigterm);

const requestedBase = process.env.DEMO_EDITOR_BASE_URL?.trim();
if (requestedBase) assertBaseUrl(requestedBase);

let failed = false;
try {
  for (const name of hosts) {
    if (stopping) break;
    const hostDir = resolveDemoEditorHost(name);
    const artifact = resolve(hostDir, "dist-editor");
    const verified = await verifyDemoEditorArtifact({ directory: artifact });
    staticServer = undefined;
    if (!requestedBase) staticServer = await startHostedDemoStaticServer({ directory: artifact, port: PORT });
    const baseURL = requestedBase ?? staticServer?.url;
    if (!baseURL) throw new Error("Demo editor server did not provide a base URL.");

    console.log(`\n[demo-editor] ${name}: ${verified.manifest.routes.length} routes, ${Object.keys(verified.manifest.assets).length} assets on ${baseURL}`);
    const environment = {
      ...process.env,
      DEMO_EDITOR_NAME: name,
      DEMO_EDITOR_HOST_ROOT: hostDir,
      DEMO_EDITOR_ARTIFACT_ROOT: artifact,
      DEMO_EDITOR_MANIFEST_PATH: resolve(artifact, "demo-editor-manifest.json"),
      DEMO_EDITOR_BASE_URL: baseURL,
    };
    const playwright = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const result = await run(playwright, ["exec", "playwright", "test", "--config", config, ...playwrightArgs], { env: environment });
    if (result.status !== 0) failed = true;
    await staticServer?.close();
    staticServer = undefined;
  }
} catch (error) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "EADDRINUSE") process.exitCode = 75;
  else throw error;
} finally {
  await staticServer?.close();
  process.removeListener("SIGINT", handleSigint);
  process.removeListener("SIGTERM", handleSigterm);
}
if (process.exitCode === undefined && failed) process.exitCode = 1;
