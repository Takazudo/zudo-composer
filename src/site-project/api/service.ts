import type { JsonValue } from "@zudo-composer/component-contract";
import { isJsonSafe, isPlainObject, isSafeRecordId } from "../../shared";
import { compileSiteProject } from "../compiler/compiler";
import type { SiteBuildPlan, SiteProjectCompilation } from "../compiler/types";
import {
  canonicalStringifyJson,
  canonicalizeSiteProject,
  compareUnicodeCodePoints,
} from "../model/canonical";
import { SITE_PROJECT_SCHEMA_VERSION, type SiteProject } from "../model/types";
import { validateSiteProject } from "../model/validation";
import {
  SITE_PROJECT_API_PROTOCOL_VERSION,
  type SiteProjectActiveSelection,
  type SiteProjectAdapterMutationResult,
  type SiteProjectAdapterReadResult,
  type SiteProjectApiDependencies,
  type SiteProjectApiErrorCode,
  type SiteProjectApiRequest,
  type SiteProjectApiResponse,
  type SiteProjectApiService,
  type SiteProjectPlanSource,
  type StoredSiteProject,
} from "./types";

const OPERATION_KEYS = {
  describe: ["protocolVersion", "operation"],
  list: ["protocolVersion", "operation"],
  get: ["protocolVersion", "operation", "projectId", "revision"],
  plan: ["protocolVersion", "operation", "source"],
  apply: ["protocolVersion", "operation", "project", "expectedRevision", "expectedActive"],
  build: ["protocolVersion", "operation", "projectId", "revision"],
  activate: ["protocolVersion", "operation", "projectId", "revision", "expectedActive"],
  discard: ["protocolVersion", "operation", "projectId", "expectedRevision", "expectedActive"],
} as const;

const ERROR_CODES: readonly SiteProjectApiErrorCode[] = [
  "malformed-request",
  "unsupported-protocol",
  "validation",
  "compile-blocked",
  "not-found",
  "conflict",
  "unavailable",
  "internal",
];

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isRevision(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isActive(value: unknown): value is SiteProjectActiveSelection | null {
  return value === null || (
    isPlainObject(value)
    && exactKeys(value, ["projectId", "revision"])
    && isSafeRecordId(value.projectId)
    && isRevision(value.revision)
  );
}

function malformed(message = "Request does not match the exact operation shape."): SiteProjectApiResponse {
  return { ok: false, error: { code: "malformed-request", message } };
}

function failure(code: SiteProjectApiErrorCode, message: string): SiteProjectApiResponse {
  return { ok: false, error: { code, message } };
}

function parseRequest(value: unknown): SiteProjectApiRequest | SiteProjectApiResponse {
  if (!isPlainObject(value) || !isJsonSafe(value)) return malformed("Request must be one JSON-safe plain object.");
  if (!Object.hasOwn(value, "protocolVersion")) return malformed();
  if (value.protocolVersion !== SITE_PROJECT_API_PROTOCOL_VERSION) {
    return failure("unsupported-protocol", `Protocol version must be ${SITE_PROJECT_API_PROTOCOL_VERSION}.`);
  }
  if (typeof value.operation !== "string" || !Object.hasOwn(OPERATION_KEYS, value.operation)) {
    return malformed("Request operation is not supported.");
  }
  const operation = value.operation as keyof typeof OPERATION_KEYS;
  if (!exactKeys(value, OPERATION_KEYS[operation])) return malformed();

  switch (operation) {
    case "describe":
    case "list":
      return value as unknown as SiteProjectApiRequest;
    case "get":
    case "build":
      return isSafeRecordId(value.projectId) && isRevision(value.revision)
        ? value as unknown as SiteProjectApiRequest
        : malformed();
    case "plan": {
      if (!isPlainObject(value.source)) return malformed();
      if (value.source.kind === "inline" && exactKeys(value.source, ["kind", "project"])) {
        return value as unknown as SiteProjectApiRequest;
      }
      if (value.source.kind === "stored" && exactKeys(value.source, ["kind", "projectId", "revision"])
        && isSafeRecordId(value.source.projectId) && isRevision(value.source.revision)) {
        return value as unknown as SiteProjectApiRequest;
      }
      return malformed();
    }
    case "apply":
      return (value.expectedRevision === null || isRevision(value.expectedRevision)) && isActive(value.expectedActive)
        ? value as unknown as SiteProjectApiRequest
        : malformed();
    case "activate":
      return isSafeRecordId(value.projectId) && isRevision(value.revision) && isActive(value.expectedActive)
        ? value as unknown as SiteProjectApiRequest
        : malformed();
    case "discard":
      return isSafeRecordId(value.projectId) && isRevision(value.expectedRevision) && isActive(value.expectedActive)
        ? value as unknown as SiteProjectApiRequest
        : malformed();
  }
}

function asJson<T>(value: T): JsonValue {
  return value as unknown as JsonValue;
}

function success<T>(result: T): SiteProjectApiResponse {
  return { ok: true, result: asJson(result) };
}

function normalizeUnknownProject(value: unknown): unknown {
  if (!isJsonSafe(value)) return value;
  const copy = structuredClone(value);
  if (!isPlainObject(copy) || !isPlainObject(copy.providers)) return copy;
  const sortById = (items: unknown): void => {
    if (!Array.isArray(items) || !items.every((item) => isPlainObject(item))) return;
    items.sort((left, right) => compareUnicodeCodePoints(
      typeof left.id === "string" ? left.id : "",
      typeof right.id === "string" ? right.id : "",
    ));
  };
  for (const domain of ["compositions", "content", "mappings", "sitemaps"] as const) {
    const providers = copy.providers[domain];
    sortById(providers);
    if (!Array.isArray(providers)) continue;
    for (const provider of providers) {
      if (!isPlainObject(provider)) continue;
      if (domain === "content") {
        sortById(provider.models);
        sortById(provider.entries);
      } else {
        sortById(provider.records);
      }
    }
  }
  return copy;
}

function canonicalValidatedProject(value: unknown, dependencies: SiteProjectApiDependencies): SiteProject | SiteProjectApiResponse {
  const validation = validateSiteProject(normalizeUnknownProject(value), { componentPack: dependencies.componentCatalog.pack });
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: "validation",
        message: "SiteProject validation failed.",
        diagnostics: validation.diagnostics,
      },
    };
  }
  return canonicalizeSiteProject(validation.project);
}

