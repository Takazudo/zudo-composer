import type { FilesystemSitemapStore } from "../src/sitemapper/storage/filesystem";
import type { DomainProviderDescriptor } from "./domain-file-provider-plugin.mjs";

export const SITEMAPPER_DOMAIN: "sitemapper";
export const SITEMAPPER_DIR_DEFAULT: string;
export const SITEMAPPER_DIR_ENV: "ZUDO_COMPOSER_SITEMAPS_DIR";

export const SITEMAPPER_PROVIDER_OPERATIONS: Record<string, (store: FilesystemSitemapStore, payload: unknown) => unknown>;

export function resolveSitemapperRoot(
  workspaceRoot: string,
  configured?: string,
  env?: Record<string, string | undefined>,
): string;

export default function sitemapperDomainProvider(options?: { sitemapsRoot?: string }): DomainProviderDescriptor;
