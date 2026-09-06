import type { DomainProviderDescriptor } from "./domain-file-provider-plugin.mjs";

export const WORKSPACE_DOMAIN: "workspace";
export const WORKSPACE_REGISTRY_DIRECTORY: "workspaces";

export interface WorkspaceDomainRoots {
  compositions: string;
  content: string;
  mappings: string;
  sitemaps: string;
}

export function resolveWorkspaceRegistryRoot(dataRoot: string): string;

export const WORKSPACE_PROVIDER_OPERATIONS: Record<string, (service: never, payload: unknown) => unknown>;

export default function workspaceDomainProvider(options: {
  registryRoot: string;
  domainRoots: WorkspaceDomainRoots;
}): DomainProviderDescriptor;
