// @ts-check
// The Mapping half of the shared domain file-provider transport.
//
// A domain descriptor is deliberately small: where its records live, which
// Node entry the dev server loads, and how a wire operation name maps to a
// store method. Everything about HTTP, capabilities and error serialization
// belongs to `domain-file-provider-plugin.mjs`, so adding a domain is this file
// plus one line in the plugin's descriptor list.
//
// Mapping has no atomic batch of its own — unlike Content's `transact` — so it
// supplies `applyTransaction` instead, handing a whole `{expectedMutationToken,
// steps}` request straight to the store, which runs it as one commit protected
// by the record store's own opaque mutation token.

import { resolve } from "node:path";

export const MAPPING_DOMAIN = "mapping";

/**
 * Host-root-relative default for the Mapping directory. `DEFAULT_SETTINGS` in
 * `server/config/settings.ts` is the authority; this repeats the value because
 * plugin modules run in the Vite config graph and cannot import TypeScript.
 * `plugins/__tests__/mapping-domain-provider.test.ts` pins the two together.
 */
export const MAPPING_DIR_DEFAULT = "cms/mappings";
export const MAPPING_DIR_ENV = "ZUDO_COMPOSER_MAPPINGS_DIR";

/**
 * Explicit absolute option, then the host-root-relative environment override,
 * then the documented default.
 *
 * @param {string} workspaceRoot
 * @param {string | undefined} configured
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveMappingRoot(workspaceRoot, configured, env = process.env) {
  if (configured !== undefined) {
    if (resolve(configured) !== configured) throw new Error("Mapping root must be an absolute resolved path.");
    return configured;
  }
  const override = env[MAPPING_DIR_ENV]?.trim();
  return resolve(workspaceRoot, override ? override : MAPPING_DIR_DEFAULT);
}

/** @param {unknown} payload @param {string} key */
function field(payload, key) {
  return payload === null || typeof payload !== "object" ? undefined : /** @type {any} */ (payload)[key];
}

/** One wire operation per `MappingStore` method, plus the two initialization entry points. */
const OPERATIONS = {
  list: (store) => store.list(),
  "read-all": (store) => store.readAll(),
  snapshot: (store) => store.snapshot(),
  get: (store, payload) => store.get(field(payload, "id")),
  put: (store, payload) => store.put(field(payload, "record")),
  delete: (store, payload) => store.delete(field(payload, "id")),
  seed: (store, payload) => store.seed(field(payload, "seed")),
  clear: (store) => store.clear(),
  initialize: (store) => store.initialize(),
  "start-fresh": (store) => store.startFresh(),
};

/** @param {{mappingsRoot?: string}} [options] */
export default function mappingDomainProvider(options = {}) {
  return {
    domain: MAPPING_DOMAIN,
    entryModule: "src/mapping/storage/file-provider/dev-server-entry.ts",
    /** @param {string} workspaceRoot */
    resolveRoot: (workspaceRoot) => resolveMappingRoot(workspaceRoot, options.mappingsRoot),
    /** @param {any} module @param {string} root */
    bind: (module, root) => ({
      isDomainError: module.isMappingPersistenceError,
      createStore: (workspaceId) => module.createWorkspaceScopedMappingStore(root, workspaceId),
      operations: OPERATIONS,
      applyTransaction: (store, request) => store.applyTransaction(request),
    }),
  };
}

export { OPERATIONS as MAPPING_PROVIDER_OPERATIONS };
