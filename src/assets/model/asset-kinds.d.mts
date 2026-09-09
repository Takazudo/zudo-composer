export type AssetKindName = "image" | "document" | "archive" | "text";
export interface AssetKindDescriptor {
  readonly extension: string;
  readonly kind: AssetKindName;
  readonly previewable: boolean;
  readonly inline: boolean;
}
export const ASSET_KINDS: Readonly<{
  readonly "image/png": { readonly extension: "png"; readonly kind: "image"; readonly previewable: true; readonly inline: true };
  readonly "image/jpeg": { readonly extension: "jpg"; readonly kind: "image"; readonly previewable: true; readonly inline: true };
  readonly "image/gif": { readonly extension: "gif"; readonly kind: "image"; readonly previewable: true; readonly inline: true };
  readonly "image/webp": { readonly extension: "webp"; readonly kind: "image"; readonly previewable: true; readonly inline: true };
  readonly "application/pdf": { readonly extension: "pdf"; readonly kind: "document"; readonly previewable: true; readonly inline: true };
  readonly "application/zip": { readonly extension: "zip"; readonly kind: "archive"; readonly previewable: false; readonly inline: false };
  readonly "text/plain": { readonly extension: "txt"; readonly kind: "text"; readonly previewable: false; readonly inline: false };
  readonly "text/csv": { readonly extension: "csv"; readonly kind: "text"; readonly previewable: false; readonly inline: false };
  readonly "application/json": { readonly extension: "json"; readonly kind: "text"; readonly previewable: false; readonly inline: false };
}>;
export const ASSET_TYPES: readonly ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "application/zip", "text/plain", "text/csv", "application/json"];
export const ASSET_TYPE_ALLOWLIST: typeof ASSET_TYPES;
export const ASSET_EXTENSION_BY_TYPE: Readonly<Record<string, string>>;
export const ASSET_CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>>;
export const ASSET_EXTENSION_ALTERNATION: string;
export const ASSET_ACCEPT: string;
export const ASSET_CHECKSUM_FILE_NAME_SOURCE: string;
export const ASSET_CHECKSUM_URL_SOURCE: string;
export const ASSET_CHECKSUM_FILE_NAME_PATTERN: RegExp;
export const ASSET_CHECKSUM_URL_PATTERN: RegExp;
export const ASSET_PIN_FILE_NAME_PATTERN: RegExp;
export const ASSET_AUTHORING_URL_PATTERN: RegExp;
export const ASSET_IMMUTABLE_CACHE_CONTROL: string;
export const ASSET_NOSNIFF: string;
export function assetKindForMime(mimeType: string): AssetKindDescriptor | undefined;
export function assetMimeTypeForExtension(extension: string): string | undefined;
export function assetContentDisposition(mimeType: string, checksum: string): string | undefined;
