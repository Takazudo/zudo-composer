import { describe, expect, it, vi } from "vitest";
import type { ContentEntrySnapshot, ContentModelRecord } from "../../../content";
import type { MappingRecord } from "../../../mapping";
import { SITEMAP_SCHEMA_VERSION, type SitemapDocument, type SitemapNode } from "../../model";
import { authoredPath, expandSitemapRoutes } from "../expand";
import type { MappingRouteCatalog } from "../types";

const stamp = "2026-08-29T00:00:00.000Z";
const mapping = (): MappingRecord => ({ id: "mapping", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1, id: "mapping", name: "Articles", contentModel: { providerId: "content", recordId: "articles" }, composition: { providerId: "indexeddb", recordId: "article" }, bindings: [] } });
const model = (kind: "single" | "collection" = "collection", fieldKind: "slug" | "text" = "slug"): ContentModelRecord => ({ id: "articles", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1, id: "articles", name: "Articles", kind, fields: [{ id: "slug", key: "slug", label: "Slug", required: true, kind: fieldKind }] } });
const snapshot = (values: readonly unknown[]): ContentEntrySnapshot => ({ model: model(), count: values.length, diagnostics: [], entries: values.map((value, index) => ({ schemaVersion: 1, id: `entry-${index}`, modelId: "articles", createdAt: stamp, updatedAt: stamp, values: { slug: value as never } })) });
const page = (id: string, slug: string, source: SitemapNode["source"] = { kind: "unassigned" }, children: SitemapNode[] = []): SitemapNode => ({ id, title: id, slug, source, children });
const document = (root: SitemapNode): SitemapDocument => ({ schemaVersion: SITEMAP_SCHEMA_VERSION, id: "site", name: "Site", root: [root] });
const catalog = (options: { kind?: "single" | "collection"; values?: readonly unknown[]; fieldKind?: "slug" | "text"; readinessDiagnostic?: { code: string; message: string } } = {}): MappingRouteCatalog => ({ list: vi.fn(), resolveMapping: vi.fn(async () => ({ status: "resolved" as const, record: mapping() })), resolveDefinitionReadiness: vi.fn(async () => options.readinessDiagnostic ? ({ status: "blocked" as const, diagnostics: [options.readinessDiagnostic] }) : ({ status: "ready" as const })), resolveContentSnapshot: vi.fn(async () => ({ status: "resolved" as const, model: model(options.kind, options.fieldKind), snapshot: snapshot(options.values ?? ["first", "second"]) })) });
const source = (route: { kind: "single" } | { kind: "entry-field"; fieldId: string }): SitemapNode["source"] => ({ kind: "mapping", ref: { providerId: "mapping", recordId: "mapping" }, route });

