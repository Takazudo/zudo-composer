// @vitest-environment node
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { discoverPackedHosts } from "../packed-host-helpers.mjs";
import { demoFileNames } from "../seed-demo-assets";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const MAX_FILE_BYTES = 250 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;

// Studio's optional repository Assets seed stays central. The byte-identical
// demo-studio host has no images of its own; each other host owns its shot count.
const studio = { manifest: "scripts/demo/sample-studio.manifest.json", dir: "scripts/demo-assets", count: 5 };

type Entry = { file: string; alt: string; use: string; aspect: string };

async function readManifest(path: string): Promise<Entry[]> {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8")) as Entry[];
}

function isWebp(bytes: Buffer) {
  return bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP";
}

describe("demo imagery budget", () => {
  it.each([studio])("$manifest lists every shot as budgeted WebP/SVG with alt text", async ({ manifest, dir, count }) => {
    const entries = await readManifest(manifest);
    expect(entries).toHaveLength(count);
    expect(new Set(entries.map(({ file }) => file)).size).toBe(count);
    for (const entry of entries) {
      expect(entry.alt.trim(), entry.file).not.toBe("");
      expect(entry.use.trim(), entry.file).not.toBe("");
      expect(entry.aspect, entry.file).toMatch(/^\d+:\d+$/);
      const bytes = await readFile(resolve(repositoryRoot, dir, entry.file));
      expect(bytes.byteLength, entry.file).toBeGreaterThan(0);
      expect(bytes.byteLength, entry.file).toBeLessThanOrEqual(MAX_FILE_BYTES);
      if (extname(entry.file) === ".svg") expect(bytes.toString("utf8"), entry.file).toMatch(/<svg[\s>]/);
      else expect([extname(entry.file), isWebp(bytes)], entry.file).toEqual([".webp", true]);
    }
  });

  it("keeps all demo imagery within the repository budget", async () => {
    let total = 0;
    const manifests = [studio, ...discoverPackedHosts(repositoryRoot).map((host) => ({
      manifest: resolve(host, "images-src/manifest.json"), dir: resolve(host, "images-src"),
    }))];
    for (const { manifest, dir } of manifests) {
      for (const { file } of await readManifest(manifest)) total += (await stat(resolve(repositoryRoot, dir, file))).size;
    }
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });

  it("registers every Sample Studio image with the demo Assets seed", async () => {
    const studio = await readManifest("scripts/demo/sample-studio.manifest.json");
    expect(demoFileNames).toEqual(expect.arrayContaining(studio.map(({ file }) => file)));
  });
});