function normalizedActive(active: SiteProjectActiveSelection | null): SiteProjectActiveSelection | null {
  return active === null ? null : { projectId: active.projectId, revision: active.revision };
}

function readFailure<T>(result: Exclude<SiteProjectAdapterReadResult<T>, { status: "ok" }>): SiteProjectApiResponse {
  return result.status === "not-found"
    ? failure("not-found", "The requested project revision was not found.")
    : failure("unavailable", "Project storage is unavailable.");
}

function mutationFailure<T>(result: Exclude<SiteProjectAdapterMutationResult<T>, { status: "ok" }>): SiteProjectApiResponse {
  switch (result.status) {
    case "not-found": return failure("not-found", "The requested project revision was not found.");
    case "conflict": return failure("conflict", "A project revision or active selection expectation did not match.");
    case "unavailable": return failure("unavailable", "Project storage is unavailable.");
  }
}

function compileFailure(compilation: Extract<SiteProjectCompilation, { status: "blocked" }>): SiteProjectApiResponse {
  return {
    ok: false,
    error: {
      code: "compile-blocked",
      message: "SiteProject compilation is blocked.",
      diagnostics: compilation.diagnostics as unknown as readonly JsonValue[],
    },
  };
}

function buildSummary(build: SiteBuildPlan): JsonValue {
  return asJson({
    projectId: build.projectId,
    activeSitemap: build.activeSitemap,
    routeCount: build.routes.length,
    moduleCount: build.modules.length,
    routes: build.routes.map((route) => route.pathname),
    modules: build.modules.map((module) => module.moduleSpecifier),
  });
}

function projectSummary(project: SiteProject): JsonValue {
  return asJson({
    projectId: project.id,
    name: project.name,
    records: {
      compositions: project.providers.compositions.reduce((sum, provider) => sum + provider.records.length, 0),
      contentModels: project.providers.content.reduce((sum, provider) => sum + provider.models.length, 0),
      contentEntries: project.providers.content.reduce((sum, provider) => sum + provider.entries.length, 0),
      mappings: project.providers.mappings.reduce((sum, provider) => sum + provider.records.length, 0),
      sitemaps: project.providers.sitemaps.reduce((sum, provider) => sum + provider.records.length, 0),
    },
  });
}

async function getStored(
  source: Extract<SiteProjectPlanSource, { kind: "stored" }>,
  dependencies: SiteProjectApiDependencies,
): Promise<StoredSiteProject | SiteProjectApiResponse> {
  const result = await dependencies.projectStore.get({ projectId: source.projectId, revision: source.revision });
  if (result.status !== "ok") return readFailure(result);
  if (result.value.revision !== source.revision || result.value.project.id !== source.projectId) {
    return failure("internal", "Project storage returned an inconsistent revision.");
  }
  const project = canonicalValidatedProject(result.value.project, dependencies);
  if ("ok" in project) return failure("internal", "Project storage returned an invalid project.");
  return { project, revision: result.value.revision };
}

