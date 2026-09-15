import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { ASSET_CHECKSUM_URL_PATTERN } from "../../src/assets/model/asset-kinds.mjs";
import { siteHeaders, type StaticSiteCompilation } from "../site-build.mjs";

type AssetFile = StaticSiteCompilation["assetFiles"][number];

async function publicUploads(directory: string): Promise<AssetFile[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true, recursive: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.name === ".gitkeep") continue;
    const absolute = resolve(entry.parentPath, entry.name);
    files.push({ fileName: `uploaded-assets/${relative(directory, absolute).split(sep).join("/")}`, source: await readFile(absolute) });
  }
  return files;
}

/** Merge release pins with the host's already-resolved publicAssets directory. */
export async function collectStaticSiteAssets({ assetFiles, publicAssets }: {
  assetFiles: AssetFile[];
  publicAssets: string;
}): Promise<{ files: AssetFile[]; headers: string }> {
  const emitted = new Map<string, Uint8Array>();
  for (const file of [...assetFiles, ...await publicUploads(publicAssets)]) {
    const existing = emitted.get(file.fileName);
    if (existing && Buffer.compare(existing, file.source) !== 0) throw new Error(`Two different files claim ${file.fileName}.`);
    emitted.set(file.fileName, file.source);
  }
  const files = [...emitted].map(([fileName, source]) => ({ fileName, source }));
  const pinned = files.filter(({ fileName }) => ASSET_CHECKSUM_URL_PATTERN.test(`/${fileName}`));
  return {
    files,
    headers: siteHeaders(pinned.map(({ fileName, source }) => ({ path: fileName, byteLength: source.byteLength }))),
  };
}
