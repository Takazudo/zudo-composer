import type { ContentEntryRecord } from "../../content";
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
  if (normalized.includes("/") || normalized.includes("?") || normalized.includes("#") || normalized === "." || normalized === "..") {
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

export async function expandSitemapRoutes({ document, catalog }: ExpandSitemapRoutesOptions): Promise<SitemapRouteExpansion> {
  const routes: DerivedSitemapRoute[] = [];
  const diagnostics: SitemapRouteDiagnostic[] = [];
  const seen = new Map<string, DerivedSitemapRoute>();
  const mappingMetadataByNode = new Map<string, SitemapMappingRouteMetadata>();

  const emit = (route: DerivedSitemapRoute): void => {
    const previous = seen.get(route.pathname);
    if (previous) {
      diagnostics.push({ code: "route-collision", nodeId: previous.nodeId, entryId: previous.entryId, path: previous.pathname, message: `Route ${route.pathname} collides with page "${route.nodeId}".` });
      diagnostics.push({ code: "route-collision", nodeId: route.nodeId, entryId: route.entryId, path: route.pathname, message: `Route ${route.pathname} collides with page "${previous.nodeId}".` });
      routes.push(route);
      return;
    }
    seen.set(route.pathname, route);
    routes.push(route);
  };
  const diagnose = (node: SitemapNode, code: SitemapRouteDiagnostic["code"], message: string, extra: Partial<SitemapRouteDiagnostic> = {}): void => {
    diagnostics.push({ code, nodeId: node.id, message, ...extra });
  };

  const visit = async (node: SitemapNode, ancestors: readonly string[]): Promise<void> => {
    const fragments = [...ancestors, node.slug ?? ""];
    const malformedFragment = fragments.find((fragment) => !encodedParts(fragment).ok);
    if (malformedFragment !== undefined) {
      diagnose(node, "route-fragment-invalid", "A route fragment is malformed or contains a forbidden dot-path segment.");
      for (const child of node.children) await visit(child, fragments);
      return;
    }
    const base = authoredPath(fragments);
    if (node.source.kind !== "mapping") {
      emit({ pathname: base, nodeId: node.id, sourceKind: node.source.kind });
    } else if (fragments.some((fragment) => /^https?:\/\//i.test(fragment.trim()))) {
      diagnose(node, "unsupported-external-base", "HTTP(S) Mapping route bases are unsupported.");
    } else {
      const mappingSource = node.source;
      let resolved;
      try { resolved = await catalog.resolveMapping(mappingSource.ref); }
      catch (error) { resolved = { status: "provider-error" as const, reason: error instanceof Error ? error.message : "Mapping provider failed." }; }
      if (resolved.status !== "resolved") {
        const code = resolved.status === "not-found" ? "mapping-not-found" : resolved.status === "invalid" ? "mapping-invalid" : "mapping-provider-failure";
        diagnose(node, code, resolved.status === "not-found" ? "The assigned Mapping was not found." : resolved.reason);
      } else {
        let readiness;
        try { readiness = await catalog.resolveDefinitionReadiness(resolved.record); }
        catch (error) { readiness = { status: "blocked" as const, diagnostics: [{ code: "readiness-provider-error", message: error instanceof Error ? error.message : "Mapping readiness provider failed." }] }; }
        if (readiness.status === "blocked") {
          diagnose(node, "incompatible-mapping", readiness.diagnostics.map((item) => item.message).join(" ") || "The Mapping definition is not ready.");
        }
        let content;
        try { content = await catalog.resolveContentSnapshot(resolved.record); }
        catch (error) { content = { status: "provider-error" as const, reason: error instanceof Error ? error.message : "Content snapshot provider failed." }; }
        if (content.status !== "resolved") {
          const code = content.status === "not-found" ? "content-model-not-found" : content.status === "invalid" ? "content-model-invalid" : "content-provider-failure";
          diagnose(node, code, content.status === "not-found" ? "The Mapping Content model was not found." : content.reason);
        } else {
          mappingMetadataByNode.set(node.id, {
            name: resolved.record.document.name,
            model: content.model.document.name,
            kind: content.model.document.kind,
            entryCount: content.snapshot.count,
            slugFields: content.model.document.fields
              .filter((field) => field.kind === "slug")
              .map((field) => ({ id: field.id, label: field.label })),
            titleFields: content.model.document.fields
              .filter((field) => isSitemapDisplayTitleFieldKind(field.kind))
              .map((field) => ({ id: field.id, label: field.label })),
          });
        }
        if (readiness.status === "ready" && content.status === "resolved") {
          if (mappingSource.route.kind === "single") {
            if (content.model.document.kind !== "single") diagnose(node, "wrong-route-mode", "Collection mappings require an Entry slug field route.");
            else emit({ pathname: base, nodeId: node.id, sourceKind: "mapping" });
          } else if (content.model.document.kind !== "collection") {
            diagnose(node, "wrong-route-mode", "Single Content mappings require the single route mode.");
          } else {
            const fieldId = mappingSource.route.fieldId;
            const field = content.model.document.fields.find((candidate) => candidate.id === fieldId);
            if (!field) diagnose(node, "route-field-missing", "The selected Entry route field no longer exists.");
            else if (field.kind !== "slug") diagnose(node, "route-field-not-slug", "The selected Entry route field is not a slug field.");
            else {
              const titleFieldId = mappingSource.route.titleFieldId;
              const titleField = titleFieldId === undefined ? undefined : content.model.document.fields.find((candidate) => candidate.id === titleFieldId);
              if (titleFieldId !== undefined && !titleField) diagnose(node, "title-field-missing", "The selected Entry title field no longer exists.");
              else if (titleField && !isSitemapDisplayTitleFieldKind(titleField.kind)) diagnose(node, "title-field-not-textual", "The selected Entry title field is not a suitable textual field.");
              else {
                for (const entry of content.snapshot.entries) {
                  const segment = entrySegment((entry as ContentEntryRecord).values[field.id]);
                  if (!segment.ok) {
                    diagnose(node, segment.missing ? "entry-slug-missing" : "entry-slug-invalid", segment.missing ? "Entry slug is missing or empty." : "Entry slug contains a forbidden route delimiter.", { entryId: entry.id });
                  } else emit({ pathname: append(base, segment.segment), nodeId: node.id, sourceKind: "mapping", entryId: entry.id });
                }
              }
            }
          }
        }
      }
    }
    for (const child of node.children) await visit(child, fragments);
  };
  for (const root of document.root) await visit(root, []);
  const routesByNode = new Map<string, DerivedSitemapRoute[]>();
  for (const route of routes) routesByNode.set(route.nodeId, [...(routesByNode.get(route.nodeId) ?? []), route]);
  const diagnosticsByNode = new Map<string, SitemapRouteDiagnostic[]>();
  for (const diagnostic of diagnostics) diagnosticsByNode.set(diagnostic.nodeId, [...(diagnosticsByNode.get(diagnostic.nodeId) ?? []), diagnostic]);
  const nodeIds = new Set<string>();
  const collect = (nodes: readonly SitemapNode[]): void => { for (const node of nodes) { nodeIds.add(node.id); collect(node.children); } };
  collect(document.root);
  const nodes = new Map<string, SitemapNodeRouteInfo>();
  for (const nodeId of nodeIds) {
    const nodeRoutes = routesByNode.get(nodeId) ?? [];
    const nodeDiagnostics = diagnosticsByNode.get(nodeId) ?? [];
    nodes.set(nodeId, {
      derivedRouteCount: nodeRoutes.length,
      ...(nodeRoutes[0] ? { samplePath: nodeRoutes[0].pathname } : {}),
      status: nodeDiagnostics.length === 0 ? "ready" : "blocked",
      diagnostics: nodeDiagnostics,
      ...(mappingMetadataByNode.get(nodeId) ? { mapping: mappingMetadataByNode.get(nodeId) } : {}),
    });
  }
  return { routes, derivedRouteCount: routes.length, samplePath: routes[0]?.pathname, diagnostics, nodes };
}
