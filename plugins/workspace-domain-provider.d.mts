import type * as WorkspaceEntry from "../src/app/workspace-filesystem/dev-server-entry";
import type { DomainFileProviderMiddlewareOptions } from "./domain-file-provider.mjs";
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

export const WORKSPACE_PROVIDER_OPERATIONS: Record<string, (service: WorkspaceEntry.WorkspaceRegistryService, payload: unknown) => unknown>;

export default function workspaceDomainProvider(options: {
  registryRoot: string;
  domainRoots: WorkspaceDomainRoots;
}): Omit<DomainProviderDescriptor, "bind"> & {
  bind(module: typeof WorkspaceEntry, root: string): Pick<DomainFileProviderMiddlewareOptions<WorkspaceEntry.WorkspaceRegistryService>, "isDomainError" | "createStore" | "operations">;
};
