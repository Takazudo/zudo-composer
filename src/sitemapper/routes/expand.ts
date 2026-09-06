import type { ContentEntryRecord } from "../../content";
import { evaluateCollectionQuery } from "../../mapping/resolver/collection";
import { isSitemapDisplayTitleFieldKind, type SitemapNode } from "../model";
import type { DerivedSitemapRoute, ExpandSitemapRoutesOptions, SitemapMappingRouteMetadata, SitemapNodeRouteInfo, SitemapRouteDiagnostic, SitemapRouteExpansion } from "./types";

function isDotPathAlias(part: string): boolean {
  let decoded = part.normalize("NFC");
  for (let pass = 0; pass < 32; pass += 1) {
    let next: string;
    try { next = decodeURIComponent(decoded); }
    catch { return false; }
    if (next === decoded) return decoded.split("/").some((candidate) => candidate === "." || candidate === "..");
    decoded = next.normalize("NFC");
  }
  return true; // reject pathologically deep encoded input instead of doing unbounded decode work
}

function encodedParts(fragment: string): { ok: true; parts: string[] } | { ok: false } {
  try {
    const rawParts = fragment.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
    if (rawParts.some(isDotPathAlias)) return { ok: false };
    return {
      ok: true,
      parts: rawParts.map((part) => encodeURIComponent(part.normalize("NFC"))),
    };
  } catch (error) {
    if (error instanceof URIError) return { ok: false };
    throw error;
  }
}

