import type { CompositionRecord } from "../../composer/library/types";
import type { CompositionDocument } from "../../composer/model/types";
import { materializeGlobalTemplateView } from "../../composer/reuse/materialize";
import { resolveGlobalTemplate } from "../../composer/reuse/resolver";
import type { GlobalTemplateResolutionOutcome } from "../../composer/reuse/types";
import { planLinkedJsxModules } from "../../composer/source/plan-linked-jsx";
import type { ContentEntrySnapshot } from "../../content/library/types";
import type { ContentEntryRecord, ContentModelRecord } from "../../content/model/types";
import { evaluateResolvedMapping, resolveMappingDefinition } from "../../mapping/resolver/resolver";
import type { MappingDefinitionResolution, MappingRecord } from "../../mapping/model/types";
import type { SitemapNode } from "../../sitemapper/model/types";
import { authoredPath, expandSitemapRoutes } from "../../sitemapper/routes/expand";
import type { DerivedSitemapRoute, SitemapRouteDiagnostic } from "../../sitemapper/routes/types";
import { compareUnicodeCodePoints } from "../model/canonical";
import { createInMemorySiteProjectAdapters } from "../model/memory";
import type { SiteProject, SiteProjectRecordRef } from "../model/types";
import type {
  CompileSiteProjectOptions,
  SiteCompiledModule,
  SiteCompiledRoute,
  SiteCompilerDiagnostic,
  SiteProjectCompilation,
} from "./types";

interface IndexedNode {
  node: SitemapNode;
  path: string;
  pathname: string;
}

type ContentPreparation =
  | { status: "resolved"; model: ContentModelRecord; snapshot: ContentEntrySnapshot }
  | { status: "not-found" }
  | { status: "provider-error"; reason: string };

interface PreparedMapping {
  ref: SiteProjectRecordRef;
  mapping: MappingRecord;
  definition: MappingDefinitionResolution;
  content: ContentPreparation;
}

function selector(domain: string, providerId: string, collection: string, recordId: string): string {
  return `$["providers"][${JSON.stringify(domain)}][?(@.id==${JSON.stringify(providerId)})][${JSON.stringify(collection)}][?(@.id==${JSON.stringify(recordId)})]`;
}

function nodeSelector(active: SiteProjectRecordRef, nodeId: string): string {
  return `${selector("sitemaps", active.providerId, "records", active.recordId)}["document"]["root"]..[?(@.id==${JSON.stringify(nodeId)})]`;
}

function entrySelector(ref: SiteProjectRecordRef): string {
  return selector("content", ref.providerId, "entries", ref.recordId);
}

function mappingSelector(ref: SiteProjectRecordRef): string {
  return selector("mappings", ref.providerId, "records", ref.recordId);
}

function compositionSelector(ref: SiteProjectRecordRef): string {
  return selector("compositions", ref.providerId, "records", ref.recordId);
}

function compareOptional(left: string | undefined, right: string | undefined): number {
  return compareUnicodeCodePoints(left ?? "", right ?? "");
}

function compareDiagnostics(left: SiteCompilerDiagnostic, right: SiteCompilerDiagnostic): number {
  return compareUnicodeCodePoints(left.path, right.path)
    || compareOptional(left.pathname, right.pathname)
    || compareOptional(left.nodeId, right.nodeId)
    || compareOptional(left.entry?.providerId, right.entry?.providerId)
    || compareOptional(left.entry?.recordId, right.entry?.recordId)
    || compareUnicodeCodePoints(left.code, right.code)
    || compareUnicodeCodePoints(left.message, right.message);
}

function compareRoutes(left: SiteCompiledRoute, right: SiteCompiledRoute): number {
  return compareUnicodeCodePoints(left.pathname, right.pathname)
    || compareUnicodeCodePoints(left.sitemapNode.id, right.sitemapNode.id)
    || compareOptional(left.selectedEntry?.providerId, right.selectedEntry?.providerId)
    || compareOptional(left.selectedEntry?.recordId, right.selectedEntry?.recordId);
}

function compareModules(left: SiteCompiledModule, right: SiteCompiledModule): number {
  return compareUnicodeCodePoints(left.moduleSpecifier, right.moduleSpecifier)
    || compareUnicodeCodePoints(left.recordId, right.recordId)
    || compareUnicodeCodePoints(left.kind, right.kind)
    || compareUnicodeCodePoints(left.code, right.code);
}

