import { describe, expect, it } from "vitest";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { loadSampleSiteProject } from "../../site-project/sample";
import { createMappingAttachmentService } from "../mapping-attachment-service";
import { activeSiteProjectValidationContext } from "../site-project-manifest";
import type { WorkspaceRecord } from "../workspace-storage";

describe("mapping attachment aggregate service", () => {
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
    const service = createMappingAttachmentService({
      getCurrentSiteProject: async () => ({ status: "ready", project }),
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
  });
});
