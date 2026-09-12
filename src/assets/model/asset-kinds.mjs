// Shared Assets MIME contract.
//
// This module deliberately has no TypeScript or Node dependencies: the browser
// model, Vite's Node plugins and the hosted-demo worker build all consume the
// same table and its derived URL/header helpers.

/** @typedef {"image" | "document" | "archive" | "text"} AssetKindName */
/** @typedef {{ extension: string, kind: AssetKindName, previewable: boolean, inline: boolean }} AssetKindDescriptor */

/** @type {Readonly<Record<string, AssetKindDescriptor>>} */
export const ASSET_KINDS = Object.freeze({
  "image/png": Object.freeze({ extension: "png", kind: "image", previewable: true, inline: true }),
  "image/jpeg": Object.freeze({ extension: "jpg", kind: "image", previewable: true, inline: true }),
  "image/gif": Object.freeze({ extension: "gif", kind: "image", previewable: true, inline: true }),
  "image/webp": Object.freeze({ extension: "webp", kind: "image", previewable: true, inline: true }),
  "application/pdf": Object.freeze({ extension: "pdf", kind: "document", previewable: true, inline: true }),
  "application/zip": Object.freeze({ extension: "zip", kind: "archive", previewable: false, inline: false }),
  "text/plain": Object.freeze({ extension: "txt", kind: "text", previewable: false, inline: false }),
  "text/csv": Object.freeze({ extension: "csv", kind: "text", previewable: false, inline: false }),
  "application/json": Object.freeze({ extension: "json", kind: "text", previewable: false, inline: false }),
});

/** @type {readonly string[]} */
export const ASSET_TYPES = Object.freeze(Object.keys(ASSET_KINDS));
export const ASSET_TYPE_ALLOWLIST = ASSET_TYPES;

/** @type {Readonly<Record<string, string>>} */
export const ASSET_EXTENSION_BY_TYPE = Object.freeze(Object.fromEntries(
  Object.entries(ASSET_KINDS).map(([mimeType, descriptor]) => [mimeType, descriptor.extension]),
));

/** @type {Readonly<Record<string, string>>} */
export const ASSET_CONTENT_TYPE_BY_EXTENSION = Object.freeze(Object.fromEntries(
  Object.entries(ASSET_KINDS).map(([mimeType, descriptor]) => [descriptor.extension, mimeType]),
));

const extensions = [...new Set(Object.values(ASSET_KINDS).map(({ extension }) => extension))];
const extensionAlternation = extensions.map((extension) => extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
export const ASSET_EXTENSION_ALTERNATION = extensionAlternation;
export const ASSET_ACCEPT = ASSET_TYPES.join(",");

/** Regex source for one checksum-derived file name, without anchors. */
export const ASSET_CHECKSUM_FILE_NAME_SOURCE = `sha256-[a-f0-9]{64}\\.(?:${extensionAlternation})`;
/** Regex source for one checksum-derived asset URL, without anchors. */
export const ASSET_CHECKSUM_URL_SOURCE = `/uploaded-assets/${ASSET_CHECKSUM_FILE_NAME_SOURCE}`;
export const ASSET_CHECKSUM_FILE_NAME_PATTERN = new RegExp(`^${ASSET_CHECKSUM_FILE_NAME_SOURCE}$`);
export const ASSET_CHECKSUM_URL_PATTERN = new RegExp(`^${ASSET_CHECKSUM_URL_SOURCE}$`);
export const ASSET_PIN_FILE_NAME_PATTERN = new RegExp(`^asset-${ASSET_CHECKSUM_FILE_NAME_SOURCE}$`);
export const ASSET_AUTHORING_URL_PATTERN = /^\/uploaded-assets\/asset-[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/;

export const ASSET_IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const ASSET_NOSNIFF = "nosniff";

/** @param {string} mimeType @returns {AssetKindDescriptor | undefined} */
export function assetKindForMime(mimeType) {
  return ASSET_KINDS[mimeType];
}

/** @param {string} extension @returns {string | undefined} */
export function assetMimeTypeForExtension(extension) {
  return ASSET_CONTENT_TYPE_BY_EXTENSION[extension.toLowerCase()];
}

/**
 * Return the deterministic download name for a stored version. Inline kinds
 * intentionally have no Content-Disposition header.
 * @param {string} mimeType
 * @param {string} checksum
 * @returns {string | undefined}
 */
export function assetContentDisposition(mimeType, checksum) {
  const descriptor = assetKindForMime(mimeType);
  if (!descriptor || descriptor.inline) return undefined;
  return `attachment; filename="${checksum}.${descriptor.extension}"`;
}

/** @param {Array<{ path: string, byteLength: number }>} files @returns {string} */
export function hostedAssetHeaders(files) {
  return [...files].sort((a, b) => a.path.localeCompare(b.path)).map(({ path, byteLength }) => {
    if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw new Error(`Invalid asset byte length: ${path}`);
    if (!ASSET_CHECKSUM_URL_PATTERN.test(`/${path}`)) throw new Error(`Invalid hosted asset path: ${path}`);
    const mime = assetMimeTypeForExtension(path.slice(path.lastIndexOf(".") + 1));
    if (!mime) throw new Error(`Missing asset MIME: ${path}`);
    const checksum = path.slice("uploaded-assets/sha256-".length, path.lastIndexOf("."));
    const disposition = assetContentDisposition(mime, checksum);
    return [
      `/${path}`,
      `  Content-Type: ${mime}`,
      `  Content-Length: ${byteLength}`,
      `  Cache-Control: ${ASSET_IMMUTABLE_CACHE_CONTROL}`,
      `  X-Content-Type-Options: ${ASSET_NOSNIFF}`,
      ...(disposition ? [`  Content-Disposition: ${disposition}`] : []),
    ].join("\n");
  }).join("\n\n") + "\n";
}
