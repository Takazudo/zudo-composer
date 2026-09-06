// @ts-check
// The workspace registry half of the shared domain file-provider transport.
//
// Unlike the four authoring domains this endpoint is not workspace scoped: it
// is the domain that names workspaces, so it answers from one registry root
// (`<dataDir>/workspaces`) and the browser sends no workspace header.
//
// The registry root is not a `ComposerSettings` entry. Making it configurable
// would be a settings addition, not a re-basing of an existing directory, so it
// is derived from `dataDir` here and passed in explicitly by the host config.

import { resolve } from "node:path";

export const WORKSPACE_DOMAIN = "workspace";

/** The registry's directory below the CMS data root. */
export const WORKSPACE_REGISTRY_DIRECTORY = "workspaces";

/** @param {string} dataRoot */
export function resolveWorkspaceRegistryRoot(dataRoot) {
  if (resolve(dataRoot) !== dataRoot) throw new Error("CMS data root must be an absolute resolved path.");
  return resolve(dataRoot, WORKSPACE_REGISTRY_DIRECTORY);
}

/** @param {unknown} payload @param {string} key */
function field(payload, key) {
  return payload === null || typeof payload !== "object" ? undefined : /** @type {any} */ (payload)[key];
}

/** One wire operation per registry method. */
const OPERATIONS = {
  list: (service) => service.list(),
  selection: (service) => service.selection(),
  generation: (service) => service.generation(),
  open: (service, payload) => service.open(field(payload, "id")),
  "find-seeding": (service, payload) => service.findSeeding(field(payload, "project"), field(payload, "revision")),
  create: (service, payload) => service.create(
    field(payload, "project"),
    field(payload, "baselineRevision"),
    field(payload, "id"),
    field(payload, "requiresBeforeComplete") === true,
  ),
  "mark-seed-cleanup": (service, payload) => service.markSeedCleanup(field(payload, "id"), field(payload, "revision")),
  "discard-seeding": (service, payload) => service.discardSeeding(field(payload, "id"), field(payload, "revision")),
  complete: (service, payload) => service.complete(field(payload, "id"), field(payload, "creationValidated") === true),
  update: (service, payload) => service.update(field(payload, "id"), field(payload, "expectedToken"), field(payload, "patch") ?? {}),
  "delete-directories": (service, payload) => service.deleteDirectories(field(payload, "id")),
  "missing-directories": (service, payload) => service.missingDirectories(field(payload, "id")),
};

/**
 * @param {{registryRoot: string, domainRoots: {compositions: string, content: string, mappings: string, sitemaps: string}}} options
 */
export default function workspaceDomainProvider(options) {
  return {
    domain: WORKSPACE_DOMAIN,
    entryModule: "src/app/workspace-filesystem/dev-server-entry.ts",
    workspaceScoped: false,
    resolveRoot: () => options.registryRoot,
    /** @param {any} module @param {string} root */
    bind: (module, root) => ({
      isDomainError: module.isWorkspaceRegistryError,
      // One service per request, exactly as every other domain builds one store
      // per request: the registry holds no in-memory state between calls.
      createStore: () => module.createWorkspaceRegistryService({ registryRoot: root, domainRoots: options.domainRoots }),
      operations: OPERATIONS,
    }),
  };
}

export { OPERATIONS as WORKSPACE_PROVIDER_OPERATIONS };
