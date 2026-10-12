// @ts-check
/* global console, process, Request */
// Installed-host proof of the hosted content entries, run from this host's
// own directory with its own node_modules: Worker service semantics, a
// Worker-only type check, the restricted editor build through
// `zudo-composer/vite`, and a scan of what that build emitted.
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createHostedContentService } from "./worker.mjs";
import { BASELINE_REVISION, policy } from "./site.mjs";

const execFile = promisify(execFileCallback);
const here = dirname(fileURLToPath(import.meta.url));
const origin = "https://host.example";
const service = createHostedContentService();

/** @param {string} path @param {unknown} [body] */
async function call(path, body) {
  const response = await service.fetch(new Request(`${origin}${path}`, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  return { code: response.status, body: await response.json() };
}

const request = (expectedRevision, values) => ({ kind: "put-entry-values", projectId: policy.projectId, providerId: policy.providerId, modelId: "courses", entryId: "watercolor", values, expectedRevision });

// 1. Worker service semantics.
const draft = (await call("/api/draft")).body;
assert.equal(draft.status, "ok");
assert.equal(draft.value.baselineRevision, BASELINE_REVISION);
const start = draft.value.draftRevision;
const saved = (await call("/api/apply", { operationId: "op-1", request: request(start, { title: "水彩画入門（改訂）", price: 13000 }), expectedBaselineRevision: BASELINE_REVISION })).body;
assert.equal(saved.status, "ok", JSON.stringify(saved));
assert.equal(saved.value.receipt.previousDraftRevision, start);
const after = saved.value.draft.draftRevision;
const stale = (await call("/api/apply", { operationId: "op-2", request: request(start, { price: 1 }), expectedBaselineRevision: BASELINE_REVISION })).body;
assert.deepEqual(stale, { status: "conflict", reason: "draft-revision", current: { draftRevision: after, baselineRevision: BASELINE_REVISION } });
const replay = (await call("/api/apply", { operationId: "op-1", request: request(start, { title: "水彩画入門（改訂）", price: 13000 }), expectedBaselineRevision: BASELINE_REVISION })).body;
assert.equal(replay.status, "ok");
assert.equal(replay.value.replayed, true);
assert.deepEqual(replay.value.receipt, saved.value.receipt);
assert.equal((await call("/api/receipts/op-1")).body.status, "ok");
const protectedSlug = (await call("/api/apply", { operationId: "op-3", request: request(after, { slug: "elsewhere" }), expectedBaselineRevision: BASELINE_REVISION })).body;
assert.equal(protectedSlug.status, "refused");
assert.equal(protectedSlug.refusal.code, "forbidden");
for (const path of ["/composer", "/mapping", "/sitemapper", "/assets/upload", "/api/schema", "/api/models"]) {
  assert.equal((await call(path)).code, 403, `${path} must be refused by the service`);
}
const snapshot = (await call("/api/snapshot", { expectedDraftRevision: after })).body;
assert.equal(snapshot.status, "ok");
assert.match(snapshot.value.snapshotId, /^[0-9a-f]{64}$/);
assert.equal(snapshot.value.project.providers.content[0].entries.find((entry) => entry.id === "watercolor").values.title, "水彩画入門（改訂）");
const routes = (await call("/api/routes")).body;
assert.deepEqual(routes, { status: "ok", routes: ["/"] });

// 2. The Worker module type-checks against ES2023 + WebWorker only.
await execFile(process.execPath, [join(here, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.worker.json"], { cwd: here }).catch(async () => {
  // A host nested inside another host's install resolves TypeScript from there.
  const { createRequire } = await import("node:module");
  const tsc = createRequire(join(here, "package.json")).resolve("typescript/bin/tsc");
  await execFile(process.execPath, [tsc, "-p", "tsconfig.worker.json"], { cwd: here });
});

// 3. The restricted editor builds through zudo-composer/vite.
const { build } = await import("vite");
await build({ configFile: join(here, "vite.config.mjs"), logLevel: "warn" });

// 4. The emitted graph is a browser bundle of public entries only.
const dist = join(here, "dist");
/** @param {string} directory @returns {Promise<string[]>} */
async function files(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(path)); else found.push(path);
  }
  return found;
}
const emitted = await files(dist);
const scripts = emitted.filter((path) => path.endsWith(".js"));
const styles = emitted.filter((path) => path.endsWith(".css"));
assert.ok(emitted.some((path) => path.endsWith("index.html")), "editor build must emit index.html");
assert.ok(scripts.length > 0 && styles.length > 0, "editor build must emit JavaScript and CSS");
const js = (await Promise.all(scripts.map((path) => readFile(path, "utf8")))).join("\n");
const css = (await Promise.all(styles.map((path) => readFile(path, "utf8")))).join("\n");
for (const [pattern, reason] of /** @type {const} */ ([
  [/__vite-browser-external/, "a Node builtin was stubbed for the browser"],
  [/\bvirtual:zudo-composer/, "a tool virtual module leaked"],
  [/["']node:[a-z]/, "a Node builtin import remained"],
  [/zudo-composer\/src\//, "a private source path leaked"],
  [/\bprocess\.env\b/, "process.env reached the browser bundle"],
])) assert.doesNotMatch(js, pattern, `editor bundle: ${reason}`);
assert.match(js, /保存しました/, "editor bundle must carry the host's Japanese labels");
assert.match(css, /\.sg-hosted-content-editor\b/, "editor CSS must ship the editor chrome");
assert.match(css, /\.sg-content-form\b/, "editor CSS must ship the Content form styles");
console.log(JSON.stringify({ worker: { start, after, replayed: true, refusedRoutes: 6, routes: routes.routes }, editor: { scripts: scripts.length, styles: styles.length, bytes: js.length + css.length } }));
console.log("Hosted content host passed: Worker service, Worker-only type check, editor build and emitted-graph scan.");
