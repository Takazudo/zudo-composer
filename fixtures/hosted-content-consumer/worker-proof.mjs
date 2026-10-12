import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const result = await build({ stdin: { contents: `
import { runHostedContentConformance, createMemoryHostedConformanceFactory, createMemoryHostedStorage, createHostedContentConformanceSeed, createHostedContentConformancePolicy } from "zudo-composer/hosted-content/testing";
import { canonicalSerialize, createHostedContentService } from "zudo-composer/hosted-content";
export default { async fetch() {
  const report = await runHostedContentConformance(createMemoryHostedConformanceFactory());
  const service = createHostedContentService({ siteId: "worker-proof", definition: "definition-v1", policy: createHostedContentConformancePolicy(),
    storage: createMemoryHostedStorage(createHostedContentConformanceSeed()).storage,
    authorize(actor) { if (actor.id !== "allowed-editor") throw Error("Unauthorized"); }, createId: () => crypto.randomUUID(), now: () => "2026-01-01T00:00:00.000Z",
    digest: async value => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join(""),
    project: (providers, assets) => ({ providers, assets }), validateSubmission() {} });
  const state = await service.readState({ id: "allowed-editor" });
  const saved = await service.execute({ id: "allowed-editor" }, { kind: "capture-snapshot", operationKey: "worker-snapshot", expected: { draftRevision: state.draftRevision, definition: state.definition, baseline: state.baseline } });
  return new Response(JSON.stringify({ report, digest: saved.snapshot.digest, canonical: canonicalSerialize({ text: "日本語", zero: 0, bool: false }) }), { headers: { "content-type": "application/json" } });
} };
`, resolveDir: process.cwd(), sourcefile: "hosted-worker-entry.js" }, bundle: true, platform: "neutral", format: "esm", target: "es2022", write: false, metafile: true });
for (const input of Object.keys(result.metafile.inputs)) assert.ok(!/node:|preact|codemirror|vite|virtual:/.test(input), `Worker graph leak ${input}`);
await writeFile("worker-metafile.json", JSON.stringify(result.metafile, null, 2));
const worker = new Miniflare({ workers: [{ config: {
  name: "hosted-portable-proof", compatibilityDate: "2026-10-01",
  manifest: { mainModule: "worker.mjs", modulesRoot: process.cwd(), modules: { "worker.mjs": { type: "esm", contents: result.outputFiles[0].text } } },
} }] });
try {
  const response = await worker.dispatchFetch("http://worker.test/");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.report.scenarios.length, 13);
  assert.match(data.digest, /^[a-f0-9]{64}$/);
  assert.equal(data.canonical, '{"bool":false,"text":"日本語","zero":0}');
  console.log(JSON.stringify({ runtime: "local workerd", ...data }));
} finally { await worker.dispose(); }
