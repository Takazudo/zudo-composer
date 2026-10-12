import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const result = await build({ stdin: { contents: `
import { runHostedContentConformance, createMemoryHostedConformanceFactory } from "zudo-composer/hosted-content/testing";
import { canonicalSerialize } from "zudo-composer/hosted-content";
export default { async fetch() {
  const report = await runHostedContentConformance(createMemoryHostedConformanceFactory());
  return new Response(JSON.stringify({ report, canonical: canonicalSerialize({ text: "日本語", zero: 0, bool: false }) }), { headers: { "content-type": "application/json" } });
} };
`, resolveDir: process.cwd(), sourcefile: "hosted-worker-entry.js" }, bundle: true, platform: "neutral", format: "esm", target: "es2022", write: false, metafile: true });
for (const input of Object.keys(result.metafile.inputs)) assert.ok(!/node:|preact|codemirror|vite|virtual:/.test(input), `Worker graph leak ${input}`);
await writeFile("worker-metafile.json", JSON.stringify(result.metafile, null, 2));
const worker = new Miniflare({ modules: true, script: result.outputFiles[0].text, compatibilityDate: "2026-10-01" });
try {
  const response = await worker.dispatchFetch("http://worker.test/");
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.report.scenarios.length, 12);
  assert.equal(data.canonical, '{"bool":false,"text":"日本語","zero":0}');
  console.log(JSON.stringify({ runtime: "local workerd", ...data }));
} finally { await worker.dispose(); }
