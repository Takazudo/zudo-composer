import { watch } from "node:fs";
import { spawn } from "node:child_process";

/** @type {Set<import("node:child_process").ChildProcess>} */
const children = new Set();
/** @type {import("node:fs").FSWatcher[]} */
const watchers = [];
/** @type {import("node:child_process").ChildProcess | undefined} */
let server;
let closing = false;
let dirty = true;
let rebuilding = false;
/** @type {NodeJS.Timeout | undefined} */
let timer;

/** @param {string} command @param {string[]} args */
function start(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", () => children.delete(child));
  return child;
}

/** @param {import("node:child_process").ChildProcess} child */
async function stop(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else if (child.pid) process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH")
      throw error;
  }
  await exited;
}

/** @param {string} command @param {string[]} args */
async function run(command, args) {
  const child = start(command, args);
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(undefined);
      else reject(Error(`${command} ${args.join(" ")} failed (${signal ?? code})`));
    });
  });
}

async function rebuild() {
  if (closing || rebuilding) return;
  rebuilding = true;
  try {
    if (server) {
      const previous = server;
      server = undefined;
      await stop(previous);
    }
    // Keep the server stopped while stable asset names change. No active
    // document can load a half-written preview graph. Events received during
    // a build request one more serial pass before the server starts again.
    while (dirty && !closing) {
      dirty = false;
      console.log("Shop: rebuilding corpus, preview and settled thumbnails…");
      await run("pnpm", ["gen"]);
      await run("pnpm", ["preview:build"]);
    }
    if (!closing) {
      const next = start("pnpm", ["exec", "zfb", "dev"]);
      server = next;
      next.once("error", (error) => {
        if (server === next) server = undefined;
        console.error("Shop: zfb could not launch", error);
      });
      next.once("exit", (code, signal) => {
        if (server !== next) return;
        server = undefined;
        if (!closing)
          console.error(
            `Shop: zfb exited (${signal ?? code}); waiting for an edit to retry.`,
          );
      });
      console.log(
        "Shop: launching zfb with the refreshed preview graph; waiting for its ready message.",
      );
    }
  } catch (error) {
    if (!closing) console.error(error);
  } finally {
    rebuilding = false;
    if (dirty && !closing) schedule();
  }
}

function schedule() {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(() => void rebuild(), 150);
}

for (const directory of [
  "stories",
  "preview",
  "src/styles",
  "src/config",
  "scripts",
  "../../packages/demo-webshop/components",
  "../../packages/demo-webshop/styles",
  "../../packages/demo-webshop/public/uploaded-assets",
  "../../packages/demo-webshop/cms",
]) {
  watchers.push(
    watch(directory, { recursive: true }, (_event, filename) => {
      if (!filename || filename === "loaders.ts" || filename.startsWith("."))
        return;
      schedule();
    }),
  );
}
for (const file of ["zfb.config.ts", "zudo-sg.config.mjs"]) {
  watchers.push(watch(file, schedule));
}

async function close() {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  await Promise.all([...children].map(stop));
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
await rebuild();
