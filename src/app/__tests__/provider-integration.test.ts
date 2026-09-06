import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentPersistenceError } from "../../content/library";
import { compileSiteProject } from "../../site-project/compiler";
import { serializeSiteProject } from "../../site-project/model/canonical";
import { loadSampleSiteProject } from "../../test/site-project-fixture";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { activeSiteProjectValidationContext } from "../site-project-manifest";
import { createProductionProviderIntegration, type WorkspaceProviderSet } from "../provider-integration";
import { createWorkspaceSummary } from "../workspace-summary";
import { createTemporaryWorkspaceProviders, type TemporaryWorkspaceProviders } from "../../test/workspace-providers";

const sample = () => loadSampleSiteProject(activeSiteProjectValidationContext);
const revision = (project: ReturnType<typeof sample>) => createHash("sha256").update(serializeSiteProject(project), "utf8").digest("hex");

const hosts: TemporaryWorkspaceProviders[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((value) => value.dispose())); });

/** One temporary host project; every integration in a test shares it. */
async function host(): Promise<TemporaryWorkspaceProviders> {
  const value = await createTemporaryWorkspaceProviders();
  hosts.push(value);
  return value;
}

async function integration(project = sample(), current?: TemporaryWorkspaceProviders) {
  return createProductionProviderIntegration({
    project,
    sourceRevision: revision(project),
    createProviders: (current ?? await host()).createProviders,
  });
}

type Domain = "compositions" | "content" | "mappings" | "sitemaps";

/**
 * Make one domain's first initialization fail, at the provider seam the
 * integration actually calls. It is the transport-agnostic equivalent of the
 * injected open failure a store lane would use, and it exercises the same thing:
 * a retry has to re-run the whole graph coherently.
 */
function failFirstInitialization(
  create: TemporaryWorkspaceProviders["createProviders"],
  domain: Domain,
): TemporaryWorkspaceProviders["createProviders"] {
  let fail = true;
  return (workspace) => {
    const set = create(workspace);
    const provider = set[domain];
    return {
      ...set,
      [domain]: {
        ...provider,
        initialization: {
          ...provider.initialization,
          initialize: async () => {
            if (!fail) return provider.initialization.initialize();
            fail = false;
            throw new Error("injected initialization failure");
          },
        },
      },
    } as WorkspaceProviderSet;
  };
}

