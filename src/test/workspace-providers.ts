// A complete filesystem workspace, driven through the real endpoints.
//
// The application talks to five capability-protected endpoints; a spec that
// stubbed them would be testing its own stubs. So this harness mounts the exact
// middleware the dev server mounts, over a temporary directory, and hands the
// browser providers a `fetch` that calls it in process. Workspace scoping,
// header admission, the JSX output-planning handshake and structured error
// round-tripping are therefore all live under test.
//
// Node modules are fair game here: the app test lane runs in Node with a jsdom
// global scope, and these are the same modules the dev server loads.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createDomainFileProviderMiddleware } from "../../plugins/domain-file-provider.mjs";
import { createComposerFileProviderMiddleware, COMPOSER_FILE_PROVIDER_ENDPOINT } from "../../plugins/composer-file-provider-plugin.mjs";
import { domainFileProviderEndpoint } from "../../plugins/file-provider-http.mjs";
import type { DevRequest, DevResponse } from "../../plugins/file-provider-http.mjs";
import contentDomainProvider from "../../plugins/content-domain-provider.mjs";
import mappingDomainProvider from "../../plugins/mapping-domain-provider.mjs";
import sitemapperDomainProvider from "../../plugins/sitemapper-domain-provider.mjs";
import workspaceDomainProvider from "../../plugins/workspace-domain-provider.mjs";
import type { DomainProviderDescriptor } from "../../plugins/domain-file-provider-plugin.mjs";
import * as contentEntry from "../content/storage/file-provider/dev-server-entry";
import * as mappingEntry from "../mapping/storage/file-provider/dev-server-entry";
import * as sitemapperEntry from "../sitemapper/storage/file-provider/dev-server-entry";
import * as workspaceEntry from "../app/workspace-filesystem/dev-server-entry";
import { validateCompositionRecord } from "../composer/library/validate";
import { createWorkspaceScopedCompositionStore } from "../composer/storage/file-provider/dev-server-entry";
import {
  FILE_PROVIDER_CAPABILITY_HEADER,
  FILE_PROVIDER_OPERATION_HEADER,
  FILE_PROVIDER_WORKSPACE_HEADER,
  type FileProviderConfig,
} from "../shared/file-provider";
import { createFileProviderCompositionStore, type ComposerFileProviderConfig } from "../composer/browser";
import { createFileProviderContentProvider } from "../content/storage/file-provider";
import { createFileProviderMappingProvider } from "../mapping/storage/file-provider";
import { createFileProviderSitemapProvider } from "../sitemapper/storage/file-provider";
import { createFileProviderWorkspaceStorage, WORKSPACE_FILE_PROVIDER_DOMAIN, type WorkspaceStorage } from "../app/workspace-storage";
import { activeComponentProvider } from "../features/composer/active-pack";
import type { WorkspaceProviderSet } from "../app/provider-integration";

const ORIGIN = "http://localhost";
const CAPABILITY = "test-development-capability";

type Handler = (request: DevRequest) => Promise<DevResponse>;

/** The admission head every endpoint requires, so the guards run for real. */
function devRequest(url: string, init: RequestInit): DevRequest {
  const headers = new Headers(init.headers);
  return {
    url,
    method: init.method ?? "GET",
    protocol: "http",
    headers: {
      ...Object.fromEntries(headers.entries()),
      host: "localhost",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: typeof init.body === "string" ? init.body : "",
  };
}

function routedFetch(routes: ReadonlyMap<string, Handler>): typeof fetch {
  return (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), ORIGIN);
    const handler = routes.get(url.pathname);
    if (!handler) throw new TypeError(`No development endpoint is mounted at ${url.pathname}.`);
    const response = await handler(devRequest(url.pathname, init));
    return new Response(response.body, { status: response.status, headers: response.headers });
  }) as typeof fetch;
}

function domainConfig(domain: string, workspaceScoped = true): FileProviderConfig {
  return {
    endpoint: domainFileProviderEndpoint(domain),
    capability: CAPABILITY,
    capabilityHeader: FILE_PROVIDER_CAPABILITY_HEADER,
    operationHeader: FILE_PROVIDER_OPERATION_HEADER,
    ...(workspaceScoped ? { workspaceHeader: FILE_PROVIDER_WORKSPACE_HEADER } : {}),
    maxBodyBytes: 2 * 1024 * 1024,
  };
}

