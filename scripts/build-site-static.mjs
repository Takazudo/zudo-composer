// @ts-check
// `pnpm demo:build-site <name | host dir>`: build a host package's static website
// into `<host>/dist-site/`, then verify it. A bare name means `packages/demo-<name>`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
if (arguments_[0] === "--") arguments_.shift();
const target = arguments_[0];
if (!target) {
  console.error("Usage: pnpm demo:build-site <webshop | landing | blog | host directory>");
  process.exit(1);
}
const named = join(root, "packages", `demo-${target}`);
const hostRoot = existsSync(join(named, "site-project.json")) ? named : resolve(target);
if (!existsSync(join(hostRoot, "site-project.json"))) {
  console.error(`No site-project.json in ${hostRoot}.`);
  process.exit(1);
}

const vite = join(dirname(createRequire(import.meta.url).resolve("vite/package.json")), "bin/vite.js");
/** @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
function run(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run([vite, "build", "--config", "vite.site-static.config.ts"], { ZUDO_HOST_ROOT: relative(root, hostRoot) || "." });
run([join(root, "scripts/check-site-static.mjs"), join(hostRoot, "dist-site")]);
