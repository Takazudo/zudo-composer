import type { DomainFileProviderMiddlewareOptions } from "./domain-file-provider.mjs";
import type { DomainProviderBinding, DomainProviderDescriptor } from "./domain-file-provider-plugin.mjs";

export const WORKSPACE_DOMAIN: "workspace";
export const WORKSPACE_REGISTRY_DIRECTORY: "workspaces";

export interface WorkspaceDomainRoots {
  compositions: string;
  content: string;
  mappings: string;
  sitemaps: string;
}

export function resolveWorkspaceRegistryRoot(dataRoot: string): string;

/** The methods the transport dispatches; concrete signatures come from the loaded module. */
export type WorkspaceProviderService = Record<
  "list" | "selection" | "generation" | "open" | "findSeeding" | "create"
  | "markSeedCleanup" | "discardSeeding" | "complete" | "update"
  | "deleteDirectories" | "missingDirectories",
  (...args: never[]) => unknown
>;

export interface WorkspaceProviderModule<Service extends WorkspaceProviderService> {
  isWorkspaceRegistryError(value: unknown): boolean;
  createWorkspaceRegistryService(options: {
    registryRoot: string;
    domainRoots: WorkspaceDomainRoots;
  }): Promise<Service>;
}

export const WORKSPACE_PROVIDER_OPERATIONS: Record<string, (service: WorkspaceProviderService, payload: unknown) => unknown>;

export default function workspaceDomainProvider(options: {
  registryRoot: string;
  domainRoots: WorkspaceDomainRoots;
}): Omit<DomainProviderDescriptor, "bind"> & {
  bind<Service extends WorkspaceProviderService>(module: WorkspaceProviderModule<Service>, root: string): Pick<DomainFileProviderMiddlewareOptions<Service>, "isDomainError" | "createStore" | "operations">;
  /** Untyped SSR module loading retains the common descriptor's opaque binding. */
  bind(module: Record<string, unknown>, root: string): DomainProviderBinding;
};
