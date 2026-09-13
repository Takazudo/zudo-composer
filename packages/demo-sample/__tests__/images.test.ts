import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";

it("preserves the original Studio project without host-owned imagery", async () => {
  // The byte-identical original project uses its installed provider's placeholder.
  // The five optional repository Assets seed images are separate demo content.
  const images = new URL("../images-src/", import.meta.url);
  expect(JSON.parse(await readFile(new URL("manifest.json", images), "utf8"))).toEqual([]);
  expect((await readdir(images)).sort()).toEqual(["manifest.json"]);
  const project = await readFile(new URL("../site-project.json", import.meta.url), "utf8");
  expect(project).not.toContain("uploaded-assets/");
});
