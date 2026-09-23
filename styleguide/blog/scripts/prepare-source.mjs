import { build } from "esbuild";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const host = resolve(import.meta.dirname, "..");
const repo = resolve(host, "../..");
const pack = resolve(repo, "packages/demo-blog/components/pack.ts");
const output = resolve(host, "src/generated");
const publicAssets = resolve(repo, "packages/demo-blog/public/uploaded-assets");
const copiedAssets = resolve(host, "public/uploaded-assets");
const catalog = JSON.parse(await readFile(resolve(repo, "packages/demo-blog/cms/assets/catalog.json"), "utf8"));
const contentRoot = resolve(repo, "packages/demo-blog/cms/content/workspace-v1-initial");
const contentIndex = JSON.parse(await readFile(resolve(contentRoot, "current.json"), "utf8"));
const contentDir = resolve(contentRoot, "generations", String(contentIndex.generation));

// Bundle the real host source while leaving runtime dependencies external. This
// makes Preact and the contract resolve from this standalone host, including
// in the preview iframe, instead of from the root workspace's node_modules.
await mkdir(output, { recursive: true });
await build({
  entryPoints: [pack],
  outfile: resolve(output, "blog-pack.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  packages: "external",
  jsx: "automatic",
  jsxImportSource: "preact",
});
await writeFile(resolve(output, "blog-pack.d.ts"),
  'export * from "../../../../packages/demo-blog/components/pack";\n');
const assets = Object.fromEntries(catalog.records.map(({ document }) =>
  [document.fileName, document.versions.find(({ id }) => id === document.currentVersionId).url]));
const assetById = Object.fromEntries(catalog.records.map(({ id, document }) =>
  [id, document.versions.find(({ id: version }) => version === document.currentVersionId).url]));
const image = (value) => value?.asset?.assetId ? assetById[value.asset.assetId] : "";
const records = await Promise.all(contentIndex.entries.filter(({ id }) => id.startsWith("entry-"))
  .map(async ({ id }) => JSON.parse(await readFile(resolve(contentDir, `${id}.json`), "utf8"))));
const articles = records.filter(({ modelId }) => modelId === "articles").map(({ values: v }) => ({
  slug: v["articles-slug"], title: v["articles-title"], intro: v["articles-intro"],
  date: v["articles-date"], body: v["articles-body"], bodyLength: v["articles-body-length"],
  tag1: v["articles-tag1"], tag2: v["articles-tag2"], tag3: v["articles-tag3"],
  authorSlug: v["articles-author-slug"], authorName: v["articles-author-name"],
  authorBio: v["articles-author-bio"], authorAvatar: image(v["articles-author-avatar"]),
  authorAvatarAlt: v["articles-author-avatar"]?.alt ?? "", cover: image(v["articles-cover"]),
  coverAlt: v["articles-cover"]?.alt ?? "", caption: v["articles-cover"]?.caption ?? "",
}));
const authors = records.filter(({ modelId }) => modelId === "authors").map(({ values: v }) => ({
  slug: v["authors-slug"], name: v["authors-name"], bio: v["authors-bio"],
  src: image(v["authors-avatar"]), alt: v["authors-avatar"]?.alt ?? "",
}));
const comments = records.filter(({ modelId }) => modelId === "comments").map(({ values: v }) => ({
  articleSlug: v["comments-article-slug"], name: v["comments-name"],
  date: v["comments-date"], body: v["comments-body"], order: v["comments-order"],
})).sort((a, b) => a.order - b.order);
if (articles.length !== 8 || authors.length !== 2 || comments.length < 1 ||
    [...articles, ...authors].some((entry) => !entry.src && !entry.cover)) {
  throw new Error("Blog fixture records or asset URLs are incomplete");
}
await writeFile(resolve(output, "content.js"), `export const articles = ${JSON.stringify(articles, null, 2)};\nexport const authors = ${JSON.stringify(authors, null, 2)};\nexport const comments = ${JSON.stringify(comments, null, 2)};\n`);
await writeFile(resolve(output, "content.d.ts"), `export interface Article { slug: string; title: string; intro: string; date: string; body: string; bodyLength: number; tag1: string; tag2: string; tag3: string; authorSlug: string; authorName: string; authorBio: string; authorAvatar: string; authorAvatarAlt: string; cover: string; coverAlt: string; caption: string }\nexport interface Author { slug: string; name: string; bio: string; src: string; alt: string }\nexport interface Comment { articleSlug: string; name: string; date: string; body: string; order: number }\nexport const articles: Article[]; export const authors: Author[]; export const comments: Comment[];\n`);
await writeFile(resolve(output, "assets.js"), `export const assets = ${JSON.stringify(assets, null, 2)};\n`);
await writeFile(resolve(output, "assets.d.ts"), 'export const assets: Record<string, string>;\n');

await mkdir(copiedAssets, { recursive: true });
for (const filename of await readdir(publicAssets)) {
  if (filename.endsWith(".webp")) {
    await copyFile(resolve(publicAssets, filename), resolve(copiedAssets, filename));
  }
}

// Catch a stale source adapter that accidentally contains inlined Preact.
const compiled = await readFile(resolve(output, "blog-pack.js"), "utf8");
if (!compiled.includes('from "preact/hooks"') || compiled.includes("function useState(")) {
  throw new Error("Blog source adapter did not leave Preact external");
}
