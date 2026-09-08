import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(process.argv[2] ?? "dist-hosted-demo");
const manifest = JSON.parse(await readFile(resolve(root, "hosted-demo-manifest.json"), "utf8"));
assert.match(manifest.sourceRevision, /^[a-f0-9]{40}$/);
assert.match(manifest.projectSourceRevision, /^[a-f0-9]{64}$/);
assert.equal(manifest.mode, "disposable-hosted-demo");
if (process.argv[3]) assert.equal(manifest.sourceRevision, process.argv[3]);
const found = [];
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), "Deploy artifacts must not contain symlinks");
    const name = prefix + entry.name;
    if (entry.isDirectory()) await walk(resolve(directory, entry.name), name + "/");
    else if (name !== "hosted-demo-manifest.json") {
      found.push(name);
      const bytes = await readFile(resolve(directory, entry.name));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.assets[name], `Final artifact checksum: ${name}`);
      if (/\.(?:js|mjs|html)$/.test(name)) for (const forbidden of ["node:fs", "node:path", "dev-server-entry", "/__zudo_composer", ".zudo-site-project", "SiteProjectApiService", "createLocalSiteProjectApiService"]) assert.ok(!bytes.toString().includes(forbidden), `Hosted runtime leaks ${forbidden}`);
    }
  }
}
await walk(root);
assert.deepEqual(found.sort(), Object.keys(manifest.assets).sort(), "Manifest must describe every final file exactly once");
assert.ok(manifest.assets["index.html"]);
assert.ok(manifest.assets["hosted-demo-media-worker.js"]);
const media = found.filter((name) => name.startsWith("uploaded-media/"));
assert.equal(media.length, 4);
for (const name of media) assert.match(name, /^uploaded-media\/sha256-[a-f0-9]{64}\.png$/);
console.log(`Hosted demo verified: ${found.length} files, four media assets, source ${manifest.sourceRevision}.`);
