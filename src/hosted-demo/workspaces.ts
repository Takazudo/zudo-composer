import type { WorkspaceProviderSet } from "../app/provider-integration";
import type { WorkspaceStorage } from "../app/workspace-storage";
import { workspaceProjectMetadata, type WorkspaceRecord } from "../app/workspace-record";
import { WorkspaceRegistryError } from "../app/workspace-filesystem/types";
import { TransactionalContentStore } from "../content/storage/filesystem/transactional-store";
import { TransactionalMappingStore } from "../mapping/storage/filesystem/transactional-store";
import { TransactionalSitemapStore } from "../sitemapper/storage/filesystem/transactional-store";
import { CONTENT_PROVIDERS } from "../content/library";
import { MAPPING_PROVIDERS, MappingPersistenceError } from "../mapping/model";
import { SITEMAP_PROVIDERS, SitemapPersistenceError } from "../sitemapper/library";
import { memoryTransactions } from "./transactions";
import { memoryCompositions } from "./compositions";
import { notifyPersistenceChange } from "../shared/persistence-generation";

export function createDemoWorkspaceProviders(): (workspace: () => string) => WorkspaceProviderSet {
  const records = new Map<string, WorkspaceRecord>();
  const domains = new Map<string, ReturnType<typeof createDomains>>();
  let selected: string | null = null;
  let generation = 0;
  const changed = () => { generation++; notifyPersistenceChange("workspace"); };
  const fail = (message: string): never => { throw new WorkspaceRegistryError("update", "conflict", message, true); };
  const required = (id: string) => records.get(id) ?? fail("Demo workspace does not exist.");
  async function createDomains() {
    return { compositions: memoryCompositions(), content: await TransactionalContentStore.fromRecords(memoryTransactions("content")), mappings: await TransactionalMappingStore.fromRecords(memoryTransactions("mapping", () => new MappingPersistenceError("transact", "conflict", "Mapping changed. Refresh and retry.", true))), sitemaps: await TransactionalSitemapStore.fromRecords(memoryTransactions("sitemapper", () => new SitemapPersistenceError("transact", "conflict", "Sitemap changed. Refresh and retry.", true))) };
  }
  const storage: WorkspaceStorage = {
    async list() { return structuredClone([...records.values()]); },
    async selection() { return selected; },
    async generation() { return generation; },
    async open(id) { return structuredClone(records.get(id ?? selected ?? "") ?? null); },
    async findSeeding(project, revision) { return structuredClone([...records.values()].find((r) => r.status === "seeding" && r.metadata.id === project.id && r.baselineRevision === revision) ?? null); },
    async create(project, baselineRevision, id = crypto.randomUUID(), requiresBeforeComplete = false) {
      const existing = records.get(id);
      if (existing) { if (existing.status !== "seeding" || existing.baselineRevision !== baselineRevision || JSON.stringify(existing.seed) !== JSON.stringify(project)) fail("Creation attempt conflicts with an existing workspace."); return structuredClone(existing); }
      const record: WorkspaceRecord = { schemaVersion: 1, id, mutationToken: 0, status: "seeding", metadata: workspaceProjectMetadata(project), baselineRevision, seed: structuredClone(project), ...(requiresBeforeComplete ? { requiresBeforeComplete: true } : {}) };
      domains.set(id, createDomains()); records.set(id, record); changed(); return structuredClone(record);
    },
    async markSeedCleanup(id, revision) { const r = required(id); if (r.status !== "seeding" || r.baselineRevision !== revision) fail("Cannot clean a completed or different seed."); r.seedCleanupPending = true; r.mutationToken++; changed(); },
    async discardSeeding(id, revision) { const r = required(id); if (r.status !== "seeding" || r.baselineRevision !== revision) fail("Cannot discard a completed or different seed."); records.delete(id); domains.delete(id); changed(); },
    async complete(id, validated = false) { const r = required(id); if (r.seedCleanupPending || (r.requiresBeforeComplete && !validated)) fail("Workspace creation must finish validation."); r.status = "ready"; delete r.seed; delete r.requiresBeforeComplete; r.mutationToken++; selected = id; changed(); return structuredClone(r); },
    async update(id, expectedToken, patch) { const r = required(id); if (r.mutationToken !== expectedToken) fail("Workspace changed. Refresh and retry."); const { baselineRevision, ...metadata } = structuredClone(patch); Object.assign(r.metadata, metadata); if (baselineRevision !== undefined) r.baselineRevision = baselineRevision; r.mutationToken++; changed(); return structuredClone(r); },
    async deleteDirectories(id) { domains.delete(id); },
    async missingDirectories(id) { return domains.has(id) ? [] : ["compositions", "content", "mappings", "sitemaps"]; },
  };
  return (workspace) => {
    const domain = <K extends keyof Awaited<ReturnType<typeof createDomains>>>(key: K): Awaited<ReturnType<typeof createDomains>>[K] => new Proxy({}, {
      get(_target, property) {
        if (property === "then") return undefined;
        if (property === "transactionScope") return "provider";
        if (property === "provider") return key === "compositions" ? { id: "files", label: "Disposable demo", storageLabel: "This tab's memory" } : { id: key === "content" ? "content-filesystem" : key === "mappings" ? "mapping-filesystem" : "sitemap-filesystem", label: "Disposable demo" };
        return async (...args: unknown[]) => { const pending = domains.get(workspace()); if (!pending) fail("Demo workspace storage is missing."); const store = (await pending!)[key]; const method = Reflect.get(store, property); if (typeof method !== "function") throw new Error(`Unsupported demo operation: ${String(property)}`); return Reflect.apply(method, store, args); };
      },
      has(_target, property) { return ["seed", "readAll", "snapshot", "mutationToken", "deleteWithDependencyCheck", "unpublishWithDependencyCheck", "saveLifecycleRecord"].includes(String(property)); },
    }) as Awaited<ReturnType<typeof createDomains>>[K];
    const compositions = domain("compositions"); const content = domain("content"); const mappings = domain("mappings"); const sitemaps = domain("sitemaps");
    const initialize = async () => ({ status: "ready" as const, summaries: await compositions.list() });
    const initializer = <T>(fn: () => Promise<T>) => ({ initialize: fn, retry: fn, startFresh: fn });
    return { storage, compositions: { descriptor: compositions.provider, store: compositions, initialization: initializer(initialize) }, content: { descriptor: { ...CONTENT_PROVIDERS.filesystem, label: "Disposable demo" }, store: content, initialization: initializer(() => content.initialize()) }, mappings: { descriptor: { ...MAPPING_PROVIDERS.filesystem, label: "Disposable demo" }, store: mappings, initialization: initializer(() => mappings.initialize()) }, sitemaps: { descriptor: { ...SITEMAP_PROVIDERS.filesystem, label: "Disposable demo" }, store: sitemaps, initialization: initializer(() => sitemaps.initialize()) } };
  };
}
