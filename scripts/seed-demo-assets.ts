import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFilesystemAssetStore } from "../src/assets/storage/filesystem/store";
import { assetMimeTypeForExtension } from "../src/assets/model";

// Committed source bytes keep checksums stable across machines and reruns.
export const demoFileNames = [
  "demo-sunrise.png", "demo-lagoon.png", "demo-orchard.png", "demo-twilight.png",
  "demo-guide.pdf", "demo-archive.zip",
] as const;
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

/** Seed this repository's dogfood store, preserving existing records and history. */
export async function seedDemoAsset(assetsStoreRoot = resolve(repositoryRoot, "cms/assets")) {
  const store = await createFilesystemAssetStore({ assetsStoreRoot });
  let added = 0;
  for (const fileName of demoFileNames) {
    const bytes = await readFile(new URL(`./demo-assets/${fileName}`, import.meta.url));
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const declaredMimeType = assetMimeTypeForExtension(fileName.slice(fileName.lastIndexOf(".") + 1));
    if (declaredMimeType === undefined) throw new Error(`No Assets MIME contract for seed file: ${fileName}`);
    const snapshot = await store.snapshot();
    // Include trash and historical versions: seeding must not undo an author's edits.
    if (snapshot.records.some(({ document }) => document.fileName === fileName
      && document.versions.some((version) => version.checksum === checksum))) continue;
    await store.upload({ fileName, bytes, declaredMimeType,
      note: "Demo illustration supplied by zudo-composer.",
      // A simultaneous writer fails safely; rerun after that writer finishes.
      expectedMutationToken: snapshot.mutationToken });
    added++;
  }
  return { added, skipped: demoFileNames.length - added };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedDemoAsset().then(({ added, skipped }) => {
    console.log(`Demo assets: added ${added}, already present ${skipped}.`);
  }).catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
