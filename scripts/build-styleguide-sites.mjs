// @ts-check
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { STYLEGUIDE_TARGET_KEYS } from "./hosted-demo/targets.mjs";

const root = resolve(import.meta.dirname, "..");
for (const target of STYLEGUIDE_TARGET_KEYS) {
  const result = spawnSync("pnpm", ["sg:build-styleguide", target], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`${target} build failed${result.signal ? ` (${result.signal})` : ""}`);
    process.exit(result.status ?? 1);
  }
}
