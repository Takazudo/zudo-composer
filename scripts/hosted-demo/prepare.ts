import { createHash } from "node:crypto";
import { readFile, lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { validateAssetSnapshot, type AssetSnapshot } from "../../src/assets/model";
import { sniffAsset } from "../../src/assets/model/sniff";
export const DEMO_ASSET = [
  ["demo-sunrise.png", "c62b425177a0c01dba4bd49fec9b57efe0bce6632eeb5963d3cf1a66c60a62c6"],
  ["demo-lagoon.png", "f4f1c312c4eb572a0963f70fad3252160fd9307a0837ddcaf7eecde8b152c6e8"],
  ["demo-orchard.png", "f66cc2af6c35ef2970a9e1f7e7980b7ed7fc7eea30afdcefc797420edd44f8d8"],
  ["demo-twilight.png", "849da52a0b7f631df48cacfeb1417e7067993aea5deffda87b5c2dd67c6aabda"],
] as const;
export async function prepareDemoAsset(root: string) {
  const safeRead = async (relative: string) => { const path = resolve(root, relative); if ((await lstat(path)).isSymbolicLink() || await realpath(path) !== path) throw new Error(`Demo source must be a real committed file: ${relative}`); return readFile(path); };
  const catalog: unknown = JSON.parse((await safeRead("catalog.json")).toString());
  if (!validateAssetSnapshot(catalog)) throw new Error("Invalid committed demo assets catalog.");
  const records = []; const files: { fileName: string; source: Uint8Array }[] = [];
  for (const [name, checksum] of DEMO_ASSET) {
    const matches = catalog.records.filter((r) => r.document.fileName === name);
    if (matches.length !== 1) throw new Error(`Allowlisted demo asset missing or ambiguous: ${name}`);
    const r = matches[0]!; const v = r.document.versions.find((v) => v.id === checksum);
    if (!v || v.mimeType !== "image/png" || r.document.currentVersionId !== checksum || r.document.state !== "active" || r.document.folderId !== null || r.document.versions.length !== 1) throw new Error(`Unexpected allowlisted demo asset history: ${name}`);
    const source = await safeRead(`versions/sha256-${checksum}.png`);
    if (createHash("sha256").update(source).digest("hex") !== checksum || source.length !== v.byteLength || sniffAsset(source)?.mimeType !== v.mimeType) throw new Error(`Demo checksum/MIME mismatch: ${name}`);
    records.push(structuredClone(r)); files.push({ fileName: v.url.slice(1), source });
  }
  const snapshot: AssetSnapshot = { schemaVersion: 1, mutationToken: "0".repeat(64), records, folders: [] };
  return { snapshot, files };
}
