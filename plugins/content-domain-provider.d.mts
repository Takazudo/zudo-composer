import type { FilesystemContentStore } from "../src/content/storage/filesystem";
import type { DomainProviderDescriptor } from "./domain-file-provider-plugin.mjs";

export const CONTENT_DOMAIN: "content";
export const CONTENT_DIR_DEFAULT: string;
export const CONTENT_DIR_ENV: "ZUDO_COMPOSER_CONTENT_DIR";

export const CONTENT_PROVIDER_OPERATIONS: Record<string, (store: FilesystemContentStore, payload: unknown) => unknown>;

export function resolveContentRoot(
  workspaceRoot: string,
  configured?: string,
  env?: Record<string, string | undefined>,
): string;

export default function contentDomainProvider(options?: { contentRoot?: string }): DomainProviderDescriptor;
