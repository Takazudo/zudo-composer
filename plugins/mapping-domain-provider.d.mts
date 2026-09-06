import type { FilesystemMappingStore } from "../src/mapping/storage/filesystem";
import type { DomainProviderDescriptor } from "./domain-file-provider-plugin.mjs";

export const MAPPING_DOMAIN: "mapping";
export const MAPPING_DIR_DEFAULT: string;
export const MAPPING_DIR_ENV: "ZUDO_COMPOSER_MAPPINGS_DIR";

export const MAPPING_PROVIDER_OPERATIONS: Record<string, (store: FilesystemMappingStore, payload: unknown) => unknown>;

export function resolveMappingRoot(
  workspaceRoot: string,
  configured?: string,
  env?: Record<string, string | undefined>,
): string;

export default function mappingDomainProvider(options?: { mappingsRoot?: string }): DomainProviderDescriptor;
