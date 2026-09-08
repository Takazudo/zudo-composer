import { expect, it } from "vitest";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareDemoMedia } from "./prepare";
it("exports only explicit media and refuses allowlist checksum or metadata drift", async () => {
  const root = await mkdtemp(join(tmpdir(), "hosted-media-"));
  try {
    await cp(resolve("cms/media"), root, { recursive: true });
    await writeFile(join(root, "private.txt"), "MUST NOT SHIP");
    expect((await prepareDemoMedia(root)).files).toHaveLength(4);
    const path = join(root, "catalog.json"); const catalog = JSON.parse(await readFile(path, "utf8"));
    catalog.records[0].document.fileName = "private-name.png"; await writeFile(path, JSON.stringify(catalog));
    await expect(prepareDemoMedia(root)).rejects.toThrow("missing or ambiguous");
    await cp(resolve("cms/media/catalog.json"), path);
    const first = (await prepareDemoMedia(root)).files[0]!;
    await writeFile(join(root, "versions", first.fileName.split("/").at(-1)!), "not png");
    await expect(prepareDemoMedia(root)).rejects.toThrow("checksum/MIME");
  } finally { await rm(root, { recursive: true, force: true }); }
});