export function authoredPath(fragments: readonly string[]): string {
  const parts = fragments.flatMap((fragment) => {
    const encoded = encodedParts(fragment);
    return encoded.ok ? encoded.parts : [encodeURIComponent("\uFFFD")];
  });
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function entrySegment(value: unknown): { ok: true; segment: string } | { ok: false; missing: boolean } {
  if (typeof value !== "string") return { ok: false, missing: value === undefined || value === null };
  const normalized = value.trim().normalize("NFC");
  if (!normalized) return { ok: false, missing: true };
  if (normalized.includes("/") || normalized.includes("?") || normalized.includes("#") || isDotPathAlias(normalized)) {
    return { ok: false, missing: false };
  }
  try {
    return { ok: true, segment: encodeURIComponent(normalized) };
  } catch (error) {
    if (error instanceof URIError) return { ok: false, missing: false };
    throw error;
  }
}

function append(base: string, segment: string): string {
  return base === "/" ? `/${segment}` : `${base}/${segment}`;
}

export async function expandSitemapRoutes({ document, catalog, policy = "release" }: ExpandSitemapRoutesOptions): Promise<SitemapRouteExpansion> {
  const diagnostics: SitemapRouteDiagnostic[] = [];
  const metadata = new Map<string, SitemapMappingRouteMetadata>();
  type Variant = { suffix: string; displayTitle: string; selectedEntry?: import("../model").SitemapEntryRef };
  type Plan = { node: SitemapNode; variants: Variant[]; children: Plan[]; count: number };
  const cap = 10000;
  const diagnose = (node: SitemapNode, code: SitemapRouteDiagnostic["code"], message: string, extra: Partial<SitemapRouteDiagnostic> = {}) => { diagnostics.push({ code, nodeId: node.id, message, ...extra }); };
  // Bound authored depth/size and reject cycles before catalog I/O or recursion.
  const authored: SitemapNode[] = [], seenNodes = new Set<object>(), ids = new Set<string>();
  const pending = document.root.map((node) => ({ node, depth: 1 }));
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (depth > 128 || authored.length >= cap || seenNodes.has(node) || ids.has(node.id)) {
      diagnostics.push({ code: "invalid-tree", nodeId: node.id, message: "Sitemap tree exceeds its bounds or repeats a node identity." });
      return { routes: [], derivedRouteCount: 0, diagnostics, nodes: new Map() };
    }
    seenNodes.add(node); ids.add(node.id); authored.push(node);
    if (pending.length + node.children.length + authored.length > cap) {
      diagnostics.push({ code: "invalid-tree", nodeId: node.id, message: "Sitemap authored tree exceeds 10,000 nodes." });
      return { routes: [], derivedRouteCount: 0, diagnostics, nodes: new Map() };
    }
    for (const child of node.children) pending.push({ node: child, depth: depth + 1 });
  }
  const prepare = async (node: SitemapNode, externalAncestor = false): Promise<Plan> => {
    const variants: Variant[] = [];
    const fragment = node.slug ?? "";
    const encoded = encodedParts(fragment);
    if (!encoded.ok) diagnose(node, "route-fragment-invalid", "A route fragment is malformed or contains a forbidden dot-path segment.");
    else if (node.source.kind !== "mapping") variants.push({ suffix: encoded.parts.join("/"), displayTitle: node.title });
    else if (externalAncestor || /^https?:\/\//i.test(fragment.trim())) diagnose(node, "unsupported-external-base", "HTTP(S) Mapping route bases are unsupported.");
    else {
      const source = node.source;
      let resolved;
      try { resolved = await catalog.resolveMapping(source.ref); }
      catch (error) { resolved = { status: "provider-error" as const, reason: error instanceof Error ? error.message : "Mapping provider failed." }; }
      if (resolved.status !== "resolved") diagnose(node, resolved.status === "not-found" ? "mapping-not-found" : resolved.status === "invalid" ? "mapping-invalid" : "mapping-provider-failure", resolved.status === "not-found" ? "The assigned Mapping was not found." : resolved.reason);
      else {
        const mapping = resolved.record;
        let readiness;
        try { readiness = await catalog.resolveDefinitionReadiness(mapping); }
        catch (error) { readiness = { status: "blocked" as const, diagnostics: [{ code: "readiness-provider-error", message: String(error) }] }; }
        if (readiness.status !== "ready") diagnose(node, "incompatible-mapping", readiness.diagnostics.map((item) => item.message).join(" "));
        let content;
        try { content = await catalog.resolveContentSnapshot(mapping); }
        catch (error) { content = { status: "provider-error" as const, reason: String(error) }; }
        if (content.status !== "resolved") diagnose(node, content.status === "not-found" ? "content-model-not-found" : content.status === "invalid" ? "content-model-invalid" : "content-provider-failure", content.status === "not-found" ? "The Mapping Content model was not found." : content.reason);
        else {
          const { model, snapshot } = content;
          const providerId = mapping.document.contentModel.providerId;
          const owned = snapshot.entries.filter((entry) => entry.modelId === model.id);
          const eligible = (entry: ContentEntryRecord) => policy === "authoring-preview" || entry.lifecycle === "published";
          let entries: readonly ContentEntryRecord[] = [];
          let blocked = readiness.status !== "ready";
          if (model.id !== mapping.document.contentModel.recordId || snapshot.diagnostics.length) { diagnose(node, "content-model-invalid", "The Content snapshot is incomplete or belongs to another model."); blocked = true; }
          if (source.route.kind === "selected-entry") {
            const ref = source.route.entry;
            const entry = owned.find(({ id }) => id === ref.recordId);
            if (model.document.kind !== "collection" || mapping.document.mode.kind !== "collection" || ref.providerId !== providerId || ref.modelId !== model.id || !entry) {
              diagnose(node, "selected-entry-invalid", "The selected collection Entry is missing or does not belong to this Mapping model/provider."); blocked = true;
            } else if (!eligible(entry)) { diagnose(node, "entry-ineligible", "The selected Entry is excluded by release publication policy.", { entryId: entry.id }); blocked = true; }
            else entries = [entry];
          } else if (source.route.kind === "single") {
            if (mapping.document.mode.kind !== "single" || model.document.kind !== "single") { diagnose(node, "wrong-route-mode", "Single routes require a singleton Mapping/model; select a collection Entry explicitly."); blocked = true; }
            else if (owned.length !== 1) { diagnose(node, "single-entry-count", "A singleton route requires exactly one Entry."); blocked = true; }
            else if (!eligible(owned[0]!)) { diagnose(node, "entry-ineligible", "The singleton Entry is excluded by release publication policy."); blocked = true; }
            else entries = owned;
          } else if (mapping.document.mode.kind !== "collection" || model.document.kind !== "collection") {
            diagnose(node, "wrong-route-mode", "Entry-field routes require a collection Mapping/model."); blocked = true;
          } else {
            const query = evaluateCollectionQuery({ model, providerId, entries: snapshot.entries, query: { ...mapping.document.mode.query, publication: policy === "release" ? "published-only" : mapping.document.mode.query.publication } });
            entries = query.entries; blocked ||= query.status === "blocked";
            for (const item of query.diagnostics) diagnose(node, `collection-query-${item.code}`, item.message, { severity: item.severity, ...(item.entryId ? { entryId: item.entryId } : {}) });
          }
          metadata.set(node.id, { name: mapping.document.name, model: model.document.name, kind: model.document.kind, entryCount: entries.length,
            slugFields: model.document.fields.filter((field) => field.kind === "slug").map(({ id, label }) => ({ id, label })),
            titleFields: model.document.fields.filter((field) => isSitemapDisplayTitleFieldKind(field.kind)).map(({ id, label }) => ({ id, label })) });
          const fieldId = source.route.kind === "entry-field" ? source.route.fieldId : undefined;
          const field = model.document.fields.find(({ id }) => id === fieldId);
          const titleId = source.route.kind === "entry-field" ? source.route.titleFieldId : undefined;
          const titleField = model.document.fields.find(({ id }) => id === titleId);
          if (source.route.kind === "entry-field") {
            if (!field || field.kind !== "slug") { diagnose(node, field ? "route-field-not-slug" : "route-field-missing", "The selected Entry route field must be an existing slug field."); blocked = true; }
            if (titleId !== undefined && (!titleField || !isSitemapDisplayTitleFieldKind(titleField.kind))) { diagnose(node, titleField ? "title-field-not-textual" : "title-field-missing", "The selected Entry title field must be an existing textual field."); blocked = true; }
          }
          if (!blocked) for (const entry of entries) {
            const segment = field ? entrySegment(entry.values[field.id]) : undefined;
            if (segment && !segment.ok) diagnose(node, segment.missing ? "entry-slug-missing" : "entry-slug-invalid", "Entry slug is missing or contains a forbidden route delimiter.", { entryId: entry.id });
            else {
              const value = titleId ? entry.values[titleId] : undefined;
              variants.push({ suffix: [...encoded.parts, ...(segment?.ok ? [segment.segment] : [])].join("/"), displayTitle: typeof value === "string" && value.trim() ? value : node.title,
                selectedEntry: { providerId, modelId: model.id, recordId: entry.id } });
            }
          }
        }
      }
    }
    const children: Plan[] = [];
    for (const child of node.children) children.push(await prepare(child, externalAncestor || /^https?:\/\//i.test(fragment.trim())));
    const descendants = children.reduce((sum, child) => Math.min(cap + 1, sum + child.count), 0);
    return { node, variants, children, count: Math.min(cap + 1, variants.length * (1 + descendants)) };
  };
  const plans: Plan[] = [];
  for (const root of document.root) plans.push(await prepare(root));
  const total = plans.reduce((sum, plan) => Math.min(cap + 1, sum + plan.count), 0);
  const routes: DerivedSitemapRoute[] = [];
  if (total > cap) diagnostics.push({ code: "route-limit", nodeId: document.root[0]?.id ?? "", message: "Sitemap expansion exceeds the 10,000-route limit; no route families were materialized." });
  else {
    const emit = (plan: Plan, base: string, ancestors: DerivedSitemapRoute["ancestors"]) => {
      for (const variant of plan.variants) {
        const pathname = variant.suffix ? append(base, variant.suffix) : base;
        const route: DerivedSitemapRoute = { pathname, nodeId: plan.node.id, sourceKind: plan.node.source.kind, displayTitle: variant.displayTitle, ancestors,
          ...(variant.selectedEntry ? { selectedEntry: variant.selectedEntry, entryId: variant.selectedEntry.recordId } : {}) };
        routes.push(route);
        const chain = [...ancestors, { nodeId: route.nodeId, pathname, displayTitle: route.displayTitle, ...(route.selectedEntry ? { selectedEntry: route.selectedEntry } : {}) }];
        for (const child of plan.children) emit(child, pathname, chain);
      }
    };
    for (const plan of plans) emit(plan, "/", []);
  }
  const paths = new Map<string, DerivedSitemapRoute[]>();
  for (const route of routes) { const matches = paths.get(route.pathname) ?? []; matches.push(route); paths.set(route.pathname, matches); }
  for (const [path, matches] of paths) if (matches.length > 1) for (const route of matches) diagnostics.push({ code: "route-collision", nodeId: route.nodeId, entryId: route.entryId, path, message: `Route ${path} has ${matches.length} concrete destinations.` });
  const nodes = new Map<string, SitemapNodeRouteInfo>();
  for (const node of authored) {
    const localRoutes = routes.filter((route) => route.nodeId === node.id), localDiagnostics = diagnostics.filter((item) => item.nodeId === node.id);
    nodes.set(node.id, { derivedRouteCount: localRoutes.length, ...(localRoutes[0] ? { samplePath: localRoutes[0].pathname } : {}), status: localDiagnostics.some((item) => item.severity !== "nonblocking") ? "blocked" : "ready", diagnostics: localDiagnostics, ...(metadata.has(node.id) ? { mapping: metadata.get(node.id)! } : {}) });
  }
  return { routes, derivedRouteCount: routes.length, samplePath: routes[0]?.pathname, diagnostics, nodes };
}
