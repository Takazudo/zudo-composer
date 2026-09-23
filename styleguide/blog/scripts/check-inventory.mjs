import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import * as hostPack from "../src/generated/blog-pack.js";
import { assets } from "../src/generated/assets.js";
import { articles, authors, comments } from "../src/generated/content.js";

const { componentPack } = hostPack;

const host = resolve(import.meta.dirname, "..");
const stories = resolve(host, "stories");
const actual = (await readdir(stories)).filter((name) => name.endsWith(".stories.tsx"))
  .map((name) => name.slice(0, -".stories.tsx".length));
const entries = componentPack.manifest.components;
const expected = entries.map(({ id }) => id.replace(/^blog\./, ""));
if (new Set(entries.map(({ id }) => id)).size !== entries.length) {
  throw new Error("Blog pack has duplicate component IDs");
}
for (const entry of entries) {
  if (!entry.id.startsWith("blog.") || typeof hostPack[entry.source.exportName] !== "function" ||
      typeof componentPack.runtime.components[entry.id]?.component !== "function") {
    throw new Error(`Blog pack source/export mismatch: ${entry.id}`);
  }
}
const missing = expected.filter((id) => !actual.includes(id));
const extra = actual.filter((id) => !expected.includes(id));
if (missing.length || extra.length || new Set(actual).size !== actual.length) {
  throw new Error(`Blog story inventory mismatch: missing=${missing.join(",") || "none"}; extra=${extra.join(",") || "none"}`);
}

for (const id of expected) {
  const story = await readFile(resolve(stories, `${id}.stories.tsx`), "utf8");
  if (!story.includes(`storyMeta("blog.${id}")`) || !story.includes(`packDefaults("blog.${id}")`) || !story.includes("export const WithContent") || !story.includes("export const Example")) {
    throw new Error(`${id} lacks pack metadata, defaults or contextual story`);
  }
}

const showcase = await readFile(resolve(stories, "showcases.tsx"), "utf8");
for (const id of expected) {
  if (!showcase.includes(`case "blog.${id}":`)) {
    throw new Error(`Missing contextual showcase for blog.${id}`);
  }
}

for (const url of Object.values(assets)) {
  await stat(resolve(host, "public", url.slice(1)));
}
for (const article of articles) {
  if (!article.cover || !article.authorAvatar || !article.body || article.body.length < 1000) {
    throw new Error(`Incomplete Blog article fixture: ${article.slug}`);
  }
  await stat(resolve(host, "public", article.cover.slice(1)));
  await stat(resolve(host, "public", article.authorAvatar.slice(1)));
}
for (const author of authors) await stat(resolve(host, "public", author.src.slice(1)));
const routeCases = [
  ["by-route-author", articles.filter((article) => article.authorSlug === "mina-okafor")],
  ["exclude-route", articles.filter((article) => article.slug !== "the-half-finished-list")],
  ["tag-filter", articles.filter((article) => article.tag1 === "craft" || article.tag2 === "craft" || article.tag3 === "craft")],
  ["comments", comments.filter((comment) => comment.articleSlug === "the-half-finished-list")],
];
for (const [name, content] of routeCases) {
  if (!content.length || content.some((entry) => !entry.body)) throw new Error(`${name} fixture has no real content`);
}
for (const marker of ["history.replaceState", '"/authors/mina-okafor"', 'path="/articles/the-half-finished-list"', "data-blog-fixture-path"]) {
  if (!showcase.includes(marker)) throw new Error(`Missing isolated Blog fixture routing: ${marker}`);
}
console.log(`Blog inventory: ${expected.length} pack IDs have stories; referenced assets exist`);
