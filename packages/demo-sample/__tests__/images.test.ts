import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";

it("preserves the original Studio project and its five-image asset seed", async () => {
  // The byte-identical original project uses its installed provider's placeholder.
  // The package-owned image seed remains separate demo content until the site
  // rewrite consumes it.
  const images = new URL("../images-src/", import.meta.url);
  const files = ["studio-workbench.webp", "studio-wall.webp", "studio-review.webp", "journal-question.webp", "journal-map.webp"];
  const manifest = JSON.parse(await readFile(new URL("manifest.json", images), "utf8")) as { file: string }[];
  expect(manifest.map(({ file }) => file)).toEqual(files);
  expect((await readdir(images)).sort()).toEqual([...files, "manifest.json"].sort());
  const catalog = JSON.parse(await readFile(new URL("../cms/assets/catalog.json", import.meta.url), "utf8")) as { records: { document: { fileName: string } }[] };
  expect(catalog.records.map(({ document }) => document.fileName)).toEqual(files);
  const project = await readFile(new URL("../site-project.json", import.meta.url), "utf8");
  expect(project).not.toContain("uploaded-assets/");
});
