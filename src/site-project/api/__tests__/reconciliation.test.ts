import { describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createIndexedDbContentProvider } from "../../../content/storage/indexeddb/provider";
import { contentEntryDigest } from "../../../content/library";
import { entry, project } from "../../compiler/__tests__/fixtures";
import { stageFor } from "../../../../server/site-project-local/__tests__/release-fixture";
import { reconcileActivatedPublication } from "../reconciliation";
describe("post-activation lifecycle reconciliation", () => {
  it("uses real Content generation/digest guards and leaves newer working values pending", async () => {
    const provider = createIndexedDbContentProvider({ idbFactory: new IDBFactory() }); await provider.initialization.initialize();
    await provider.store.putModel(project().providers.content[0]!.models[0]!); await provider.store.putEntry({ ...entry("a"), lifecycle: "draft" });
    const reviewed = (await provider.store.readAll()).entries[0]!;
    const stage = stageFor(project()); stage.publication = [{ ref: { providerId: provider.descriptor.id, modelId: reviewed.modelId, recordId: reviewed.id }, expectedGeneration: reviewed.generation, expectedDigest: contentEntryDigest(reviewed), lifecycle: "published" }];
    const active = { projectId: stage.projectId, revision: stage.revision, buildId: stage.buildId };
    await provider.store.putEntry({ ...reviewed, values: { ...reviewed.values, title: "Newer draft" } });
    expect(await reconcileActivatedPublication({ active, stage, stores: [provider.store], isActiveCurrent: async () => true })).toBe("changed");
    const current = (await provider.store.readAll()).entries[0]!; expect(current.lifecycle).toBe("draft"); expect(current.values.title).toBe("Newer draft");
    stage.publication[0] = { ...stage.publication[0]!, expectedGeneration: current.generation, expectedDigest: contentEntryDigest(current) };
    expect(await reconcileActivatedPublication({ active, stage, stores: [provider.store], isActiveCurrent: async () => false })).toBe("changed");
    expect(await reconcileActivatedPublication({ active, stage, stores: [provider.store], isActiveCurrent: async () => true })).toBe("applied");
    expect((await provider.store.readAll()).entries[0]).toMatchObject({ lifecycle: "published", values: { title: "Newer draft" } });
  });
});