function indexNodes(nodes: readonly SitemapNode[], active: SiteProjectRecordRef, target: Map<string, IndexedNode>, ancestors: readonly string[] = []): void {
  for (const node of nodes) {
    const fragments = [...ancestors, node.slug ?? ""];
    target.set(node.id, { node, path: nodeSelector(active, node.id), pathname: authoredPath(fragments) });
    indexNodes(node.children, active, target, fragments);
  }
}

function escapedIdentityPart(value: string): string {
  let output = "";
  for (const point of value) output += `${point.codePointAt(0)!.toString(16).padStart(6, "0")}-`;
  return output || "empty-";
}

function stableHash(value: string, seed: bigint): string {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function routeIdentity(
  project: SiteProject,
  route: DerivedSitemapRoute,
  active: SiteProjectRecordRef,
  occupied: Set<string>,
): string {
  const values = [project.id, active.providerId, active.recordId, route.nodeId, route.entryId ?? "", route.pathname];
  const input = JSON.stringify(values);
  const base = `site-route-${stableHash(input, 0xcbf29ce484222325n)}${stableHash(input, 0x84222325cbf29ce4n)}`;
  let id = base;
  let collision = 0;
  while (occupied.has(id)) {
    collision += 1;
    id = `${base}-${collision}`;
  }
  occupied.add(id);
  return id;
}

function cloneDocument(document: CompositionDocument): CompositionDocument {
  return structuredClone(document);
}

function projectRouteDiagnostic(diagnostic: SitemapRouteDiagnostic, indexed: IndexedNode, entryProviderId?: string): SiteCompilerDiagnostic {
  return {
    severity: "blocking",
    code: diagnostic.code,
    message: diagnostic.message,
    path: indexed.path,
    nodeId: diagnostic.nodeId,
    pathname: diagnostic.path ?? indexed.pathname,
    ...(diagnostic.entryId ? { entry: { providerId: entryProviderId ?? "unknown", recordId: diagnostic.entryId } } : {}),
  };
}

function resolutionMessage(resolution: Exclude<GlobalTemplateResolutionOutcome, { status: "resolved" }>): string {
  switch (resolution.status) {
    case "unbound": return "The linked Composition unexpectedly resolved as unbound.";
    case "missing-template": return "The linked Global template could not be resolved.";
    case "missing-outlet": return "The linked Global template outlet is missing.";
    case "invalid-template": return "The linked source is not a valid Global template.";
    case "nested-template": return "A linked Global template cannot itself be linked.";
    case "self-reference": return "The Composition links to itself as a Global template.";
    case "incompatible-local-root": return resolution.message;
  }
}

function bindingCycle(
  providerId: string,
  localId: string,
  local: CompositionRecord,
  resolve: (ref: SiteProjectRecordRef) => CompositionRecord | undefined,
): readonly string[] | undefined {
  const visited = new Map<string, number>();
  const chain: string[] = [];
  let currentId = localId;
  let current: CompositionRecord | undefined = local;
  while (current) {
    const seenAt = visited.get(currentId);
    if (seenAt !== undefined) return [...chain.slice(seenAt), currentId];
    visited.set(currentId, chain.length);
    chain.push(currentId);
    const next = current.document.binding?.sourceRecordId;
    if (!next) return undefined;
    currentId = next;
    current = resolve({ providerId, recordId: next });
  }
  return undefined;
}

function dependencyClosure(
  providerId: string,
  local: CompositionRecord,
  resolve: (ref: SiteProjectRecordRef) => CompositionRecord | undefined,
): readonly CompositionRecord[] {
  const records: CompositionRecord[] = [];
  const seen = new Set<string>();
  let next = local.document.binding?.sourceRecordId;
  while (next && !seen.has(next)) {
    seen.add(next);
    const record = resolve({ providerId, recordId: next });
    if (!record) break;
    records.push(record);
    next = record.document.binding?.sourceRecordId;
  }
  return records.sort((left, right) => compareUnicodeCodePoints(left.id, right.id));
}

function moduleSpecifier(providerId: string, routeRecordId: string, recordId: string): string {
  return recordId === routeRecordId
    ? `@site-project/routes/${routeRecordId}`
    : `@site-project/compositions/${escapedIdentityPart(providerId)}${escapedIdentityPart(recordId)}`;
}

function asModule(plan: Extract<ReturnType<typeof planLinkedJsxModules>["records"][number], { status: "generated" }>): SiteCompiledModule {
  return {
    recordId: plan.recordId,
    moduleSpecifier: plan.moduleSpecifier,
    kind: plan.kind,
    code: plan.code,
  };
}

/**
 * Compile a validated, portable SiteProject snapshot into deterministic route
 * and linked-JSX manifests. All reads are completed from one detached in-memory
 * snapshot; no provider, runtime component, or platform API is imported.
 */
export async function compileSiteProject(
  project: SiteProject,
  options: CompileSiteProjectOptions,
): Promise<SiteProjectCompilation> {
  const adapters = createInMemorySiteProjectAdapters(project);
  const snapshot = adapters.project;
  const active = snapshot.activeSitemap;
  const diagnostics: SiteCompilerDiagnostic[] = [];
  const indexedNodes = new Map<string, IndexedNode>();
  indexNodes(adapters.activeSitemap.document.root, active, indexedNodes);

  const mappingRefs = new Map<MappingRecord, SiteProjectRecordRef>();
  for (const item of adapters.mappings.catalog.list()) mappingRefs.set(item.record, item.ref);
  const preparedByRecord = new Map<MappingRecord, Promise<PreparedMapping>>();

  const mappingCompositionCatalog = {
    async resolve(ref: SiteProjectRecordRef) {
      const record = adapters.compositions.catalog.resolve(ref);
      return record ? { status: "resolved" as const, record } : { status: "not-found" as const };
    },
    async list() { return { status: "listed" as const, entries: [], failures: [] }; },
  };
  const mappingContentCatalog = {
    async resolveModel(ref: SiteProjectRecordRef) {
      const record = adapters.content.catalog.resolveModel(ref);
      return record ? { status: "resolved" as const, record } : { status: "not-found" as const };
    },
    async listModels() { return { status: "listed" as const, entries: [], failures: [] }; },
  };

  const prepareMapping = (mapping: MappingRecord): Promise<PreparedMapping> => {
    const cached = preparedByRecord.get(mapping);
    if (cached) return cached;
    const promise = (async () => {
      const ref = mappingRefs.get(mapping) ?? { providerId: "", recordId: mapping.id };
      const modelRef = mapping.document.contentModel;
      const model = adapters.content.catalog.resolveModel(modelRef);
      const entries = model ? adapters.content.catalog.listEntries(modelRef).map((item) => item.record) : [];
      const content: ContentPreparation = model
        ? {
            status: "resolved",
            model,
            snapshot: {
              model,
              entries,
              count: entries.length,
              diagnostics: [],
            },
          }
        : { status: "not-found" };
      const definition = await resolveMappingDefinition(
        mapping,
        { content: mappingContentCatalog, compositions: mappingCompositionCatalog },
        options.componentCatalog,
      );
      return { ref, mapping, definition, content };
    })();
    preparedByRecord.set(mapping, promise);
    return promise;
  };

  const expansion = await expandSitemapRoutes({
    document: adapters.activeSitemap.document,
    catalog: {
      async resolveMapping(ref) {
        const record = adapters.mappings.catalog.resolve(ref);
        return record ? { status: "resolved", record } : { status: "not-found" };
      },
      async resolveDefinitionReadiness(mapping) {
        const prepared = await prepareMapping(mapping);
        return prepared.definition.status === "ready"
          ? { status: "ready" }
          : { status: "blocked", diagnostics: prepared.definition.diagnostics };
      },
      async resolveContentSnapshot(mapping) {
        return (await prepareMapping(mapping)).content;
      },
    },
  });

  for (const item of expansion.diagnostics) {
    const indexed = indexedNodes.get(item.nodeId);
    if (!indexed) continue;
    const source = indexed.node.source;
    const mapping = source.kind === "mapping" ? adapters.mappings.catalog.resolve(source.ref) : undefined;
    diagnostics.push(projectRouteDiagnostic(item, indexed, mapping?.document.contentModel.providerId));
  }

  // Preserve the precise Mapping diagnostics even when expansion cannot emit a route.
  for (const indexed of indexedNodes.values()) {
    if (indexed.node.source.kind !== "mapping") continue;
    const mapping = adapters.mappings.catalog.resolve(indexed.node.source.ref);
    if (!mapping) continue;
    const prepared = await prepareMapping(mapping);
    for (const item of prepared.definition.diagnostics) {
      diagnostics.push({
        severity: "blocking",
        code: `mapping-${item.code}`,
        message: item.message,
        path: `${mappingSelector(prepared.ref)}["document"]["bindings"]${item.bindingId ? `..[?(@.id==${JSON.stringify(item.bindingId)})]` : ""}`,
        pathname: indexed.pathname,
        nodeId: indexed.node.id,
      });
    }
  }

  const occupiedIdsByProvider = new Map<string, Set<string>>();
  for (const provider of snapshot.providers.compositions) occupiedIdsByProvider.set(provider.id, new Set(provider.records.map((record) => record.id)));
  const routes: SiteCompiledRoute[] = [];

  for (const expanded of expansion.routes) {
    const indexed = indexedNodes.get(expanded.nodeId);
    if (!indexed) continue;
    const { node } = indexed;
    if (node.source.kind === "unassigned") {
      diagnostics.push({ severity: "blocking", code: "unassigned-page", message: "The Sitemap page has no assigned source.", path: indexed.path, pathname: expanded.pathname, nodeId: node.id });
      continue;
    }

    let source: SiteCompiledRoute["source"];
    let localRef: SiteProjectRecordRef;
    let localRecord: CompositionRecord | undefined;
    let localDocument: CompositionDocument | undefined;
    let selectedEntry: SiteProjectRecordRef | undefined;

    if (node.source.kind === "composition") {
      source = { kind: "composition", ref: { ...node.source.ref } };
      localRef = { ...node.source.ref };
      localRecord = adapters.compositions.catalog.resolve(localRef);
      localDocument = localRecord ? cloneDocument(localRecord.document) : undefined;
      if (!localRecord) diagnostics.push({ severity: "blocking", code: "composition-not-found", message: "The assigned Composition was not found.", path: `${indexed.path}["source"]["ref"]`, pathname: expanded.pathname, nodeId: node.id });
    } else {
      source = { kind: "mapping", ref: { ...node.source.ref } };
      const mapping = adapters.mappings.catalog.resolve(node.source.ref);
      if (!mapping) continue;
      const prepared = await prepareMapping(mapping);
      const definition = prepared.definition;
      if (definition.status !== "ready" || !definition.composition || prepared.content.status !== "resolved") continue;
      localRef = { ...mapping.document.composition };
      localRecord = definition.composition;
      let entry: ContentEntryRecord | undefined;
      if (node.source.route.kind === "single") {
        if (prepared.content.snapshot.entries.length !== 1) {
          diagnostics.push({
            severity: "blocking",
            code: "single-entry-count",
            message: `Single route Mapping requires exactly one Entry; found ${prepared.content.snapshot.entries.length}.`,
            path: mappingSelector(prepared.ref),
            pathname: expanded.pathname,
            nodeId: node.id,
          });
          continue;
        }
        entry = prepared.content.snapshot.entries[0];
      } else {
        entry = prepared.content.snapshot.entries.find((candidate) => candidate.id === expanded.entryId);
      }
      if (!entry) {
        const missingEntry = expanded.entryId ? { providerId: mapping.document.contentModel.providerId, recordId: expanded.entryId } : undefined;
        diagnostics.push({ severity: "blocking", code: "entry-not-found", message: "The route Entry was not found in the prepared Content snapshot.", path: indexed.path, pathname: expanded.pathname, nodeId: node.id, ...(missingEntry ? { entry: missingEntry } : {}) });
        continue;
      }
      selectedEntry = { providerId: mapping.document.contentModel.providerId, recordId: entry.id };
      const evaluation = evaluateResolvedMapping(definition, entry);
      for (const item of evaluation.entryDiagnostics.filter((candidate) => candidate.severity === "blocking")) {
        diagnostics.push({ severity: "blocking", code: `mapping-${item.code}`, message: item.message, path: entrySelector(selectedEntry), pathname: expanded.pathname, nodeId: node.id, entry: selectedEntry });
      }
      if (evaluation.status !== "ready" || !evaluation.document) continue;
      localDocument = evaluation.document;
    }

    if (!localRecord || !localDocument) continue;
    const providerId = localRef!.providerId;
    const cycle = bindingCycle(providerId, localRef!.recordId, { ...localRecord, document: localDocument }, (ref) => adapters.compositions.catalog.resolve(ref));
    if (cycle) {
      diagnostics.push({
        severity: "blocking",
        code: "template-binding-cycle",
        message: `Composition binding cycle: ${cycle.join(" -> ")}.`,
        path: `${compositionSelector(localRef!)}["document"]["binding"]`,
        pathname: expanded.pathname,
        nodeId: node.id,
        ...(selectedEntry ? { entry: selectedEntry } : {}),
      });
      continue;
    }

    const occupiedIds = occupiedIdsByProvider.get(providerId) ?? new Set<string>();
    occupiedIdsByProvider.set(providerId, occupiedIds);
    const routeRecordId = routeIdentity(snapshot, expanded, active, occupiedIds);
    const routeDocument = cloneDocument(localDocument);
    routeDocument.id = routeRecordId;
    const routeRecord: CompositionRecord = {
      ...localRecord,
      id: routeRecordId,
      document: routeDocument,
    };
    const dependencies = dependencyClosure(providerId, routeRecord, (ref) => adapters.compositions.catalog.resolve(ref));
    let resolution: GlobalTemplateResolutionOutcome | undefined;
    let linkedSource: SiteCompiledRoute["composition"]["linkedSource"];
    if (routeRecord.document.binding) {
      const direct = dependencies.find((record) => record.id === routeRecord.document.binding!.sourceRecordId);
      if (!direct) {
        diagnostics.push({ severity: "blocking", code: "template-source-not-found", message: "The linked Global template source was not found.", path: `${compositionSelector(localRef!)}["document"]["binding"]`, pathname: expanded.pathname, nodeId: node.id, ...(selectedEntry ? { entry: selectedEntry } : {}) });
        continue;
      }
      resolution = resolveGlobalTemplate({ consumer: routeRecord, source: direct, manifest: options.componentCatalog });
      if (resolution.status !== "resolved") {
        diagnostics.push({ severity: "blocking", code: `template-${resolution.status}`, message: resolutionMessage(resolution), path: `${compositionSelector(localRef!)}["document"]["binding"]`, pathname: expanded.pathname, nodeId: node.id, ...(selectedEntry ? { entry: selectedEntry } : {}) });
        continue;
      }
      const materialized = materializeGlobalTemplateView(routeRecord, resolution);
      if (materialized.status !== "resolved") {
        diagnostics.push({ severity: "blocking", code: "template-materialization-failed", message: "The linked Global template could not be materialized.", path: `${compositionSelector(localRef!)}["document"]["binding"]`, pathname: expanded.pathname, nodeId: node.id, ...(selectedEntry ? { entry: selectedEntry } : {}) });
        continue;
      }
      linkedSource = {
        ref: { providerId, recordId: direct.id },
        outlet: { id: resolution.outlet.id, label: resolution.outlet.label },
        document: cloneDocument(materialized.sourceDocument),
      };
    }

    const resolutions = resolution ? new Map([[routeRecordId, resolution]]) : undefined;
    const batch = planLinkedJsxModules({
      manifest: options.componentCatalog,
      records: [...dependencies, routeRecord],
      ...(resolutions ? { resolutions } : {}),
      moduleSpecifier: (recordId) => moduleSpecifier(providerId, routeRecordId, recordId),
    });
    const blocked = batch.records.find((plan) => plan.status === "blocked");
    if (blocked?.status === "blocked") {
      const code = blocked.diagnostic.kind === "dependency" ? blocked.diagnostic.code : "jsx-generation-failed";
      diagnostics.push({ severity: "blocking", code, message: `JSX module generation failed for Composition "${blocked.recordId}".`, path: compositionSelector(blocked.recordId === routeRecordId ? localRef! : { providerId, recordId: blocked.recordId }), pathname: expanded.pathname, nodeId: node.id, ...(selectedEntry ? { entry: selectedEntry } : {}) });
      continue;
    }
    const modules = batch.records.filter((plan) => plan.status === "generated").map(asModule).sort(compareModules);
    routes.push({
      pathname: expanded.pathname,
      sitemapNode: { id: node.id, path: indexed.path },
      source,
      ...(selectedEntry ? { selectedEntry } : {}),
      composition: {
        local: localRef!,
        routeRecordId,
        document: cloneDocument(localDocument),
        ...(linkedSource ? { linkedSource } : {}),
      },
      modules,
    });
  }

  routes.sort(compareRoutes);
  const modulesBySpecifier = new Map<string, SiteCompiledModule>();
  for (const route of routes) {
    for (const module of route.modules) {
      const previous = modulesBySpecifier.get(module.moduleSpecifier);
      if (!previous) modulesBySpecifier.set(module.moduleSpecifier, module);
      else if (previous.code !== module.code || previous.kind !== module.kind || previous.recordId !== module.recordId) {
        diagnostics.push({
          severity: "blocking",
          code: "module-plan-conflict",
          message: `Module specifier ${JSON.stringify(module.moduleSpecifier)} was planned with different code.`,
          path: compositionSelector(route.composition.local),
          pathname: route.pathname,
          nodeId: route.sitemapNode.id,
          ...(route.selectedEntry ? { entry: route.selectedEntry } : {}),
        });
      }
    }
  }
  diagnostics.sort(compareDiagnostics);
  if (diagnostics.length > 0) return { status: "blocked", routes, diagnostics };
  return {
    status: "ready",
    build: {
      projectId: snapshot.id,
      activeSitemap: { ...active },
      routes,
      modules: [...modulesBySpecifier.values()].sort(compareModules),
    },
    diagnostics: [],
  };
}
