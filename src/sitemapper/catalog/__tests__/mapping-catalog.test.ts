import { describe, expect, it, vi } from "vitest";
import { ContentPersistenceError } from "../../../content";
import type { MappingCatalogProvider, MappingRecord } from "../../../mapping";
import { createMappingAssignmentCatalog, type SitemapperContentProvider } from "../mapping-catalog";

const stamp = "2026-08-29T00:00:00.000Z";
const record: MappingRecord = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1, id: "articles", name: "Articles", contentModel: { providerId: "content", recordId: "articles" }, composition: { providerId: "indexeddb", recordId: "article" }, bindings: [] } };
const mappingProvider = (): MappingCatalogProvider => ({ descriptor: { id: "mapping", label: "Mappings" }, store: { list: vi.fn(async () => [{ id: "articles", name: "Articles", createdAt: stamp, updatedAt: stamp, bindingCount: 0 }]), get: vi.fn(async () => ({ status: "loaded" as const, record })) } });
const contentProvider = (scanEntries: SitemapperContentProvider["store"]["scanEntries"]): SitemapperContentProvider => ({ descriptor: { id: "content", label: "Content" }, store: { scanEntries } });

describe("Mapping assignment catalog", () => {
  it("preserves provider-qualified list identity and resolves from one Content snapshot", async () => {
    const model = { id: "articles", createdAt: stamp, updatedAt: stamp, document: { schemaVersion: 1 as const, id: "articles", name: "Articles", kind: "collection" as const, fields: [] } };
    const scanEntries = vi.fn(async () => ({ model, count: 0, entries: [], diagnostics: [] }));
    const catalog = createMappingAssignmentCatalog([mappingProvider()], [contentProvider(scanEntries)]);
    expect(await catalog.list()).toMatchObject({ entries: [{ ref: { providerId: "mapping", recordId: "articles" } }], failures: [] });
    expect(await catalog.routes.resolveContentSnapshot(record)).toMatchObject({ status: "resolved", model });
    expect(scanEntries).toHaveBeenCalledTimes(1);
  });

  it("distinguishes unavailable providers, missing data, invalid snapshots, and provider failure", async () => {
    const unavailable = createMappingAssignmentCatalog([], []);
    expect(await unavailable.routes.resolveMapping({ providerId: "gone", recordId: "articles" })).toMatchObject({ status: "provider-error" });
    const failure = async (code: "not-found" | "validation" | "read-failed") => { throw new ContentPersistenceError("scan-entries", code, code, false); };
    for (const [code, status] of [["not-found", "not-found"], ["validation", "invalid"], ["read-failed", "provider-error"]] as const) {
      const catalog = createMappingAssignmentCatalog([mappingProvider()], [contentProvider(() => failure(code))]);
      expect(await catalog.routes.resolveContentSnapshot(record)).toMatchObject({ status });
    }
  });

  it("injects Mapping definition readiness and blocks safely when root wiring omits it", async () => {
    const resolveReadiness = vi.fn(async () => ({ status: "blocked" as const, diagnostics: [{ code: "duplicate-target", message: "Target is duplicated." }] }));
    const injected = createMappingAssignmentCatalog([mappingProvider()], [], resolveReadiness);
    expect(await injected.routes.resolveDefinitionReadiness(record)).toEqual({ status: "blocked", diagnostics: [{ code: "duplicate-target", message: "Target is duplicated." }] });
    expect(resolveReadiness).toHaveBeenCalledWith(record);
    const unavailable = createMappingAssignmentCatalog([mappingProvider()], []);
    expect(await unavailable.routes.resolveDefinitionReadiness(record)).toMatchObject({ status: "blocked", diagnostics: [{ code: "readiness-unavailable" }] });
  });
});
