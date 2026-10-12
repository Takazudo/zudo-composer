// @ts-check
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const sha = process.argv[2];
assert.match(sha ?? "", /^[a-f0-9]{40}$/, "Pass an exact reachable package-output SHA");
const root = resolve(import.meta.dirname, "..");
const consumer = resolve(process.argv[3] ?? join(root, ".artifacts/hosted-consumer"));
const noBrowser = process.argv.includes("--no-browser");
function run(command, args, cwd = consumer) { return execFileSync(command, args, { cwd, stdio: "inherit" }); }
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
async function installedInventory() {
  const packageRoot = await realpath(join(consumer, "node_modules/zudo-composer"));
  const files = [];
  async function visit(directory, prefix = "") {
    for (const name of (await readdir(directory)).sort()) {
      // Dependency links are installer-owned, outside the delivered tool payload.
      if (!prefix && name === "node_modules") continue;
      const path = join(directory, name), relative = prefix ? `${prefix}/${name}` : name;
      const stat = await lstat(path);
      if (stat.isDirectory()) await visit(path, relative);
      else {
        assert(stat.isFile(), `Unexpected non-file in delivered tool payload: ${relative}`);
        const bytes = await readFile(path);
        files.push({ path: relative, bytes: bytes.length, executable: !!(stat.mode & 0o111), sha256: digest(bytes) });
      }
    }
  }
  await visit(packageRoot);
  return { algorithm: "sha256", excludes: ["root node_modules (installer-owned dependency links)"],
    provenanceNormalization: "none; package.json and all shipped metadata are hashed verbatim",
    sha256: digest(JSON.stringify(files)), files };
}
run(process.execPath, [join(root, "scripts/install-hosted-consumer.mjs"), sha, consumer], root);
const inventory = await installedInventory();
await writeFile(join(consumer, "tool-payload-inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
run("corepack", ["pnpm", "exec", "zudo-composer", "--help"]);
run("corepack", ["pnpm", "exec", "tsc", "-p", "tsconfig.worker.json", "--pretty", "false"]);
run(process.execPath, ["worker-proof.mjs"]);
run(process.execPath, ["node-proof.mjs"]);
run(process.execPath, ["durable-proof.mjs"]);
run(process.execPath, ["render-proof.mjs", join(consumer, "work/install-render.sqlite")]);
run(process.execPath, ["publication-render-proof.mjs", join(consumer, "work/install-publication-render")]);
await rm(join(consumer, "node_modules"), { recursive: true, force: true });
await rm(join(consumer, "renderer/node_modules"), { recursive: true, force: true });
run("corepack", ["pnpm", "install", "--frozen-lockfile"]);
run("corepack", ["pnpm", "install", "--frozen-lockfile"], join(consumer, "renderer"));
assert.deepEqual(await installedInventory(), inventory, "Frozen reinstall must preserve the complete delivered tool payload");
run("corepack", ["pnpm", "exec", "zudo-composer", "--help"]);
run("corepack", ["pnpm", "exec", "tsc", "-p", "tsconfig.worker.json", "--pretty", "false"]);
run(process.execPath, ["worker-proof.mjs"]);
run(process.execPath, ["node-proof.mjs"]);
run(process.execPath, ["durable-proof.mjs"]);
run(process.execPath, ["render-proof.mjs", join(consumer, "work/frozen-render.sqlite")]);
run(process.execPath, ["publication-render-proof.mjs", join(consumer, "work/frozen-publication-render")]);
if (!noBrowser) {
  run("corepack", ["pnpm", "exec", "playwright", "install", "--with-deps", "chromium"]);
  run(process.execPath, ["browser-proof.mjs", join(consumer, "work/browser.sqlite")]);
}
const lockDigests = {};
for (const path of ["package.json", "pnpm-lock.yaml", "renderer/package.json", "renderer/pnpm-lock.yaml"])
  lockDigests[path] = digest(await readFile(join(consumer, path)));
await writeFile(join(consumer, "verification.json"), JSON.stringify({ installedToolSha: sha, node: process.version,
  payloadSha256: inventory.sha256, lockDigests,
  independentInstall: "passed", frozenReinstall: "passed", worker: "passed", nodeBoundary: "passed", sqlite: "passed", staticRenderer: "passed",
  browser: noBrowser ? "not run; P4 remains blocked" : "passed" }, null, 2) + "\n");
console.log(`Independent hosted consumer verified${noBrowser ? " except browser/P4" : ""}: ${sha}`);
