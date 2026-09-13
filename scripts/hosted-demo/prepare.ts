import { createHash } from "node:crypto";
import { readFile, lstat, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { sniffAsset } from "../../src/assets/model/sniff";
import { activeDemoAssetSnapshot, demoAssetInventory } from "./asset-snapshot";

/** Only catalog-referenced immutable bytes enter the disposable editor. */
export async function prepareDemoAsset(directory: string) {
  const root = resolve(directory);
  const safeRead = async (relative: string) => {
    const path = resolve(root, relative);
    if (!(await lstat(path)).isFile() || await realpath(path) !== path) throw new Error(`Demo source must be a real committed file: ${relative}`);
    return readFile(path);
  };
  const snapshot = activeDemoAssetSnapshot(JSON.parse((await safeRead("catalog.json")).toString()));
  const files: { fileName: string; source: Uint8Array }[] = [];
  for (const [fileName, version] of Object.entries(demoAssetInventory(snapshot))) {
    const source = await safeRead(`versions/${basename(fileName)}`);
    if (createHash("sha256").update(source).digest("hex") !== version.sha256
      || source.byteLength !== version.byteLength
      || sniffAsset(source, version.mimeType)?.mimeType !== version.mimeType) {
      throw new Error(`Demo checksum/byte length/MIME mismatch: ${fileName}`);
    }
    files.push({ fileName, source });
  }
  return { snapshot, files };
}
