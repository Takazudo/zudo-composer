import type { Plugin } from "vite";

export const DOMAIN_PROVIDERS_MODULE_ID: "virtual:composer-domain-providers";

export interface DomainProviderBinding {
  isDomainError(value: unknown): boolean;
  createStore(): Promise<unknown>;
  operations: Record<string, (store: never, payload: unknown) => unknown>;
  applyTransaction?(store: never, request: unknown): Promise<unknown>;
}

export interface DomainProviderDescriptor {
  domain: string;
  /** Package-relative Node entry loaded through `ssrLoadModule`. */
  entryModule: string;
  resolveRoot(workspaceRoot: string): string;
  bind(module: Record<string, unknown>, root: string): DomainProviderBinding;
}

export default function domainFileProviderPlugin(options: {
  descriptors: readonly DomainProviderDescriptor[];
  workspaceRoot?: string;
  maxBodyBytes?: number;
}): Plugin;
