import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { componentPack } from "../src/generated/shop-pack.js";
import { assets } from "../src/generated/assets.js";

const host = resolve(import.meta.dirname, "..");
const stories = resolve(host, "stories");
const actual = (await readdir(stories)).filter((name) => name.endsWith(".stories.tsx"))
  .map((name) => name.slice(0, -".stories.tsx".length));
const expected = componentPack.manifest.components.map(({ id }) => id.replace(/^shop\./, ""));
const missing = expected.filter((id) => !actual.includes(id));
const extra = actual.filter((id) => !expected.includes(id));
if (missing.length || extra.length || new Set(actual).size !== actual.length) {
  throw new Error(`Shop story inventory mismatch: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`);
}

for (const id of expected) {
  const story = await readFile(resolve(stories, `${id}.stories.tsx`), "utf8");
  if (!story.includes(`storyMeta("shop.${id}")`) || !story.includes(`packDefaults("shop.${id}")`) || !story.includes("export const WithContent")) {
    throw new Error(`${id} lacks pack metadata, defaults or contextual story`);
  }
}

for (const url of Object.values(assets)) {
  await stat(resolve(host, "public", url.slice(1)));
}
const showcase = await readFile(resolve(stories, "showcases.tsx"), "utf8");
for (const [, name] of showcase.matchAll(/photo\("([^"]+)"\)/g)) {
  if (!assets[name]) throw new Error(`Story image missing from Shop catalog: ${name}`);
}
console.log(`Shop inventory: ${expected.length} pack IDs have stories; referenced assets exist`);
