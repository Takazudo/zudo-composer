import assert from "node:assert/strict";
import { validateAssetSnapshot, type AssetSnapshot } from "../../src/assets/model";

export interface DemoAssetFile { sha256: string; byteLength: number; mimeType: string }

export function activeDemoAssetSnapshot(catalog: unknown): AssetSnapshot {
  assert.ok(validateAssetSnapshot(catalog), "Invalid committed demo assets catalog.");
  // Keep active empty folders too: they are authored organization. A valid
  // catalog guarantees that every active record/folder has active ancestry.
  return structuredClone({
    schemaVersion: 1,
    mutationToken: "0".repeat(64),
    records: catalog.records.filter(({ document }) => document.state === "active"),
    folders: catalog.folders.filter(({ state }) => state === "active"),
  });
}

export function demoAssetInventory(snapshot: AssetSnapshot): Record<string, DemoAssetFile> {
  const files = new Map<string, DemoAssetFile>();
  for (const record of snapshot.records) for (const version of record.document.versions) {
    const path = version.url.slice(1);
    const file = { sha256: version.checksum, byteLength: version.byteLength, mimeType: version.mimeType };
    if (files.has(path)) assert.deepEqual(files.get(path), file, `Conflicting demo version metadata: ${path}`);
    files.set(path, file);
  }
  return Object.fromEntries([...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
