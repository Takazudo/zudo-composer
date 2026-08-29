import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createArtifactManifest } from "./deployment-artifact-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const manifestPath = join(root, ".artifacts", "deployment-manifest.json");
const command = process.argv[2];

if (!new Set(["write", "check"]).has(command)) {
  throw new Error("Usage: deployment-artifact.mjs <write|check>");
}

const actual = createArtifactManifest(dist);
if (command === "write") {
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(await actual, null, 2)}\n`);
  console.log(`Wrote ${manifestPath}`);
} else {
  const expected = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(await actual, expected, "downloaded dist does not match its deployment manifest");
  console.log(`Deployment artifact matches ${expected.files.length} recorded files.`);
}
