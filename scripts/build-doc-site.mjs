// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDocSiteManifest, DOC_SITE_MANIFEST, verifyDocSiteArtifact } from "./hosted-demo/doc-site-artifact.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const { values, positionals } = parseArgs({ args, options: { "source-revision": { type: "string" } }, allowPositionals: true });
assert.ok(positionals.length <= 1, "Usage: build-doc-site.mjs [doc|sample-sg] [--source-revision SHA]");
const site = positionals[0] ?? "doc";
assert.ok(site === "doc" || site === "sample-sg", `Unknown doc site: ${site}`);
const sourceRevision = values["source-revision"] ?? (process.env.GITHUB_SHA || undefined);
if (sourceRevision !== undefined) assert.ok(sourceRevision.length === 40 && /^[a-f0-9]{40}$/iu.test(sourceRevision), "Doc site sourceRevision must be a full 40-hex Git SHA");

const root = resolve(import.meta.dirname, "..");
const directory = join(root, site === "doc" ? "doc" : "styleguide/sample", "dist");
if (site === "sample-sg") {
  const result = spawnSync("pnpm", ["-C", "styleguide/sample", "install", "--frozen-lockfile"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Sample styleguide dependency install failed${result.signal ? ` (${result.signal})` : ""}`);
    process.exit(result.status ?? 1);
  }
}
const result = site === "doc"
  ? spawnSync("pnpm", ["-C", "doc", "build"], { cwd: root, stdio: "inherit" })
  : spawnSync("pnpm", ["-C", "styleguide/sample", "build"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(`${site === "doc" ? "Doc site" : "Sample styleguide"} build failed${result.signal ? ` (${result.signal})` : ""}`);
  process.exit(result.status ?? 1);
}

const manifest = await createDocSiteManifest({ directory, sourceRevision });
await writeFile(join(directory, DOC_SITE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
const artifact = await verifyDocSiteArtifact({ directory, expectedSourceRevision: sourceRevision });
console.log(`${site === "doc" ? "Doc site" : "Sample styleguide"} built: ${artifact.files.length} files, ${manifest.routes.length} routes${sourceRevision === undefined ? "" : `, source ${sourceRevision}`}`);
