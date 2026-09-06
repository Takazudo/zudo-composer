// @ts-check
// Dev-only Vite plugin serving one filesystem endpoint per domain.
//
// It owns exactly the parts every domain shares: the per-dev-server capability,
// the virtual configuration module the browser reads, request-body limits, and
// the middleware registration. A domain contributes a descriptor — where its
// records live, which Node entry to load, and its operation table — and nothing
// else. Composer and Media keep their own endpoints; they predate this factory
// and carry request shapes it does not model.
//
// In a production build no capability is minted, the virtual module evaluates
// to `undefined`, and no middleware exists at all.

import {
  FILE_PROVIDER_CAPABILITY_HEADER,
  FILE_PROVIDER_MAX_BODY_BYTES,
  FILE_PROVIDER_OPERATION_HEADER,
  connectRequestHead,
  createDevCapability,
  domainFileProviderEndpoint,
  errorResponse,
  readBody,
  sendConnectResponse,
  validateRequestHead,
} from "./file-provider-http.mjs";
import { createDomainFileProviderMiddleware } from "./domain-file-provider.mjs";
import { appModuleId, resolveWorkspaceRoot } from "./roots.mjs";

export const DOMAIN_PROVIDERS_MODULE_ID = "virtual:composer-domain-providers";
const RESOLVED_DOMAIN_PROVIDERS_MODULE_ID = `\0${DOMAIN_PROVIDERS_MODULE_ID}`;

/**
 * @typedef {{
 *   domain: string,
 *   entryModule: string,
 *   resolveRoot: (workspaceRoot: string) => string,
 *   bind: (module: any, root: string) => {
 *     isDomainError: (value: unknown) => boolean,
 *     createStore: () => Promise<any>,
 *     operations: Record<string, (store: any, payload: unknown) => unknown>,
 *     applyTransaction?: (store: any, request: any) => Promise<unknown>,
 *   },
 * }} DomainProviderDescriptor
 */

/**
 * @param {{descriptors: readonly DomainProviderDescriptor[], workspaceRoot?: string, maxBodyBytes?: number}} options
 */
export default function domainFileProviderPlugin(options) {
  const descriptors = options.descriptors;
  const duplicate = descriptors.find((descriptor, index) =>
    descriptors.findIndex((other) => other.domain === descriptor.domain) !== index);
  if (duplicate !== undefined) throw new Error(`Duplicate file-provider domain: ${duplicate.domain}`);
  // Authored data lives in the host project, package entries live in the
  // package; `config.root` is neither once the tool runs from node_modules.
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const maxBodyBytes = options.maxBodyBytes ?? FILE_PROVIDER_MAX_BODY_BYTES;
  let command = "build";
  /** @type {string | undefined} */
  let capability;

  return {
    name: "composer-domain-file-provider",
    configResolved(config) {
      command = config.command;
      capability = command === "serve" ? createDevCapability() : undefined;
    },
    resolveId(id) {
      return id === DOMAIN_PROVIDERS_MODULE_ID ? RESOLVED_DOMAIN_PROVIDERS_MODULE_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_DOMAIN_PROVIDERS_MODULE_ID) return undefined;
      if (command !== "serve" || capability === undefined) {
        return "export const domainProviderConfig = undefined;\n";
      }
      const domains = Object.fromEntries(descriptors.map((descriptor) => [descriptor.domain, {
        endpoint: domainFileProviderEndpoint(descriptor.domain),
        capability,
        capabilityHeader: FILE_PROVIDER_CAPABILITY_HEADER,
        operationHeader: FILE_PROVIDER_OPERATION_HEADER,
        maxBodyBytes,
      }]));
      return `export const domainProviderConfig = ${JSON.stringify({ domains })};\n`;
    },
    async configureServer(server) {
      const activeCapability = capability;
      if (activeCapability === undefined) return;
      for (const descriptor of descriptors) {
        const endpoint = domainFileProviderEndpoint(descriptor.domain);
        const root = descriptor.resolveRoot(workspaceRoot);
        const module = await server.ssrLoadModule(appModuleId(descriptor.entryModule));
        const bound = descriptor.bind(module, root);
        const handler = createDomainFileProviderMiddleware({
          domain: descriptor.domain,
          capability: activeCapability,
          endpoint,
          maxBodyBytes,
          isDomainError: bound.isDomainError,
          operations: bound.operations,
          createStore: bound.createStore,
          ...(bound.applyTransaction === undefined ? {} : { applyTransaction: bound.applyTransaction }),
        });
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== endpoint) return next();
          const head = connectRequestHead(req);
          // Refuse an inadmissible request before buffering its body at all.
          const headError = validateRequestHead(head, endpoint, activeCapability);
          if (headError !== undefined) {
            sendConnectResponse(res, headError);
            return;
          }
          const declaredLength = Number(head.headers["content-length"]);
          if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
            sendConnectResponse(res, errorResponse(413, "body-too-large", `Request body exceeds the ${maxBodyBytes}-byte limit.`));
            return;
          }
          let body;
          try {
            body = await readBody(req, maxBodyBytes);
          } catch (error) {
            if (/** @type {any} */ (error)?.code === "BODY_TOO_LARGE") {
              sendConnectResponse(res, errorResponse(413, "body-too-large", `Request body exceeds the ${maxBodyBytes}-byte limit.`));
              return;
            }
            if (!res.destroyed) sendConnectResponse(res, errorResponse(400, "read-failed", "Request body could not be read."));
            return;
          }
          sendConnectResponse(res, await handler({ ...head, body }));
        });
      }
    },
  };
}
