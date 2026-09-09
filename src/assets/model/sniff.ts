import type { AssetType } from "./types";
interface SniffedAsset { mimeType: AssetType; extension: "png" | "jpg" | "gif" | "webp" | "pdf" }
function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

export function sniffAsset(bytes: Uint8Array): SniffedAsset | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mimeType: "image/png", extension: "png" };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", extension: "jpg" };
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) || startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return { mimeType: "image/gif", extension: "gif" };
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50])) return { mimeType: "image/webp", extension: "webp" };
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mimeType: "application/pdf", extension: "pdf" };
  return undefined;
}
