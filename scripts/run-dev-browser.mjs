import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dirname, "..");
if (process.argv.length !== 2) throw new Error("Usage: node scripts/run-dev-browser.mjs");

function run(command, args, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("close", (status, signal) => resolveRun({ status, signal }));
  });
}

const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "zudo-composer-dev-browser-")));
try {
  const releaseRoot = join(temporaryRoot, "release"), mediaRoot = join(temporaryRoot, "media"), compositionsRoot = join(temporaryRoot, "compositions");
  await Promise.all([mkdir(releaseRoot), mkdir(mediaRoot), mkdir(compositionsRoot)]);
  const environment = { ...process.env, ZUDO_SITE_PROJECT_ROOT: releaseRoot, ZUDO_MEDIA_STORE_ROOT: mediaRoot, ZUDO_COMPOSITIONS_ROOT: compositionsRoot };
  const playwright = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = await run(playwright, ["exec", "playwright", "test", "--config", "playwright.dev.config.ts"], { env: environment });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
