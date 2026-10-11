import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { storyDescriptors } from "../src/styleguide/descriptors";
import { sourceBySlug } from "../src/styleguide/sources";
import { previewDocumentPath } from "../src/config/preview.mjs";

const preview = await readFile(`dist/${previewDocumentPath}`, "utf8");
assert(preview.includes("/_shop-preview/preview.js"));
assert(preview.includes("/_shop-preview/main.css"));
assert(preview.includes("data-sg-preview-doc"));
assert(!preview.includes("/assets/"), "Preact document must not receive shell assets");
assert(!preview.includes("data-zfb-"), "Preact document must not receive shell hydration");
assert.equal(storyDescriptors.length, 35);
assert.equal(storyDescriptors.reduce((n, item) => n + item.variants.length, 0), 105);
assert.deepEqual(
  (await readdir("dist/shop-thumbnails")).sort(),
  storyDescriptors.map((story) => `${story.slug}.png`).sort(),
  "Only the current actual component thumbnails may be published",
);
for (const story of storyDescriptors) {
  const html = await readFile(`dist/components/${story.slug}/index.html`, "utf8");
  assert(html.includes("sg-code-panel"), `${story.slug}: source panel missing`);
  assert(html.includes("ShopWorkbench"), `${story.slug}: workbench missing`);
  assert.deepEqual(sourceBySlug[story.slug].map(({ exportName }) => exportName), story.variants.map(({ exportName }) => exportName));
  assert(sourceBySlug[story.slug].every(({ source }) => typeof source === "string" && source.length > 0));
  const path = `dist/shop-thumbnails/${story.slug}.png`;
  assert((await stat(path)).size > 1000, `${story.slug}: actual image missing`);
  const image = await readFile(path);
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(image.readUInt32BE(16), 800);
  assert.equal(image.readUInt32BE(20), 480);
}
const tokens = await readFile("dist/tokens/index.html", "utf8");
assert(tokens.includes("color-shop-bg"), "Host token dashboard must be populated");
const previewCss = await readFile("dist/_shop-preview/main.css", "utf8");
assert(previewCss.includes("--color-shop-bg"), "Real pack CSS must ship separately");
const manifest = JSON.parse(await readFile("package.json", "utf8"));
assert(!manifest.dependencies?.["@zudo-composer/ui"], "Demo catalog must not depend on Sample UI");
console.log("Artifact boundary passed: 35 components, 105 variants, source/workbench, actual thumbnails, tokens and isolated Preact pack CSS.");

assert(storyDescriptors.some(({ slug }) => slug === "cart-lines"), "Preserve title-derived Cart lines route");
assert(!storyDescriptors.some(({ slug }) => slug === "cart-page"));