/** Creates the reusable service; no transport, runtime component, or platform API is selected here. */
export function createSiteProjectApiService(dependencies: SiteProjectApiDependencies): SiteProjectApiService {
  const compiler = dependencies.compiler ?? compileSiteProject;

  const handleParsed = async (request: SiteProjectApiRequest): Promise<SiteProjectApiResponse> => {
    switch (request.operation) {
      case "describe":
        return success({
          protocolVersion: SITE_PROJECT_API_PROTOCOL_VERSION,
          projectSchemaVersion: SITE_PROJECT_SCHEMA_VERSION,
          requestShapes: Object.entries(OPERATION_KEYS)
            .map(([operation, keys]) => ({ operation, keys: [...keys] }))
            .sort((left, right) => compareUnicodeCodePoints(left.operation, right.operation)),
          nestedShapes: {
            activeSelection: ["projectId", "revision"],
            planSource: [
              { kind: "inline", keys: ["kind", "project"] },
              { kind: "stored", keys: ["kind", "projectId", "revision"] },
            ],
          },
          errorCodes: [...ERROR_CODES],
          componentPack: dependencies.componentCatalog.pack,
          capabilities: { atomicApply: true, atomicActivate: true, atomicDiscard: true, derivedBuilds: true },
        });

      case "list": {
        const result = await dependencies.projectStore.list();
        if (result.status !== "ok") return readFailure(result);
        const projects = result.value.projects.map((entry) => ({
          projectId: entry.projectId,
          name: entry.name,
          revisions: [...entry.revisions].sort(compareUnicodeCodePoints),
        })).sort((left, right) => compareUnicodeCodePoints(left.projectId, right.projectId));
        return success({ projects, active: normalizedActive(result.value.active) });
      }

      case "get": {
        const stored = await getStored({ kind: "stored", projectId: request.projectId, revision: request.revision }, dependencies);
        if ("ok" in stored) return stored;
        return success({ projectId: request.projectId, revision: stored.revision, project: stored.project });
      }

      case "plan": {
        let project: SiteProject;
        let source: JsonValue;
        if (request.source.kind === "inline") {
          const validated = canonicalValidatedProject(request.source.project, dependencies);
          if ("ok" in validated) return validated;
          project = validated;
          source = { kind: "inline" };
        } else {
          const stored = await getStored(request.source, dependencies);
          if ("ok" in stored) return stored;
          project = stored.project;
          source = asJson({ kind: "stored", projectId: project.id, revision: stored.revision });
        }
        const compilation = await compiler(project, { componentCatalog: dependencies.componentCatalog });
        if (compilation.status === "blocked") return compileFailure(compilation);
        return success({
          source,
          project: projectSummary(project),
          diff: { writes: [] },
          build: buildSummary(compilation.build),
          diagnostics: [],
        });
      }

      case "apply": {
        const project = canonicalValidatedProject(request.project, dependencies);
        if ("ok" in project) return project;
        const compilation = await compiler(project, { componentCatalog: dependencies.componentCatalog });
        if (compilation.status === "blocked") return compileFailure(compilation);
        const result = await dependencies.projectStore.apply({
          project,
          expectedRevision: request.expectedRevision,
          expectedActive: normalizedActive(request.expectedActive),
        });
        if (result.status !== "ok") return mutationFailure(result);
        return success({
          projectId: project.id,
          revision: result.value.revision,
          active: normalizedActive(result.value.active),
          build: buildSummary(compilation.build),
        });
      }

      case "build": {
        const stored = await getStored({ kind: "stored", projectId: request.projectId, revision: request.revision }, dependencies);
        if ("ok" in stored) return stored;
        const compilation = await compiler(stored.project, { componentCatalog: dependencies.componentCatalog });
        if (compilation.status === "blocked") return compileFailure(compilation);
        const published = await dependencies.buildStore.publish({
          projectId: request.projectId,
          revision: request.revision,
          build: compilation.build,
        });
        if (published.status === "unavailable") return failure("unavailable", "Build storage is unavailable.");
        return success({ projectId: request.projectId, revision: request.revision, build: compilation.build });
      }

      case "activate": {
        const stored = await getStored({ kind: "stored", projectId: request.projectId, revision: request.revision }, dependencies);
        if ("ok" in stored) return stored;
        const compilation = await compiler(stored.project, { componentCatalog: dependencies.componentCatalog });
        if (compilation.status === "blocked") return compileFailure(compilation);
        const result = await dependencies.projectStore.activate({
          target: { projectId: request.projectId, revision: request.revision },
          expectedActive: normalizedActive(request.expectedActive),
        });
        if (result.status !== "ok") return mutationFailure(result);
        return success({ active: normalizedActive(result.value.active) });
      }

      case "discard": {
        const result = await dependencies.projectStore.discard({
          projectId: request.projectId,
          expectedRevision: request.expectedRevision,
          expectedActive: normalizedActive(request.expectedActive),
        });
        if (result.status !== "ok") return mutationFailure(result);
        return success({ projectId: request.projectId, revision: request.expectedRevision, active: normalizedActive(result.value.active) });
      }
    }
  };

  const handle = async (request: unknown): Promise<SiteProjectApiResponse> => {
    try {
      const parsed = parseRequest(request);
      if ("ok" in parsed) return parsed;
      return await handleParsed(parsed);
    } catch {
      return failure("internal", "The SiteProject service failed unexpectedly.");
    }
  };

  return {
    handle,
    async serialize(request) {
      return canonicalStringifyJson(await handle(request) as unknown as JsonValue);
    },
  };
}
