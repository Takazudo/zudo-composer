// @ts-check
// The Content half of the shared domain file-provider transport.
//
// A domain descriptor is deliberately small: where its records live, which
// Node entry the dev server loads, and how a wire operation name maps to a
// store method. Everything about HTTP, capabilities and error serialization
// belongs to `domain-file-provider-plugin.mjs`, so adding a domain is this file
// plus one line in the plugin's descriptor list.

import { resolve } from "node:path";

export const CONTENT_DOMAIN = "content";

/**
 * Host-root-relative default for the Content directory. `DEFAULT_SETTINGS` in
 * `server/config/settings.ts` is the authority; this repeats the value because
 * plugin modules run in the Vite config graph and cannot import TypeScript.
 * `plugins/__tests__/content-domain-provider.test.ts` pins the two together.
 */
export const CONTENT_DIR_DEFAULT = "cms/content";
export const CONTENT_DIR_ENV = "ZUDO_COMPOSER_CONTENT_DIR";

/**
 * Explicit absolute option, then the host-root-relative environment override,
 * then the documented default.
 *
 * @param {string} workspaceRoot
 * @param {string | undefined} configured
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveContentRoot(workspaceRoot, configured, env = process.env) {
  if (configured !== undefined) {
    if (resolve(configured) !== configured) throw new Error("Content root must be an absolute resolved path.");
    return configured;
  }
  const override = env[CONTENT_DIR_ENV]?.trim();
  return resolve(workspaceRoot, override ? override : CONTENT_DIR_DEFAULT);
}

/** @param {unknown} payload @param {string} key */
function field(payload, key) {
  return payload === null || typeof payload !== "object" ? undefined : /** @type {any} */ (payload)[key];
}

/**
 * One wire operation per `ContentStore` method, plus the two initialization
 * entry points.
 *
 * There is no `applyTransaction`: Content's own `transact` already is a single
 * atomic request carrying its whole operation list and its own expected
 * mutation token, so the shared `{expectedMutationToken, steps}` envelope would
 * be a second one wrapped around it. A domain with no batch operation of its
 * own should supply `applyTransaction` instead.
 */
const OPERATIONS = {
  "read-all": (store) => store.readAll(),
  transact: (store, payload) => store.transact(payload),
  "reconcile-publication": (store, payload) =>
    store.reconcilePublication(field(payload, "reconciliations") ?? [], field(payload, "activationGeneration")),
  "list-models": (store) => store.listModels(),
  "get-model": (store, payload) => store.getModel(field(payload, "id")),
  "put-model": (store, payload) => store.putModel(field(payload, "record")),
  "delete-model": (store, payload) => store.deleteModel(field(payload, "id")),
  "count-entries": (store, payload) => store.countEntries(field(payload, "modelId")),
  "get-entry": (store, payload) => store.getEntry(field(payload, "id")),
  "page-entries": (store, payload) => store.pageEntries(field(payload, "modelId"), field(payload, "options") ?? {}),
  "scan-entries": (store, payload) => store.scanEntries(field(payload, "modelId")),
  "put-entry": (store, payload) => store.putEntry(field(payload, "record")),
  "delete-entry": (store, payload) => store.deleteEntry(field(payload, "id")),
  "remove-field": (store, payload) => store.removeField(field(payload, "modelId"), field(payload, "fieldId")),
  seed: (store, payload) => store.seed(field(payload, "seed")),
  clear: (store) => store.clear(),
  initialize: (store) => store.initialize(),
  "start-fresh": (store) => store.startFresh(),
};

/** @param {{contentRoot?: string}} [options] */
export default function contentDomainProvider(options = {}) {
  return {
    domain: CONTENT_DOMAIN,
    entryModule: "src/content/storage/file-provider/dev-server-entry.ts",
    /** @param {string} workspaceRoot */
    resolveRoot: (workspaceRoot) => resolveContentRoot(workspaceRoot, options.contentRoot),
    /** @param {any} module @param {string} root */
    bind: (module, root) => ({
      isDomainError: module.isContentPersistenceError,
      createStore: (workspaceId) => module.createWorkspaceScopedContentStore(root, workspaceId),
      operations: OPERATIONS,
    }),
  };
}

export { OPERATIONS as CONTENT_PROVIDER_OPERATIONS };
