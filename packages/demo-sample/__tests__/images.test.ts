import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";

it("preserves the package-owned image seed and references it from the Studio project", async () => {
  const images = new URL("../images-src/", import.meta.url);
  const files = ["studio-workbench.webp", "studio-wall.webp", "studio-review.webp", "journal-question.webp", "journal-map.webp"];
  const manifest = JSON.parse(await readFile(new URL("manifest.json", images), "utf8")) as { file: string }[];
  expect(manifest.map(({ file }) => file)).toEqual(files);
  expect((await readdir(images)).sort()).toEqual([...files, "manifest.json"].sort());
  const catalog = JSON.parse(await readFile(new URL("../cms/assets/catalog.json", import.meta.url), "utf8")) as { records: { document: { fileName: string; id: string } }[] };
  expect(catalog.records.map(({ document }) => document.fileName)).toEqual(files);
  const project = await readFile(new URL("../site-project.json", import.meta.url), "utf8");
  // studio-review.webp is seeded but not yet referenced; it is reserved for the services lead image (out of scope, see #695).
  const referenced = catalog.records.filter(({ document }) => document.fileName !== "studio-review.webp");
  for (const { document } of referenced) expect(project).toContain(`/uploaded-assets/asset-${document.id}`);
});
