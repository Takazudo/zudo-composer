// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createDocSiteManifest, DOC_SITE_MANIFEST, verifyDocSiteArtifact } from "./hosted-demo/doc-site-artifact.mjs";
import { resolveTarget, TARGET_KEYS } from "./hosted-demo/targets.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const { values, positionals } = parseArgs({ args, options: { "source-revision": { type: "string" }, "skip-install": { type: "boolean", default: false }, styleguide: { type: "boolean", default: false } }, allowPositionals: true });
assert.ok(positionals.length <= 1, "Usage: build-doc-site.mjs [doc|sample-sg|shop-sg|landing-sg|blog-sg] [--source-revision SHA] [--skip-install]");
if (values.styleguide) assert.equal(positionals.length, 1, "Usage: sg:build-styleguide <sample-sg|shop-sg|landing-sg|blog-sg> [--skip-install]");
const site = positionals[0] ?? "doc";
const target = resolveTarget(site);
assert.ok(target.kind === "doc-site", `Unknown doc site: ${site}. Known doc sites: ${TARGET_KEYS.filter((key) => resolveTarget(key).kind === "doc-site").join(", ")}`);
if (values.styleguide) assert.ok(site !== "doc", "The sg:build-styleguide command requires a styleguide target");
const sourceRevision = values["source-revision"] ?? (process.env.GITHUB_SHA || undefined);
if (sourceRevision !== undefined) assert.ok(sourceRevision.length === 40 && /^[a-f0-9]{40}$/iu.test(sourceRevision), "Doc site sourceRevision must be a full 40-hex Git SHA");

const root = resolve(import.meta.dirname, "..");
const directory = target.artifactDirectory;
const hostDirectory = target.hostDirectory;
if (site !== "doc" && !values["skip-install"]) {
  const result = spawnSync("pnpm", ["-C", hostDirectory, "install", "--frozen-lockfile"], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`${site} dependency install failed${result.signal ? ` (${result.signal})` : ""}`);
    process.exit(result.status ?? 1);
  }
}
const result = spawnSync("pnpm", ["-C", hostDirectory, "build"], { cwd: root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(`${site} build failed${result.signal ? ` (${result.signal})` : ""}`);
  process.exit(result.status ?? 1);
}

const manifest = await createDocSiteManifest({ directory, sourceRevision });
await writeFile(join(directory, DOC_SITE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
const artifact = await verifyDocSiteArtifact({ directory, expectedSourceRevision: sourceRevision });
console.log(`${site} built: ${artifact.files.length} files, ${manifest.routes.length} routes${sourceRevision === undefined ? "" : `, source ${sourceRevision}`}`);
