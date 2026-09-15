import { readFile, readdir } from "node:fs/promises";
import { extname } from "node:path";
import { expect, it } from "vitest";

type Image = { file: string; alt: string; use: string; aspect: string };
const images = new URL("../images-src/", import.meta.url);

it("owns 10 documented, budgeted WebP/SVG images", async () => {
  const entries = JSON.parse(await readFile(new URL("manifest.json", images), "utf8")) as Image[];
  expect(entries).toHaveLength(10);
  expect(new Set(entries.map(({ file }) => file)).size).toBe(10);
  expect((await readdir(images)).filter((file) => file !== "manifest.json").sort())
    .toEqual(entries.map(({ file }) => file).sort());
  for (const entry of entries) {
    expect(entry.file).toMatch(/^[^/\\]+\.(?:webp|svg)$/);
    expect(entry.alt.trim(), entry.file).not.toBe("");
    expect(entry.use.trim(), entry.file).not.toBe("");
    expect(entry.aspect, entry.file).toMatch(/^\d+:\d+$/);
    const bytes = await readFile(new URL(entry.file, images));
    expect(bytes.byteLength, entry.file).toBeGreaterThan(0);
    expect(bytes.byteLength, entry.file).toBeLessThanOrEqual(250 * 1024);
    if (extname(entry.file) === ".svg") expect(bytes.toString("utf8"), entry.file).toMatch(/<svg[\s>]/);
    else {
      expect(bytes.subarray(0, 4).toString(), entry.file).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString(), entry.file).toBe("WEBP");
    }
  }
});