describe("SiteProject provider integration", () => {
  it("seeds the exact provider graph and compiles the provider-backed snapshot to seven routes", async () => {
    const current = await integration();
    expect((await current.compositionCatalog.listCompositions()).entries).toHaveLength(6);
    expect(await current.initialization.initialize()).toEqual({ status: "ready" });
    const snapshot = await current.getCurrentSiteProject();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") return;
    expect(snapshot.project.providers.compositions[0]!.records).toHaveLength(6);
    expect(snapshot.project.providers.content[0]!.models).toHaveLength(2);
    expect(snapshot.project.providers.content[0]!.entries).toHaveLength(4);
    expect(snapshot.project.providers.mappings[0]!.records).toHaveLength(2);
    expect(snapshot.project.providers.sitemaps[0]!.records).toHaveLength(1);
    const compiled = await compileSiteProject(snapshot.project, { componentCatalog: activeComponentProvider.catalog });
    expect(compiled.status).toBe("ready");
    if (compiled.status === "ready") expect(compiled.build.routes).toHaveLength(7);
  });

  it("does not turn Mapping save-session generation changes into attachment notifications", async () => {
    const current = await integration();
    await current.initialization.initialize();
    const changed = vi.fn();
    const stop = current.mappingAttachmentService.subscribe?.(changed);
    const session = current.sessions.register({ feature: "test", providerId: "mapping-filesystem" }, { flush: async () => undefined });
    session.changed();
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    session.detach();
    await current.sessions.flush();
    stop?.();
  });

  it("provides a real provider-qualified attachment aggregate with CAS persistence and materialized preview", async () => {
    const current = await integration();
    expect(await current.initialization.initialize()).toEqual({ status: "ready" });
    const linked = await current.compositionProviders[0]!.store.get("journal-entry-page");
    if (linked.status !== "loaded") throw new Error("Expected the sample journal Composition.");
    const detachedDocument = structuredClone(linked.record.document);
    delete detachedDocument.binding;
    await current.compositionProviders[0]!.store.put({ ...linked.record, document: detachedDocument });

    const before = await current.mappingAttachmentService.list();
    const target = before.targets.find((candidate) => candidate.composition.recordId === "home-page" && candidate.nodeId === "home-copy-stack" && candidate.slotId === "content");
    if (!target) throw new Error("Expected the sample home stack named slot.");
    expect(before.attachments).toEqual([]);

    await current.mappingAttachmentService.attach({ composition: target.composition, target: { nodeId: target.nodeId, slotId: target.slotId }, mapping: { providerId: "mapping-filesystem", recordId: "journal-entry-mapping" } });
    const metadata = await current.workspace.metadata();
    expect(metadata.metadata.collectionAttachments).toHaveLength(1);
    const attachment = metadata.metadata.collectionAttachments[0]!;
    expect(attachment).toMatchObject({ composition: target.composition, target: { nodeId: target.nodeId, slotId: target.slotId }, mapping: { providerId: "mapping-filesystem", recordId: "journal-entry-mapping" } });

    const after = await current.mappingAttachmentService.list();
    expect(after.attachments).toHaveLength(1);
    expect(after.attachments[0]!.effectiveEntries.map((entry) => entry.id)).toEqual(["article-small-loops", "article-moving-parts", "article-first-question"]);
    expect(JSON.stringify(after.attachments[0]!.materializedDocument)).toContain("__zudo_collection_");
    const preview = await current.mappingAttachmentService.preview(attachment);
    expect(preview.status).toBe("ready");
    let mutated = false;
    await expect(current.mappingAttachmentService.withMappingMutation({ providerId: "mapping-filesystem", recordId: "journal-entry-mapping" }, async () => { mutated = true; })).rejects.toThrow(/attached/);
    expect(mutated).toBe(false);
    await expect(current.mappingAttachmentService.assertMappingDeletable({ providerId: "mapping-filesystem", recordId: "journal-entry-mapping" })).rejects.toThrow(/attached/);

    await current.mappingAttachmentService.detach(attachment);
    expect((await current.workspace.metadata()).metadata.collectionAttachments).toEqual([]);
    await expect(current.mappingAttachmentService.assertMappingDeletable({ providerId: "mapping-filesystem", recordId: "journal-entry-mapping" })).resolves.toBeUndefined();
  });

  it("keeps stale attachment records detachable and scopes compiler diagnostics to their own edge", async () => {
    const current = await integration();
    await current.initialization.initialize();
    const linked = await current.compositionProviders[0]!.store.get("journal-entry-page");
    if (linked.status !== "loaded") throw new Error("Expected the sample journal Composition.");
    const detachedDocument = structuredClone(linked.record.document);
    delete detachedDocument.binding;
    await current.compositionProviders[0]!.store.put({ ...linked.record, document: detachedDocument });

    const attachments = [
      { id: "valid-attachment", order: 0, composition: { providerId: "files" as const, recordId: "home-page" }, target: { nodeId: "home-copy-stack", slotId: "content" }, mapping: { providerId: "mapping-filesystem" as const, recordId: "journal-entry-mapping" } },
      { id: "stale-attachment", order: 1, composition: { providerId: "files" as const, recordId: "home-page" }, target: { nodeId: "home-copy-stack", slotId: "missing-slot" }, mapping: { providerId: "mapping-filesystem" as const, recordId: "journal-entry-mapping" } },
    ];
    const metadata = await current.workspace.metadata();
    await current.workspace.updateMetadata(metadata.mutationToken, { collectionAttachments: attachments });

    const snapshot = await current.mappingAttachmentService.list();
    const valid = snapshot.attachments.find((item) => item.attachment.id === "valid-attachment");
    const stale = snapshot.attachments.find((item) => item.attachment.id === "stale-attachment");
    expect(valid?.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("attachment-target-invalid");
    expect(stale).toMatchObject({ target: { slotLabel: "Missing named slot", nodeId: "home-copy-stack", slotId: "missing-slot" } });
    expect(stale?.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ severity: "blocking" })]));

    await current.mappingAttachmentService.detach(stale!.attachment);
    expect((await current.workspace.metadata()).metadata.collectionAttachments).toHaveLength(1);
    await current.mappingAttachmentService.detach(valid!.attachment);
    expect((await current.workspace.metadata()).metadata.collectionAttachments).toEqual([]);
  });

  it("serializes attachment writes from two integrations sharing one workspace", async () => {
    const project = await host();
    const first = await integration(sample(), project);
    await first.initialization.initialize();
    const linked = await first.compositionProviders[0]!.store.get("journal-entry-page");
    if (linked.status !== "loaded") throw new Error("Expected the sample journal Composition.");
    const detachedDocument = structuredClone(linked.record.document);
    delete detachedDocument.binding;
    await first.compositionProviders[0]!.store.put({ ...linked.record, document: detachedDocument });
    const second = await integration(sample(), project);
    await second.initialization.initialize();
    const target = (await first.mappingAttachmentService.list()).targets.find((candidate) => candidate.composition.recordId === "home-page" && candidate.nodeId === "home-copy-stack" && candidate.slotId === "content");
    if (!target) throw new Error("Expected the sample home stack named slot.");
    const request = { composition: target.composition, target: { nodeId: target.nodeId, slotId: target.slotId }, mapping: { providerId: "mapping-filesystem", recordId: "journal-entry-mapping" } };

    const outcomes = await Promise.allSettled([first.mappingAttachmentService.attach(request), second.mappingAttachmentService.attach(request)]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect((await first.workspace.metadata()).metadata.collectionAttachments).toHaveLength(1);
    await first.mappingAttachmentService.detach((await first.mappingAttachmentService.list()).attachments[0]!.attachment);
  });

  it("is idempotent, preserves an authoring edit, and detaches snapshots from the checked-in sample", async () => {
    const current = await integration(); await current.initialization.initialize(); await current.initialization.initialize();
    const before = await current.compositionProviders[0]!.store.get("services-page");
    if (before.status !== "loaded") throw new Error("missing seed");
    await current.compositionProviders[0]!.store.put({ ...before.record, updatedAt: "2026-09-01T00:00:00.000Z", document: { ...before.record.document, name: "Edited services" } });
    expect(await current.initialization.retry()).toEqual({ status: "ready" });
    const snapshot = await current.getCurrentSiteProject();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") return;
    expect(snapshot.project.providers.compositions[0]!.records.find(({ id }) => id === "services-page")!.document.name).toBe("Edited services");
    expect(sample().providers.compositions[0]!.records.find(({ id }) => id === "services-page")!.document.name).toBe("Services page");
  });

  it("preserves newer authoring records and metadata across changed activated source and reload", async () => {
    const project = await host();
    const firstProject = sample();
    const firstRevision = revision(firstProject);
    const first = createProductionProviderIntegration({
      project: firstProject,
      sourceRevision: firstRevision,
      createProviders: project.createProviders,
    });
    expect(await first.initialization.initialize()).toEqual({ status: "ready" });
    const firstServices = await first.compositionProviders[0]!.store.get("services-page");
    if (firstServices.status !== "loaded") throw new Error("missing first revision Composition");
    await first.compositionProviders[0]!.store.put({
      ...firstServices.record,
      updatedAt: "2026-09-01T00:00:00.000Z",
      document: { ...firstServices.record.document, name: "First revision browser edit" },
    });

    const firstReload = createProductionProviderIntegration({
      project: firstProject,
      sourceRevision: firstRevision,
      createProviders: project.createProviders,
    });
    const firstSnapshot = await firstReload.getCurrentSiteProject();
    expect(firstSnapshot).toMatchObject({
      status: "ready",
      project: { providers: { compositions: [{ records: expect.arrayContaining([expect.objectContaining({ document: expect.objectContaining({ name: "First revision browser edit" }) })]) }] } },
    });

    const secondProject = sample();
    secondProject.name = "Second revision source";
    secondProject.providers.compositions[0]!.records.find(({ id }) => id === "services-page")!.document.name = "Second revision services";
    secondProject.providers.content[0]!.entries.find(({ id }) => id === "about-entry")!.values["about-heading-field"] = "Second revision about";
    secondProject.providers.mappings[0]!.records.find(({ id }) => id === "about-page-mapping")!.document.name = "Second revision mapping";
    secondProject.providers.sitemaps[0]!.records[0]!.document.root[0]!.title = "Second revision home";
    const secondRevision = revision(secondProject);
    expect(secondRevision).not.toBe(firstRevision);
    const second = createProductionProviderIntegration({
      project: secondProject,
      sourceRevision: secondRevision,
      createProviders: project.createProviders,
    });
    const secondSnapshot = await second.getCurrentSiteProject();
    expect(secondSnapshot).toEqual(firstSnapshot);
    expect(second.workspace.id).toBe(first.workspace.id);
    expect((await second.workspace.metadata()).baselineRevision).toBe(firstRevision);
  });

  it("rejects a non-canonical source revision before provider initialization", async () => {
    const current = createProductionProviderIntegration({
      project: sample(),
      sourceRevision: "not-a-revision",
      createProviders: (await host()).createProviders,
    });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "source", retryable: false, message: expect.stringContaining("SHA-256") } });
  });

  it("rejects an explicit project without a canonical source revision", async () => {
    const current = createProductionProviderIntegration({
      project: sample(),
      createProviders: (await host()).createProviders,
    } as unknown as Parameters<typeof createProductionProviderIntegration>[0]);
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "source", retryable: false, message: expect.stringContaining("missing its canonical revision") } });
  });

  it("fails closed before writing any provider directory when workspace seed locking fails", async () => {
    const project = await host();
    const hadOwnLocks = Object.hasOwn(navigator, "locks");
    const priorLocks = navigator.locks;
    Object.defineProperty(navigator, "locks", { configurable: true, value: { request: () => Promise.reject(new Error("locking unavailable")) } });
    let workspaceId: string | undefined;
    try {
      const current = await integration(sample(), project);
      expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { retryable: true, message: expect.stringContaining("locking unavailable") } });
      // The registry record exists — the attempt was recorded before the lock —
      // but not one authoring directory was written.
      workspaceId = current.workspace.id;
    } finally {
      if (hadOwnLocks) Object.defineProperty(navigator, "locks", { configurable: true, value: priorLocks });
      else Reflect.deleteProperty(navigator, "locks");
    }
    expect(workspaceId).toBeDefined();
    expect(await project.storage.missingDirectories(workspaceId!)).toEqual(["compositions", "content", "mappings", "sitemaps"]);
  });

  it("rejects a portable static-only graph that cannot back every browser authoring workspace", async () => {
    const project = sample();
    const root = project.providers.sitemaps[0]!.records[0]!.document.root[0]!;
    const about = root.children.find(({ id }) => id === "about-node")!;
    about.source = { kind: "composition", ref: { providerId: "files", recordId: "about-page" } };
    root.children.find(({ id }) => id === "journal-node")!.children = [];
    project.providers.content = [];
    project.providers.mappings = [];
    const current = createProductionProviderIntegration({
      project,
      sourceRevision: revision(project),
      createProviders: (await host()).createProviders,
    });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "source", retryable: false, message: expect.stringContaining("content") } });
  });

  it.each(["compositions", "content", "mappings", "sitemaps"] as const)("recovers a %s phase failure without false readiness", async (domain) => {
    const project = await host();
    const current = createProductionProviderIntegration({ project: sample(), sourceRevision: revision(sample()), createProviders: failFirstInitialization(project.createProviders, domain) });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { retryable: true } });
    expect(await current.initialization.retry()).toEqual({ status: "ready" });
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "ready" });
  });

  // Against the real integration, not a fake, because two things must hold at once
  // and neither is visible from a summary-level fake. `retry()` has to re-open the
  // backing that failed the first time and re-seed it coherently; and the mapping
  // loader reads through `mappingCatalog`/`contentCatalog`, which are built over
  // `ensureReady()`-guarded stores that call `lifecycle.initialize()` again — so
  // that follow-up initialize must be idempotent against the graph retry just
  // seeded. (The composition, content and sitemap loaders read their raw stores
  // directly and never re-enter the lifecycle.)
  it("recovers a workspace summary through retry after the first initialization failed", async () => {
    const project = await host();
    const current = createProductionProviderIntegration({ project: sample(), sourceRevision: revision(sample()), createProviders: failFirstInitialization(project.createProviders, "compositions") });
    const retry = vi.spyOn(current.initialization, "retry");
    const summary = createWorkspaceSummary(current);

    const failed = await summary.counts();
    for (const source of [failed.compositions, failed.mappings, failed.sitemaps, failed.content]) expect(source.status).toBe("unavailable");

    summary.refresh();
    const recovered = await summary.counts();

    expect(recovered.compositions).toMatchObject({ status: "ok", value: { compositions: 6 } });
    expect(recovered.content).toMatchObject({ status: "ok", value: { models: 2, entries: 4 } });
    expect(recovered.mappings).toMatchObject({ status: "ok", value: { mappings: 2 } });
    expect(recovered.sitemaps).toMatchObject({ status: "ok", value: { sitemaps: 1 } });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each(["composer", "content", "mapping", "sitemapper"] as const)("converges when %s boots first", async (first) => {
    const current = await integration();
    const outcome = first === "composer" ? await current.compositionProviders[0]!.initialization.initialize()
      : first === "content" ? await current.contentProvider.initialization.initialize()
        : first === "mapping" ? await current.mappingProvider.initialization.initialize()
          : await current.sitemapProvider.initialization.initialize();
    expect(outcome.status).toBe("ready");
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "ready" });
  });

  it("rejects in-place startFresh and creates a separately selected complete workspace on reset", async () => {
    const current = await integration(); await current.initialization.initialize();
    const [fresh, concurrent] = await Promise.all([current.initialization.startFresh(), current.initialization.initialize()]);
    expect(fresh).toMatchObject({ status: "error", error: { code: "reset-required" } }); expect(concurrent).toEqual({ status: "ready" });
    const next = await current.workspace.reset();
    expect(next.workspace.id).not.toBe(current.workspace.id);
    const snapshot = await next.getCurrentSiteProject();
    expect(snapshot).toMatchObject({ status: "ready", project: { providers: { compositions: [{ records: expect.arrayContaining([expect.objectContaining({ id: "site-frame" })]) }], sitemaps: [{ records: [expect.objectContaining({ id: "sample-studio-sitemap" })] }] } } });
  });

  it("returns a recoverable unavailable state for a null development source", async () => {
    const current = createProductionProviderIntegration({ project: null, createProviders: (await host()).createProviders });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "source", retryable: true } });
    expect(await current.compositionCatalog.listCompositions()).toMatchObject({ entries: [], failures: [expect.objectContaining({ reason: expect.stringContaining("No development SiteProject") })] });
    expect(await current.compositionCatalog.resolveComposition({ providerId: "files", recordId: "home-page" })).toEqual({ status: "provider-unavailable" });
    expect(await current.contentCatalog.listModels()).toMatchObject({ entries: [], failures: [expect.objectContaining({ reason: expect.stringContaining("No development SiteProject") })] });
    expect(await current.contentCatalog.resolveModel({ providerId: "content-filesystem", recordId: "articles" })).toMatchObject({ status: "provider-error", reason: expect.stringContaining("No development SiteProject") });
    expect(await current.mappingCompositionCatalog.list()).toMatchObject({ entries: [], failures: [expect.objectContaining({ reason: expect.stringContaining("No development SiteProject") })] });
    expect(await current.mappingCompositionCatalog.resolve({ providerId: "files", recordId: "home-page" })).toMatchObject({ status: "provider-error", reason: expect.stringContaining("No development SiteProject") });
    expect(await current.mappingCatalog.list()).toMatchObject({ entries: [], failures: [expect.objectContaining({ reason: expect.stringContaining("No development SiteProject") })] });
    expect(await current.sitemapperMappingCatalog.list()).toMatchObject({ entries: [], failures: [expect.objectContaining({ reason: expect.stringContaining("No development SiteProject") })] });
  });

  it("never reaches ready when a Single model seed contains multiple Entries", async () => {
    const invalid = sample(); const content = invalid.providers.content[0]!; const entry = content.entries.find(({ modelId }) => modelId === "about-content")!;
    content.entries.push({ ...structuredClone(entry), id: "about-entry-duplicate" });
    const current = createProductionProviderIntegration({ project: invalid, sourceRevision: revision(invalid), createProviders: (await host()).createProviders });
    expect(await current.initialization.initialize()).toMatchObject({ status: "error", error: { phase: "source", retryable: false, message: expect.stringContaining("at most one Entry") } });
  });

  it("refuses a snapshot whose Sitemap references a Composition an author deleted", async () => {
    const host_ = await host();
    const project = sample(); const projectRevision = revision(project);
    const prior = createProductionProviderIntegration({ project, sourceRevision: projectRevision, createProviders: host_.createProviders });
    expect(await prior.compositionProviders[0]!.initialization.initialize()).toMatchObject({ status: "ready" });
    expect(await prior.compositionProviders[0]!.store.delete("services-page")).toBe(true);

    const current = createProductionProviderIntegration({ project, sourceRevision: projectRevision, createProviders: host_.createProviders });
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "error" });
  });

  it("refuses a snapshot whose live Sitemap references a Mapping that is not there", async () => {
    const host_ = await host();
    const project = sample();
    const projectRevision = revision(project);
    const prior = createProductionProviderIntegration({ project, sourceRevision: projectRevision, createProviders: host_.createProviders });
    expect(await prior.sitemapProvider.initialization.initialize()).toMatchObject({ status: "ready" });
    const loaded = await prior.sitemapProvider.store.get("sample-studio-sitemap");
    if (loaded.status !== "loaded") throw new Error("missing live Sitemap");
    const live = structuredClone(loaded.record);
    const about = live.document.root[0]!.children.find(({ id }) => id === "about-node")!;
    if (about.source.kind !== "mapping") throw new Error("expected Mapping source");
    about.source.ref.recordId = "missing-mapping";
    await prior.sitemapProvider.store.put(live);
    const current = createProductionProviderIntegration({ project, sourceRevision: projectRevision, createProviders: host_.createProviders });
    expect(await current.getCurrentSiteProject()).toMatchObject({ status: "error", error: { phase: "snapshot", message: expect.stringContaining("missing-mapping") } });
  });

  it("exposes and snapshots exactly the declared Composition provider set", async () => {
    const current = await integration();
    expect(current.compositionProviders.map(({ descriptor }) => descriptor.id)).toEqual(["files"]);
    const snapshot = await current.getCurrentSiteProject();
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") return;
    expect(snapshot.project.providers.compositions.map(({ id }) => id)).toEqual(["files"]);
  });

  it("preserves a non-retryable Content failure through both the initialize and retry wrappers", async () => {
    const project = await host();
    const refuse = async () => ({
      status: "error" as const,
      error: new ContentPersistenceError("initialize", "unsupported-version", "Content storage is newer than this build.", false),
    });
    const current = createProductionProviderIntegration({
      project: sample(),
      sourceRevision: revision(sample()),
      createProviders: (workspace) => {
        const set = project.createProviders(workspace);
        return { ...set, content: { ...set.content, initialization: { ...set.content.initialization, initialize: refuse, retry: refuse } } };
      },
    });
    expect(await current.contentProvider.initialization.initialize()).toMatchObject({ status: "error", error: { retryable: false, message: expect.stringContaining("newer") } });
    expect(await current.contentProvider.initialization.retry()).toMatchObject({ status: "error", error: { retryable: false, message: expect.stringContaining("newer") } });
  });
});
