import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { CONTENT_PROVIDERS, contentEntryDigest } from "../../../content/library";
import { createFilesystemContentStore } from "../../../content/storage/filesystem";
import { entry, project } from "../../compiler/__tests__/fixtures";
import { stageFor } from "../../../../server/site-project-local/__tests__/release-fixture";
import { reconcileActivatedPublication } from "../reconciliation";
const sandboxes: string[] = [];
afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function contentProvider() {
  const contentRoot = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-reconciliation-")));
  sandboxes.push(contentRoot);
  return { descriptor: CONTENT_PROVIDERS.filesystem, store: await createFilesystemContentStore({ contentRoot }) };
}

describe("post-activation lifecycle reconciliation", () => {
  it("uses real Content generation/digest guards and leaves newer working values pending", async () => {
    const provider = await contentProvider();
    await provider.store.putModel(project().providers.content[0]!.models[0]!); await provider.store.putEntry({ ...entry("a"), lifecycle: "draft" });
    const reviewed = (await provider.store.readAll()).entries[0]!;
    const stage = stageFor(project()); stage.publication = [{ ref: { providerId: provider.descriptor.id, modelId: reviewed.modelId, recordId: reviewed.id }, expectedGeneration: reviewed.generation, expectedDigest: contentEntryDigest(reviewed), lifecycle: "published" }];
    const active = { projectId: stage.projectId, revision: stage.revision, buildId: stage.buildId };
    await provider.store.putEntry({ ...reviewed, values: { ...reviewed.values, title: "Newer draft" } });
    expect(await reconcileActivatedPublication({ active, stage, stores: [provider.store], activationGeneration: 1, isActiveCurrent: async () => true })).toBe("changed");
    const current = (await provider.store.readAll()).entries[0]!; expect(current.lifecycle).toBe("draft"); expect(current.values.title).toBe("Newer draft");
    stage.publication[0] = { ...stage.publication[0]!, expectedGeneration: current.generation, expectedDigest: contentEntryDigest(current) };
    expect(await reconcileActivatedPublication({ active, stage, stores: [provider.store], activationGeneration: 2, isActiveCurrent: async () => false })).toBe("changed");
    expect(await reconcileActivatedPublication({ active, stage, stores: [provider.store], activationGeneration: 2, isActiveCurrent: async () => true })).toBe("applied");
    expect((await provider.store.readAll()).entries[0]).toMatchObject({ lifecycle: "published", values: { title: "Newer draft" } });
  });
});
