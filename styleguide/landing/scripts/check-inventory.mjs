import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import * as hostPack from "../src/generated/landing-pack.js";
import { assets } from "../src/generated/assets.js";

const { componentPack } = hostPack;

const host = resolve(import.meta.dirname, "..");
const stories = resolve(host, "stories");
const actual = (await readdir(stories)).filter((name) => name.endsWith(".stories.tsx"))
  .map((name) => name.slice(0, -".stories.tsx".length));
const entries = componentPack.manifest.components;
const expected = entries.map(({ id }) => id.replace(/^land\./, ""));
if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
  throw new Error("Landing pack has duplicate component IDs");
}
for (const entry of entries) {
  if (!entry.id.startsWith("land.") || typeof hostPack[entry.source.exportName] !== "function" ||
      typeof componentPack.runtime.components[entry.id]?.component !== "function") {
    throw new Error(`Landing pack source/export mismatch: ${entry.id}`);
  }
}
const missing = expected.filter((id) => !actual.includes(id));
const extra = actual.filter((id) => !expected.includes(id));
if (missing.length || extra.length || new Set(actual).size !== actual.length) {
  throw new Error(`Landing story inventory mismatch: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`);
}

for (const id of expected) {
  const story = await readFile(resolve(stories, `${id}.stories.tsx`), "utf8");
  if (!story.includes(`storyMeta("land.${id}")`) || !story.includes(`packDefaults("land.${id}")`) || !story.includes("export const WithContent") || !story.includes("export const Example")) {
    throw new Error(`${id} lacks pack metadata, defaults or contextual story`);
  }
}

const showcase = await readFile(resolve(stories, "showcases.tsx"), "utf8");
for (const id of expected) {
  if (!showcase.includes(`case "land.${id}":`)) {
    throw new Error(`Missing contextual showcase for land.${id}`);
  }
}

for (const url of Object.values(assets)) {
  await stat(resolve(host, "public", url.slice(1)));
}
for (const [, name] of showcase.matchAll(/photo\("([^"]+)"\)/g)) {
  if (!assets[name]) throw new Error(`Story image missing from Landing catalog: ${name}`);
}
console.log(`Landing inventory: ${expected.length} pack IDs have stories; referenced assets exist`);
