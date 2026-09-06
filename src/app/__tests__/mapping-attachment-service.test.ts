import { describe, expect, it } from "vitest";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { loadSampleSiteProject } from "../../test/site-project-fixture";
import { createMappingAttachmentService } from "../mapping-attachment-service";
import { activeSiteProjectValidationContext } from "../site-project-manifest";
import type { WorkspaceRecord } from "../workspace-storage";
import { providerFixture, PNG } from "../../features/media/__tests__/versioned-fixture";
import { createProductionProviderIntegration } from "../provider-integration";
import { IDBFactory } from "fake-indexeddb";
import { createHash } from "node:crypto";
import { serializeSiteProject } from "../../site-project/model/canonical";

describe("mapping attachment aggregate service", () => {
  it("attaches an unpersisted candidate with the real production Media store and metadata CAS", async () => {
    const { provider, filesystem } = await providerFixture();
    const asset = await filesystem.upload({ fileName: "link.png", declaredMediaType: "image/png", bytes: PNG });
    const project = loadSampleSiteProject(activeSiteProjectValidationContext);
    const source = project.providers.compositions[0]!.records.find(({ id }) => id === "journal-entry-page")!;
    delete source.document.binding;
    source.document.root.push({ id: "download", componentId: "ui.cta-button", componentVersion: 1, props: { href: `/uploaded-media/asset-${asset.id}`, children: "Download" }, slots: {} });
    const idb = new IDBFactory();
    const integration = createProductionProviderIntegration({ project, sourceRevision: createHash("sha256").update(serializeSiteProject(project)).digest("hex"), mediaProvider: provider, compositionIdbFactory: idb, contentIdbFactory: idb, mappingIdbFactory: idb, sitemapIdbFactory: idb });
    expect((await integration.initialization.initialize()).status).toBe("ready");
    const before = await integration.workspace.metadata();
    await integration.mappingAttachmentService.attach({ composition: { providerId: "indexeddb", recordId: "home-page" }, target: { nodeId: "home-copy-stack", slotId: "content" }, mapping: { providerId: "mapping-indexeddb", recordId: "journal-entry-mapping" } });
    const after = await integration.workspace.metadata();
    expect(after.mutationToken).toBeGreaterThan(before.mutationToken);
    expect(after.metadata.collectionAttachments).toHaveLength(1);
  });
  it("pins managed Media in attachment previews and reports missing provider as blocking", async () => {
    const { provider, filesystem } = await providerFixture();
    const asset = await filesystem.upload({ fileName: "link.png", declaredMediaType: "image/png", bytes: PNG });
    const project = loadSampleSiteProject(activeSiteProjectValidationContext);
    const source = project.providers.compositions[0]!.records.find(({ id }) => id === "journal-entry-page")!;
    delete source.document.binding;
    source.document.root.push({ id: "download", componentId: "ui.cta-button", componentVersion: 1, props: { href: `/uploaded-media/asset-${asset.id}`, children: "Download" }, slots: {} });
    const attachment = { id: "cards", order: 0, composition: { providerId: "indexeddb", recordId: "home-page" }, target: { nodeId: "home-copy-stack", slotId: "content" }, mapping: { providerId: "mapping-indexeddb", recordId: "journal-entry-mapping" } } as const;
    project.collectionAttachments.push(attachment);
    const metadata = { id: "workspace", mutationToken: 0 } as WorkspaceRecord;
    const options = { getCurrentSiteProject: async () => ({ status: "ready" as const, project }), workspace: { metadata: async () => metadata, updateMetadata: async () => metadata }, componentCatalog: activeComponentProvider.catalog, subscribe: () => () => undefined };
    const preview = await createMappingAttachmentService({ ...options, mediaStore: provider.store }).preview(attachment);
    expect(preview.status).toBe("ready"); expect(JSON.stringify(preview.document)).toContain(asset.document.versions[0]!.url);
    const missing = await createMappingAttachmentService(options).preview(attachment);
    expect(missing.status).toBe("blocked"); expect(missing.diagnostics.some(({ code }) => code === "media-capture-blocked")).toBe(true);
  });
  it("flushes its own serialized mutation queue without a workspace save-session callback", async () => {
    const project = loadSampleSiteProject(activeSiteProjectValidationContext);
    const linked = project.providers.compositions[0]!.records.find((record) => record.id === "journal-entry-page")!;
    delete linked.document.binding;
    let mutationToken = 0;
    let releaseUpdate!: () => void;
    let updateStarted!: () => void;
    const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
    const updateStartedGate = new Promise<void>((resolve) => { updateStarted = resolve; });
    const metadata = { id: "workspace", mutationToken: 0 } as WorkspaceRecord;
    let observedFlushSessions: boolean | undefined;
    const service = createMappingAttachmentService({
      getCurrentSiteProject: async (captureOptions) => { observedFlushSessions = captureOptions?.flushSessions; return { status: "ready", project }; },
      workspace: {
        metadata: async () => ({ ...metadata, mutationToken }),
        updateMetadata: async () => {
          updateStarted();
          await updateGate;
          mutationToken += 1;
          return { ...metadata, mutationToken };
        },
      },
      componentCatalog: activeComponentProvider.catalog,
      subscribe: () => () => undefined,
    });

    const attachmentTarget = { composition: { providerId: "indexeddb" as const, recordId: "home-page" }, target: { nodeId: "home-copy-stack", slotId: "content" }, mapping: { providerId: "mapping-indexeddb" as const, recordId: "journal-entry-mapping" } };
    const attaching = service.attach(attachmentTarget);
    await updateStartedGate;
    let flushed = false;
    const flushing = service.flush?.().then(() => { flushed = true; });
    await Promise.resolve();
    expect(flushed).toBe(false);
    releaseUpdate();
    await attaching;
    await flushing;

    expect(flushed).toBe(true);
    expect(observedFlushSessions).toBe(false);
  });

  it("guards destructive mutations from workspace metadata even when the Mapping snapshot is broken", async () => {
    const attachment = { id: "edge", order: 0, composition: { providerId: "indexeddb", recordId: "owner" }, target: { nodeId: "missing", slotId: "content" }, mapping: { providerId: "mapping-indexeddb", recordId: "mapping" } } as const;
    const metadata = { id: "workspace", mutationToken: 0, metadata: { collectionAttachments: [attachment] } } as unknown as WorkspaceRecord;
    let snapshotReads = 0;
    const service = createMappingAttachmentService({
      getCurrentSiteProject: async () => { snapshotReads += 1; throw new Error("broken Mapping snapshot"); },
      workspace: { metadata: async () => metadata, updateMetadata: async () => metadata },
      componentCatalog: activeComponentProvider.catalog,
      subscribe: () => () => undefined,
    });

    await expect(service.withMappingMutation(null, async () => undefined)).rejects.toThrow(/still persisted/);
    await expect(service.assertMappingDeletable(attachment.mapping)).rejects.toThrow(/attached/);
    expect(snapshotReads).toBe(0);
  });
});
