import { contentEntryDigest, type ContentStore } from "../../content";
import type { SiteProjectActiveSelection, StagedRelease } from "./types";
import { sameRelease } from "./review";

/** Called after successful activation only. Stores own atomic generation+digest
 * matching; newer edits and deleted records remain untouched. This never copies
 * release values back over the mutable working project. */
export async function reconcileActivatedPublication(input: {
  active: SiteProjectActiveSelection; stage: StagedRelease; stores: readonly ContentStore[];
  activationGeneration: number;
  signal?: AbortSignal;
  isActiveCurrent(active: SiteProjectActiveSelection): Promise<boolean>;
}): Promise<"applied" | "changed"> {
  if (!sameRelease(input.active, { projectId: input.stage.projectId, revision: input.stage.revision, buildId: input.stage.buildId }) || !await input.isActiveCurrent(input.active)) return "changed";
  let changed = false;
  for (const providerId of [...new Set([...input.stores.map(({ provider }) => provider.id), ...input.stage.publication.map(({ ref }) => ref.providerId)])]) {
    const store = input.stores.find(({ provider }) => provider.id === providerId);
    if (!store || !await input.isActiveCurrent(input.active)) return "changed";
    const changes = input.stage.publication.filter(({ ref }) => ref.providerId === providerId);
    const before = await store.readAll();
    const matching = changes.filter((change) => before.entries.some((entry) => entry.id === change.ref.recordId && entry.modelId === change.ref.modelId && entry.generation === change.expectedGeneration && contentEntryDigest(entry) === change.expectedDigest));
    if (matching.length !== changes.length) changed = true;
    if (!await input.isActiveCurrent(input.active)) return "changed";
    const after = await store.reconcilePublication(matching, input.activationGeneration, input.signal);
    if (after.activationGeneration !== input.activationGeneration) changed = true;
    if (matching.some((change) => !after.entries.some((entry) => entry.id === change.ref.recordId && entry.modelId === change.ref.modelId && entry.lifecycle === change.lifecycle && contentEntryDigest(entry) === change.expectedDigest))) changed = true;
  }
  return changed || !await input.isActiveCurrent(input.active) ? "changed" : "applied";
}
