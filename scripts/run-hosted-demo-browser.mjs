// @ts-check

import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { startHostedDemoStaticServer } from "./hosted-demo/static-server.mjs";

/** @typedef {{ status: number | null, signal: NodeJS.Signals | null }} RunResult */
/** @typedef {import("node:child_process").ChildProcess} ChildProcess */

const root = resolve(import.meta.dirname, "..");
const artifact = resolve(root, "dist-hosted-demo");
const config = resolve(root, "playwright.hosted-demo.config.ts");
const playwrightArgs = process.argv.slice(2).filter((argument) => argument !== "--");
/** @type {ChildProcess | null} */
let runningChild = null;

/** @param {string} command @param {string[]} args @param {import("node:child_process").SpawnOptions} options */
function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    runningChild = child;
    child.on("error", (error) => { if (runningChild === child) runningChild = null; reject(error); });
    child.on("close", (status, signal) => { if (runningChild === child) runningChild = null; resolveRun({ status, signal }); });
  });
}

await access(resolve(artifact, "index.html"));
const requestedBase = process.env.HOSTED_DEMO_BASE_URL?.trim();
if (requestedBase) {
  let url;
  try { url = new URL(requestedBase); } catch (error) { throw new Error(`HOSTED_DEMO_BASE_URL must be an absolute HTTP(S) URL: ${requestedBase}`, { cause: error }); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(`HOSTED_DEMO_BASE_URL must use HTTP(S): ${requestedBase}`);
}

/** @type {Awaited<ReturnType<typeof startHostedDemoStaticServer>> | undefined} */
let staticServer;
let stopping = false;
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
try {
  if (!requestedBase) staticServer = await startHostedDemoStaticServer({ directory: artifact, port: Number(process.env.HOSTED_DEMO_PORT ?? 4175) });
  const baseURL = requestedBase ?? staticServer?.url;
  if (!baseURL) throw new Error("Hosted demo server did not provide a base URL.");
  if (stopping) {
    process.exitCode = 143;
  } else {
    const environment = { ...process.env, HOSTED_DEMO_BASE_URL: baseURL };
    const playwright = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    // CI runners do not have the developer machine's cross-session guard. Local
    // invocations are wrapped by the required playwright-guard command at the
    // workflow boundary; keeping this child command portable lets CI consume the
    // same artifact without a personal filesystem dependency. Exit 75 is passed
    // through unchanged when an outer guarded invocation reports contention.
    const result = await run(playwright, ["exec", "playwright", "test", "--config", config, ...playwrightArgs], { env: environment });
    process.exitCode = result.status ?? 1;
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