describe("Sitemapper route expansion", () => {
  it("normalizes nested fragments, root, and Unicode as encoded path segments", () => {
    expect(authoredPath(["/", "docs// café ", "e\u0301"])).toBe("/docs/%20caf%C3%A9%20/%C3%A9");
    expect(authoredPath(["/"])).toBe("/");
  });

  it("expands one collection node in stable snapshot order without synthetic nodes", async () => {
    const node = page("articles", "/articles/", source({ kind: "entry-field", fieldId: "slug" }));
    const result = await expandSitemapRoutes({ document: document(node), catalog: catalog({ values: ["one", "café"] }) });
    expect(result.routes.map((route) => [route.pathname, route.entryId])).toEqual([["/articles/one", "entry-0"], ["/articles/caf%C3%A9", "entry-1"]]);
    expect(result).toMatchObject({ derivedRouteCount: 2, samplePath: "/articles/one", diagnostics: [] });
    expect(node.children).toEqual([]);
  });

  it("retains ancestor-aware canonical output for every node", async () => {
    const child = page("articles", "articles", source({ kind: "entry-field", fieldId: "slug" }));
    const result = await expandSitemapRoutes({ document: document(page("docs", "docs", undefined, [child])), catalog: catalog({ values: ["first"] }) });
    expect(result.nodes.get("articles")).toEqual({
      derivedRouteCount: 1,
      samplePath: "/docs/articles/first",
      status: "ready",
      diagnostics: [],
      mapping: { name: "Articles", model: "Articles", kind: "collection", entryCount: 1, slugFields: [{ id: "slug", label: "Slug" }] },
    });
  });

  it.each([
    ["composition-not-found", "The referenced Composition was not found."],
    ["target-node-missing", "The target node is stale."],
    ["target-field-missing", "The target field is stale."],
    ["component-version-mismatch", "The component version changed."],
    ["duplicate-target", "The target is bound twice."],
    ["incompatible-binding", "The source and target types are incompatible."],
  ])("blocks route generation for Mapping definition diagnostic %s", async (code, message) => {
    const injected = catalog({ readinessDiagnostic: { code, message } });
    const result = await expandSitemapRoutes({ document: document(page("articles", "articles", source({ kind: "entry-field", fieldId: "slug" }))), catalog: injected });
    expect(result.routes).toEqual([]);
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: "incompatible-mapping", nodeId: "articles", message })]);
    expect(result.nodes.get("articles")).toMatchObject({ derivedRouteCount: 0, status: "blocked", mapping: { entryCount: 2 } });
    expect(injected.resolveContentSnapshot).toHaveBeenCalledTimes(1);
  });

  it.each(["", " ", "a/b", "a?b", "a#b", ".", ".."])("diagnoses forbidden Entry slug %j", async (value) => {
    const result = await expandSitemapRoutes({ document: document(page("articles", "articles", source({ kind: "entry-field", fieldId: "slug" }))), catalog: catalog({ values: [value] }) });
    expect(result.diagnostics[0]?.code).toBe(value.trim() ? "entry-slug-invalid" : "entry-slug-missing");
    expect(result.derivedRouteCount).toBe(0);
  });

  it("diagnoses malformed Unicode in authored fragments and Entry slugs without throwing", async () => {
    const malformed = "\uD800";
    const authored = await expandSitemapRoutes({ document: document(page("bad", malformed)), catalog: catalog() });
    expect(authored.diagnostics).toEqual([expect.objectContaining({ code: "route-fragment-invalid", nodeId: "bad" })]);
    expect(authored.routes).toEqual([]);
    const entry = await expandSitemapRoutes({ document: document(page("articles", "articles", source({ kind: "entry-field", fieldId: "slug" }))), catalog: catalog({ values: [malformed] }) });
    expect(entry.diagnostics).toEqual([expect.objectContaining({ code: "entry-slug-invalid", entryId: "entry-0" })]);
    expect(entry.routes).toEqual([]);
    expect(() => authoredPath([malformed])).not.toThrow();
  });

  it("diagnoses both route-mode mismatches and missing/non-slug fields", async () => {
    const singleMismatch = await expandSitemapRoutes({ document: document(page("p", "p", source({ kind: "single" }))), catalog: catalog({ kind: "collection" }) });
    const collectionMismatch = await expandSitemapRoutes({ document: document(page("p", "p", source({ kind: "entry-field", fieldId: "slug" }))), catalog: catalog({ kind: "single" }) });
    const missing = await expandSitemapRoutes({ document: document(page("p", "p", source({ kind: "entry-field", fieldId: "gone" }))), catalog: catalog() });
    const wrong = await expandSitemapRoutes({ document: document(page("p", "p", source({ kind: "entry-field", fieldId: "slug" }))), catalog: catalog({ fieldKind: "text" }) });
    expect([singleMismatch, collectionMismatch, missing, wrong].map((result) => result.diagnostics[0]?.code)).toEqual(["wrong-route-mode", "wrong-route-mode", "route-field-missing", "route-field-not-slug"]);
  });

  it("reports static/static, static/generated, and generated/generated collisions case-sensitively", async () => {
    const staticStatic = await expandSitemapRoutes({ document: document(page("root", "/", undefined, [page("a", "same"), page("b", "same"), page("case", "Same")])), catalog: catalog() });
    expect(staticStatic.diagnostics.map((item) => item.code)).toContain("route-collision");
    const generated = page("generated", "/", source({ kind: "entry-field", fieldId: "slug" }));
    const staticGenerated = await expandSitemapRoutes({ document: document(page("root", "/", undefined, [page("static", "same"), generated])), catalog: catalog({ values: ["same", "same"] }) });
    expect(staticGenerated.diagnostics.filter((item) => item.code === "route-collision").map((item) => item.nodeId)).toEqual(["static", "generated", "static", "generated"]);
    expect(staticGenerated.nodes.get("generated")?.status).toBe("blocked");
    expect(staticGenerated.nodes.get("static")?.status).toBe("blocked");
    const generatedGenerated = await expandSitemapRoutes({ document: document(page("root", "/", undefined, [page("first", "/", source({ kind: "entry-field", fieldId: "slug" })), page("second", "/", source({ kind: "entry-field", fieldId: "slug" }))])), catalog: catalog({ values: ["same"] }) });
    expect(generatedGenerated.diagnostics.filter((item) => item.code === "route-collision").map((item) => item.nodeId)).toEqual(["first", "second"]);
    expect(generatedGenerated.nodes.get("first")?.status).toBe("blocked");
    expect(generatedGenerated.nodes.get("second")?.status).toBe("blocked");
    expect(staticStatic.routes.some((route) => route.pathname === "/Same")).toBe(true);
  });

  it("diagnoses unsupported external bases and provider outcomes", async () => {
    const external = await expandSitemapRoutes({ document: document(page("external", "https://example.com", source({ kind: "single" }))), catalog: catalog({ kind: "single" }) });
    expect(external.diagnostics[0]?.code).toBe("unsupported-external-base");
    const failed = catalog(); failed.resolveMapping = vi.fn(async () => ({ status: "provider-error" as const, reason: "offline" }));
    const result = await expandSitemapRoutes({ document: document(page("p", "p", source({ kind: "single" }))), catalog: failed });
    expect(result.diagnostics[0]).toMatchObject({ code: "mapping-provider-failure", message: "offline" });
  });

  it("uses exactly one Content snapshot so count, sample, and full routes agree", async () => {
    const injected = catalog({ values: ["one", "two"] });
    const result = await expandSitemapRoutes({ document: document(page("p", "p", source({ kind: "entry-field", fieldId: "slug" }))), catalog: injected });
    expect(injected.resolveContentSnapshot).toHaveBeenCalledTimes(1);
    expect(result.derivedRouteCount).toBe(result.routes.length);
    expect(result.samplePath).toBe(result.routes[0]?.pathname);
    expect(result.nodes.get("p")?.mapping?.entryCount).toBe(result.routes.length);
  });
});
