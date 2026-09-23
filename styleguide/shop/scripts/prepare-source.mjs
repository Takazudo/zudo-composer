import { build } from "esbuild";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const host = resolve(import.meta.dirname, "..");
const repo = resolve(host, "../..");
const pack = resolve(repo, "packages/demo-webshop/components/pack.ts");
const output = resolve(host, "src/generated");
const publicAssets = resolve(repo, "packages/demo-webshop/public/uploaded-assets");
const copiedAssets = resolve(host, "public/uploaded-assets");
const catalog = JSON.parse(await readFile(resolve(repo, "packages/demo-webshop/cms/assets/catalog.json"), "utf8"));

// Bundle the real host source while leaving runtime dependencies external. This
// makes Preact and the contract resolve from this standalone host, including
// in the preview iframe, instead of from the root workspace's node_modules.
await mkdir(output, { recursive: true });
await build({
  entryPoints: [pack],
  outfile: resolve(output, "shop-pack.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  packages: "external",
  jsx: "automatic",
  jsxImportSource: "preact",
});
await writeFile(resolve(output, "shop-pack.d.ts"),
  'export * from "../../../../packages/demo-webshop/components/pack";\n');
const assets = Object.fromEntries(catalog.records.map(({ document }) =>
  [document.fileName, document.versions.find(({ id }) => id === document.currentVersionId).url]));
await writeFile(resolve(output, "assets.js"), `export const assets = ${JSON.stringify(assets, null, 2)};\n`);
await writeFile(resolve(output, "assets.d.ts"), 'export const assets: Record<string, string>;\n');

await mkdir(copiedAssets, { recursive: true });
for (const filename of await readdir(publicAssets)) {
  if (filename.endsWith(".webp")) {
    await copyFile(resolve(publicAssets, filename), resolve(copiedAssets, filename));
  }
}

// Catch a stale source adapter that accidentally contains inlined Preact.
const compiled = await readFile(resolve(output, "shop-pack.js"), "utf8");
if (!compiled.includes('from "preact/hooks"') || compiled.includes("function useState(")) {
  throw new Error("Shop source adapter did not leave Preact external");
}
