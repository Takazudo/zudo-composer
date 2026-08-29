import type { ContentEntryRecord } from "../../content";
import type { SitemapNode } from "../model";
import type { DerivedSitemapRoute, ExpandSitemapRoutesOptions, SitemapRouteDiagnostic, SitemapRouteExpansion } from "./types";

function encodedParts(fragment: string): string[] {
  return fragment.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean)
    .map((part) => encodeURIComponent(part.normalize("NFC")));
}

export function authoredPath(fragments: readonly string[]): string {
  const parts = fragments.flatMap(encodedParts);
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function entrySegment(value: unknown): { ok: true; segment: string } | { ok: false; missing: boolean } {
  if (typeof value !== "string") return { ok: false, missing: value === undefined || value === null };
  const normalized = value.trim().normalize("NFC");
  if (!normalized) return { ok: false, missing: true };
  if (normalized.includes("/") || normalized.includes("?") || normalized.includes("#") || normalized === "." || normalized === "..") {
    return { ok: false, missing: false };
  }
  return { ok: true, segment: encodeURIComponent(normalized) };
}

function append(base: string, segment: string): string {
  return base === "/" ? `/${segment}` : `${base}/${segment}`;
}

export async function expandSitemapRoutes({ document, catalog }: ExpandSitemapRoutesOptions): Promise<SitemapRouteExpansion> {
  const routes: DerivedSitemapRoute[] = [];
  const diagnostics: SitemapRouteDiagnostic[] = [];
  const seen = new Map<string, DerivedSitemapRoute>();

  const emit = (route: DerivedSitemapRoute): void => {
    const previous = seen.get(route.pathname);
    if (previous) {
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
        let content;
        try { content = await catalog.resolveContentSnapshot(resolved.record); }
        catch (error) { content = { status: "provider-error" as const, reason: error instanceof Error ? error.message : "Content snapshot provider failed." }; }
        if (content.status !== "resolved") {
          const code = content.status === "not-found" ? "content-model-not-found" : content.status === "invalid" ? "content-model-invalid" : "content-provider-failure";
          diagnose(node, code, content.status === "not-found" ? "The Mapping Content model was not found." : content.reason);
        } else if (mappingSource.route.kind === "single") {
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
    for (const child of node.children) await visit(child, fragments);
  };
  for (const root of document.root) await visit(root, []);
  return { routes, derivedRouteCount: routes.length, samplePath: routes[0]?.pathname, diagnostics };
}
