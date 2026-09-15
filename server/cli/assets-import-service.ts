import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { AssetPersistenceError } from "../../src/assets/library";
import { ASSET_MAX_BYTE_LENGTH, assetMimeTypeForExtension, isValidAssetFileName } from "../../src/assets/model";
import { sniffAsset } from "../../src/assets/model/sniff";
import { createFilesystemAssetStore } from "../../src/assets/storage/filesystem/store";
import { isPlainObject } from "../../src/shared";
import type { ResolvedComposerConfig } from "../config";

export interface AssetImportRequest { manifest: string }
export interface AssetImportResult { added: number; skipped: number }
export type AssetImportResponse =
  | { ok: true; result: AssetImportResult }
  | { ok: false; error: { code: string; message: string } };

/** The existing images-src manifest may carry extra presentation metadata. */
interface ManifestEntry { file: string; note?: string; alt?: string }
interface PreparedAsset { path: string; fileName: string; checksum: string; declaredMimeType: string; note: string }

class AssetImportError extends Error {
  constructor(readonly code: "validation" | "not-found" | "conflict", message: string) { super(message); }
}

function validate(message: string): never { throw new AssetImportError("validation", message); }
function sameFile(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino; }
function inside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

/** Bound allocations and refuse symlinks, devices and paths that escape the source directory. */
async function readSource(path: string, limit: number, sourceRoot?: string): Promise<{ bytes: Buffer; realPath: string }> {
  let handle;
  try {
    const before = await lstat(path);
    const realPath = await realpath(path);
    if (!before.isFile() || before.isSymbolicLink() || (sourceRoot !== undefined && !inside(sourceRoot, realPath))) {
      validate(`Asset import source must be a regular file inside its manifest directory: ${path}`);
    }
    if (before.size > limit) validate(`Asset import source exceeds the ${limit}-byte limit: ${path}`);
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFile(before, opened)) validate(`Asset import source changed while opening: ${path}`);
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      const bytes = Buffer.from(chunk as Uint8Array);
      length += bytes.byteLength;
      if (length > limit) validate(`Asset import source exceeds the ${limit}-byte limit: ${path}`);
      chunks.push(bytes);
    }
    const after = await handle.stat();
    const current = await lstat(path);
    if (current.isSymbolicLink() || !sameFile(opened, current) || opened.size !== length
      || after.size !== length || opened.mtimeMs !== after.mtimeMs || await realpath(path) !== realPath) {
      validate(`Asset import source changed while reading: ${path}`);
    }
    return { bytes: Buffer.concat(chunks), realPath };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new AssetImportError("not-found", `Asset import source does not exist: ${path}`);
    throw error;
  } finally { await handle?.close(); }
}

function parseManifest(raw: unknown): ManifestEntry[] {
  if (!Array.isArray(raw)) validate('Asset manifest must be a JSON list of { "file": string, "note"?: string, "alt"?: string }.');
  return raw.map((entry: unknown, index): ManifestEntry => {
    if (!isPlainObject(entry) || typeof entry.file !== "string") validate(`Asset manifest entry ${index + 1} requires a file path.`);
    const segments = entry.file.split("/");
    if (isAbsolute(entry.file) || win32.isAbsolute(entry.file) || entry.file.includes("\\")
      || segments.some((segment) => segment === "." || segment === ".." || !isValidAssetFileName(segment))
      || /^[a-z]:/i.test(entry.file)) {
      validate(`Asset manifest entry ${index + 1} must name a relative file inside the manifest directory: ${entry.file}`);
    }
    for (const key of ["note", "alt"] as const) {
      if (entry[key] !== undefined && (typeof entry[key] !== "string" || entry[key].length > 10000)) {
        validate(`Asset manifest entry ${index + 1} ${key} must be a string of at most 10000 characters.`);
      }
    }
    return { file: entry.file, note: entry.note as string | undefined, alt: entry.alt as string | undefined };
  });
}

const checksum = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** Validate every source before creating a store; keep at most one asset's bytes in memory. */
async function prepareManifest(path: string): Promise<{ assets: PreparedAsset[]; sourceRoot: string }> {
  const source = await readSource(path, 8 * 1024 * 1024);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source.bytes)) as unknown; }
  catch { validate(`Asset manifest is not valid UTF-8 JSON: ${path}`); }
  const entries = parseManifest(raw);
  const sourceRoot = dirname(source.realPath);
  const assets: PreparedAsset[] = [];
  for (const entry of entries) {
    const fileName = entry.file.split("/").at(-1)!;
    const declaredMimeType = assetMimeTypeForExtension(extname(fileName).slice(1));
    if (declaredMimeType === undefined) validate(`No Assets MIME contract for import file: ${entry.file}`);
    const path = resolve(sourceRoot, entry.file);
    const { bytes } = await readSource(path, ASSET_MAX_BYTE_LENGTH, sourceRoot);
    if (bytes.byteLength === 0 || sniffAsset(bytes, declaredMimeType)?.mimeType !== declaredMimeType) {
      validate(`Asset import bytes do not match the supported file type: ${entry.file}`);
    }
    assets.push({ path, fileName, checksum: checksum(bytes), declaredMimeType, note: entry.note ?? entry.alt ?? "" });
  }
  return { assets, sourceRoot };
}

/** Host paths are already resolved by the same config loader the dev server uses. */
export function createAssetImportService(config: Pick<ResolvedComposerConfig, "workspaceRoot" | "paths">) {
  return {
    async handle(request: unknown): Promise<AssetImportResponse> {
      if (!isPlainObject(request) || Object.keys(request).length !== 1 || typeof request.manifest !== "string"
        || request.manifest.trim() === "" || request.manifest.includes("\0")) {
        return { ok: false, error: { code: "malformed-request", message: 'Asset import requires one JSON request: { "manifest": "images-src/manifest.json" }.' } };
      }
      try {
        const { assets, sourceRoot } = await prepareManifest(resolve(config.workspaceRoot, request.manifest));
        const store = await createFilesystemAssetStore({ assetsStoreRoot: config.paths.assets });
        let added = 0;
        for (const asset of assets) {
          const snapshot = await store.snapshot();
          // Include trash and every retained version; never undo an author's changes.
          if (snapshot.records.some(({ document }) => document.fileName === asset.fileName
            && document.versions.some((version) => version.checksum === asset.checksum))) continue;
          const { bytes } = await readSource(asset.path, ASSET_MAX_BYTE_LENGTH, sourceRoot);
          if (checksum(bytes) !== asset.checksum) throw new AssetImportError("conflict", `Asset import source changed after validation: ${asset.path}`);
          await store.upload({ fileName: asset.fileName, bytes, declaredMimeType: asset.declaredMimeType,
            note: asset.note, expectedMutationToken: snapshot.mutationToken });
          added++;
        }
        return { ok: true, result: { added, skipped: assets.length - added } };
      } catch (error) {
        if (error instanceof AssetImportError || error instanceof AssetPersistenceError) {
          return { ok: false, error: { code: error.code, message: error.message } };
        }
        throw error;
      }
    },
  };
}
