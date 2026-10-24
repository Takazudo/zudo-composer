import assert from "node:assert/strict";
import { previewDocumentPath } from "../src/config/preview.mjs";
import { readFile, readdir, stat } from "node:fs/promises";
import { storyDescriptors } from "../src/styleguide/descriptors";
const preview = await readFile(`dist/${previewDocumentPath}`, "utf8");
assert(preview.includes("/_sample-preview/preview.js"));
assert(preview.includes("/_sample-preview/main.css"));
assert(
  !preview.includes("/assets/"),
  "The Preact document must not receive zfb shell CSS/islands",
);
assert(
  !preview.includes("data-zfb-"),
  "The static Preact document must not contain shell hydration markers",
);
assert.equal(storyDescriptors.length, 12);
assert.deepEqual(
  (await readdir("dist/sample-thumbnails")).sort(),
  storyDescriptors.map((story) => `${story.slug}.png`).sort(),
  "Only the current settled PNG thumbnails may be published",
);
assert.equal(
  storyDescriptors.reduce((n, item) => n + item.variants.length, 0),
  71,
);
for (const story of storyDescriptors) {
  const html = await readFile(
    `dist/components/${story.slug}/index.html`,
    "utf8",
  );
  assert(html.includes("sg-code-panel"), `${story.slug}: source panel missing`);
  assert(html.includes("SampleWorkbench"), `${story.slug}: workbench missing`);
  assert(
    (await stat(`dist/sample-thumbnails/${story.slug}.png`)).size > 1000,
    `${story.slug}: real thumbnail missing`,
  );
  const image = await readFile(`dist/sample-thumbnails/${story.slug}.png`);
  assert.equal(image.readUInt32BE(16), 800);
  assert.equal(image.readUInt32BE(20), 480);
}
const ui = JSON.parse(
  await readFile("node_modules/@zudo-composer/ui/package.json", "utf8"),
);
assert.equal(ui.dependencies["@takazudo/zfb-md-wasm"], "4.7.0");
const mdWasm = JSON.parse(
  await readFile("node_modules/@takazudo/zfb-md-wasm/package.json", "utf8"),
);
assert.equal(mdWasm.version, "4.7.0");
assert.deepEqual(
  await readFile("dist/_sample-preview/zfb_md_wasm_render_bg.wasm"),
  await readFile(
    "node_modules/@takazudo/zfb-md-wasm/dist/wasm-render/zfb_md_wasm_render_bg.wasm",
  ),
  "The emitted Preact renderer WASM must be exactly the installed 4.7.0 binary",
);
const tokens = await readFile("dist/tokens/index.html", "utf8");
assert(tokens.includes("color-bg"), "Token dashboard is not populated");
console.log(
  "Artifact boundary passed: 12 components, 71 variants, source/workbench, real thumbnails, tokens, isolated Preact document, Git UI md-wasm4.7.0.",
);