function mountDomain(descriptor: DomainProviderDescriptor, module: unknown, root: string): [string, Handler] {
  const bound = descriptor.bind(module as Record<string, unknown>, root);
  return [domainFileProviderEndpoint(descriptor.domain), createDomainFileProviderMiddleware<never>({
    domain: descriptor.domain,
    capability: CAPABILITY,
    isDomainError: bound.isDomainError,
    operations: bound.operations,
    createStore: bound.createStore as (workspaceId: string | undefined) => Promise<never>,
    ...(descriptor.workspaceScoped === false ? { workspaceScoped: false } : {}),
    ...(bound.applyTransaction === undefined ? {} : { applyTransaction: bound.applyTransaction }),
  }) as Handler];
}

export interface TemporaryWorkspaceProviders {
  /** Pass straight to `createProductionProviderIntegration`. */
  createProviders(workspace: () => string): WorkspaceProviderSet;
  /** The registry on its own, for a spec that inspects it beside an integration. */
  storage: WorkspaceStorage;
  /** The host root the four domain directories and the registry live under. */
  root: string;
  dispose(): Promise<void>;
}

/**
 * Mount a fresh temporary host project behind the real endpoints.
 *
 * The result is a provider *factory*, because each integration resolves its own
 * open workspace and opening one builds a nested integration. The endpoints,
 * the directories and the registry are shared across every set it builds — one
 * host project, many views of it.
 */
export async function createTemporaryWorkspaceProviders(): Promise<TemporaryWorkspaceProviders> {
  const root = await mkdtemp(join(tmpdir(), "zudo-composer-workspace-"));
  const paths = {
    data: resolve(root, "cms"),
    compositions: resolve(root, "cms/compositions"),
    content: resolve(root, "cms/content"),
    mappings: resolve(root, "cms/mappings"),
    sitemaps: resolve(root, "cms/sitemaps"),
  };
  const registryRoot = resolve(paths.data, "workspaces");
  const domainRoots = {
    compositions: paths.compositions,
    content: paths.content,
    mappings: paths.mappings,
    sitemaps: paths.sitemaps,
  };

  const composerHandler = createComposerFileProviderMiddleware({
    capability: CAPABILITY,
    validateRecord: validateCompositionRecord,
    createStore: ({ workspaceId, provideJsx }) =>
      createWorkspaceScopedCompositionStore(paths.compositions, workspaceId, { provideJsx }),
  }) as Handler;

  const routes = new Map<string, Handler>([
    [COMPOSER_FILE_PROVIDER_ENDPOINT, composerHandler],
    mountDomain(workspaceDomainProvider({ registryRoot, domainRoots }), workspaceEntry, registryRoot),
    mountDomain(contentDomainProvider({ contentRoot: paths.content }), contentEntry, paths.content),
    mountDomain(mappingDomainProvider({ mappingsRoot: paths.mappings }), mappingEntry, paths.mappings),
    mountDomain(sitemapperDomainProvider({ sitemapsRoot: paths.sitemaps }), sitemapperEntry, paths.sitemaps),
  ]);
  const fetchImpl = routedFetch(routes);

  const composerConfig: ComposerFileProviderConfig = {
    endpoint: COMPOSER_FILE_PROVIDER_ENDPOINT,
    capability: CAPABILITY,
    capabilityHeader: FILE_PROVIDER_CAPABILITY_HEADER,
    workspaceHeader: FILE_PROVIDER_WORKSPACE_HEADER,
    maxBodyBytes: 2 * 1024 * 1024,
  };
  const createProviders = (workspace: () => string): WorkspaceProviderSet => {
    const compositionStore = createFileProviderCompositionStore({
      catalog: activeComponentProvider.catalog,
      config: composerConfig,
      fetch: fetchImpl,
      workspace,
    })!;
    const summaries = async () => ({ status: "ready" as const, summaries: await compositionStore.list() });
    return {
      storage: createFileProviderWorkspaceStorage({ config: domainConfig(WORKSPACE_FILE_PROVIDER_DOMAIN, false), fetchImpl })!,
      compositions: {
        descriptor: compositionStore.provider,
        store: compositionStore,
        initialization: { initialize: summaries, retry: summaries, startFresh: summaries },
      },
      content: createFileProviderContentProvider({ config: domainConfig("content"), fetchImpl, workspace }),
      mappings: createFileProviderMappingProvider({ config: domainConfig("mapping"), fetchImpl, workspace }),
      sitemaps: createFileProviderSitemapProvider({ config: domainConfig("sitemapper"), fetchImpl, workspace }),
    };
  };

  return {
    createProviders,
    storage: createFileProviderWorkspaceStorage({ config: domainConfig(WORKSPACE_FILE_PROVIDER_DOMAIN, false), fetchImpl })!,
    root,
    // A request may still be finishing when a spec tears its host down, so the
    // removal retries rather than failing the run on a re-created directory.
    dispose: () => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 }),
  };
}
