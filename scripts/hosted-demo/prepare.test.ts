import { expect, it } from "vitest";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareDemoAsset } from "./prepare";
it("exports only explicit assets and refuses allowlist checksum or metadata drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "hosted-assets-"));
  try {
    await cp(resolve("cms/assets"), root, { recursive: true });
    await writeFile(join(root, "private.txt"), "MUST NOT SHIP");
    expect((await prepareDemoAsset(root)).files).toHaveLength(4);
    const path = join(root, "catalog.json"); const catalog = JSON.parse(await readFile(path, "utf8"));
    catalog.records[0].document.fileName = "private-name.png"; await writeFile(path, JSON.stringify(catalog));
    await expect(prepareDemoAsset(root)).rejects.toThrow("missing or ambiguous");
    await cp(resolve("cms/assets/catalog.json"), path);
    const first = (await prepareDemoAsset(root)).files[0]!;
    await writeFile(join(root, "versions", first.fileName.split("/").at(-1)!), "not png");
    await expect(prepareDemoAsset(root)).rejects.toThrow("checksum/MIME");
  } finally { await rm(root, { recursive: true, force: true }); }
});
