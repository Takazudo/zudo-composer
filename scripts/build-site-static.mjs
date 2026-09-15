// @ts-check
// `pnpm demo:build-site <name | host dir>`: build a host package's static website
// into `<host>/dist-site/`, then verify it. A bare name means `packages/demo-<name>`.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runComposerCli } from "../server/cli/run.mjs";

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

await runComposerCli(["build-site", "--root", hostRoot, ...arguments_.slice(1)]);
