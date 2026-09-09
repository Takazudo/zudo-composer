import { assetKindForMime, ASSET_KINDS } from "./asset-kinds.mjs";
import type { AssetExtension, AssetType } from "./types";

export interface SniffedAsset { mimeType: AssetType; extension: AssetExtension }
function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function sniffAsset(bytes: Uint8Array, declaredMimeType?: string): SniffedAsset | undefined {
  let mimeType: AssetType | undefined;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) mimeType = "image/png";
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) mimeType = "image/jpeg";
  else if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) mimeType = "image/gif";
  else if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) mimeType = "image/webp";
  else if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) mimeType = "application/pdf";
  else if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) mimeType = "application/zip";
  else {
    const declared = declaredMimeType?.split(";", 1)[0]?.trim().toLowerCase();
    const kind = declared === undefined ? undefined : assetKindForMime(declared);
    if (kind?.kind === "text") mimeType = declared as AssetType;
  }
  if (mimeType === undefined) return undefined;
  const descriptor = ASSET_KINDS[mimeType];
  return descriptor === undefined ? undefined : { mimeType, extension: descriptor.extension as AssetExtension };
}
