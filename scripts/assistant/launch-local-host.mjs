// @ts-check
// Drives scripts/assistant/local-host.mjs as a child process for automated
// lanes: start it, wait for its printed URL, stop it with SIGTERM.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { clearTimeout } from "node:timers";
import { fileURLToPath } from "node:url";

export const launcher = fileURLToPath(new URL("./local-host.mjs", import.meta.url));

/** A free loopback port chosen by the OS (never the fixed 4175–4178 lane ports). @returns {Promise<number>} */
export function freePort() {
  return new Promise((settle, reject) => {
    const probe = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => settle(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** Runs the launcher to completion (refusals). @param {string[]} args @returns {Promise<{ code: number | null, output: string }>} */
export function runLauncherToExit(args) {
  return new Promise((settle) => {
    const child = spawn(process.execPath, [launcher, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("close", code => settle({ code, output }));
  });
}

/** Starts the launcher and resolves once it prints the URL. @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
export async function launchLocalHost(args, env = process.env) {
  const child = spawn(process.execPath, [launcher, ...args], { stdio: ["ignore", "pipe", "pipe"], env });
  let output = "";
  const closed = new Promise(settle => child.once("close", settle));
  await new Promise((settle, reject) => {
    const timer = setTimeout(() => reject(new Error(`launcher never printed its URL:\n${output}`)), 240_000);
    const check = () => { if (/Ctrl\+C stops/.test(output)) { clearTimeout(timer); settle(undefined); } };
    child.stdout.on("data", chunk => { output += chunk; check(); });
    child.stderr.on("data", chunk => { output += chunk; });
    closed.then(code => { clearTimeout(timer); reject(new Error(`launcher exited ${code} before ready:\n${output}`)); });
  });
  return {
    output: () => output,
    url: /Open:\s+(\S+)/.exec(output)?.[1] ?? "",
    async stop() {
      child.kill("SIGTERM");
      const code = await closed;
      assert.equal(code, 0, `launcher should stop cleanly:\n${output}`);
    },
  };
}
