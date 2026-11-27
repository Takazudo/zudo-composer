import { describe, expect, it } from "vitest";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { loadSampleSiteProject } from "../../test/site-project-fixture";
import { createMappingAttachmentService } from "../mapping-attachment-service";
import { activeSiteProjectValidationContext } from "../site-project-manifest";
import type { WorkspaceRecord } from "../workspace-record";
import { providerFixture, PNG } from "../../features/assets/__tests__/versioned-fixture";
import { SAMPLE_ASSETS_STORE_ROOT } from "../../test/sample-asset-lock";
import type { VersionedAssetStore } from "../../assets/library";

// Each VersionedAssetStore method is one provider RPC in the browser file-provider client.
const PROVIDER_METHODS = ["snapshot", "mutationToken", "resolveVersion", "pinManifest", "get", "list"] as const;
type Counts = Record<(typeof PROVIDER_METHODS)[number], number>;

function counting(store: VersionedAssetStore): { store: VersionedAssetStore; counts: Counts; reset(): void } {
  const counts = Object.fromEntries(PROVIDER_METHODS.map((name) => [name, 0])) as Counts;
  const proxy = new Proxy(store, { get(target, property) {
    const value = Reflect.get(target, property);
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => { if ((PROVIDER_METHODS as readonly string[]).includes(property as string)) counts[property as keyof Counts]++; return (value as (...a: unknown[]) => unknown).apply(target, args); };
  } });
  return { store: proxy, counts, reset() { for (const name of PROVIDER_METHODS) counts[name] = 0; } };
}

async function measure(assetCount: number, options: { failBulk?: boolean } = {}) {
  const { provider, filesystem } = await providerFixture({ seedFrom: SAMPLE_ASSETS_STORE_ROOT });
  const project = loadSampleSiteProject(activeSiteProjectValidationContext);
  const source = project.providers.compositions[0]!.records.find(({ id }) => id === "journal-entry-page")!;
  delete source.document.binding;
  for (let index = 0; index < assetCount; index++) {
    const asset = await filesystem.upload({ fileName: `budget-${index}.png`, declaredMimeType: "image/png", bytes: Uint8Array.from([...PNG, index % 256, Math.floor(index / 256)]) });
    // Every asset is referenced twice so exact-reference deduplication is exercised.
    for (const copy of ["a", "b"]) source.document.root.push({ id: `budget-${index}-${copy}`, componentId: "ui.cta-button", componentVersion: 1, props: { href: `/uploaded-assets/asset-${asset.id}`, children: "Download" }, slots: {} });
  }
  project.collectionAttachments.push({ id: "cards", order: 0, composition: { providerId: "files", recordId: "home-page" }, target: { nodeId: "home-copy-stack", slotId: "content" }, mapping: { providerId: "mapping-filesystem", recordId: "journal-entry-mapping" } });
  const metadata = { id: "workspace", mutationToken: 0 } as WorkspaceRecord;
  const counter = counting(provider.store as unknown as VersionedAssetStore);
  const service = createMappingAttachmentService({ getCurrentSiteProject: async () => ({ status: "ready", project }), workspace: { metadata: async () => metadata, updateMetadata: async () => metadata }, componentCatalog: activeComponentProvider.catalog, assetStore: counter.store, subscribe: () => () => undefined });
  if (options.failBulk) (filesystem as { pinManifest: VersionedAssetStore["pinManifest"] }).pinManifest = async () => { throw new Error("Exact Assets version bytes are missing or corrupted."); };
  counter.reset();
  const snapshot = await service.list();
  return { counts: { ...counter.counts }, snapshot };
}

/**
 * Ceiling per attachment list() (one compileWithCapturedAsset), from the
 * required integrity boundaries, independent of the referenced asset count:
 * - exact capture: snapshot, one bulk pinManifest, mutationToken recheck (3)
 * - pre-compile current(): bulk integrity pinManifest + precondition snapshot (2)
 * - post-compile current(): bulk integrity pinManifest + precondition snapshot (2)
 * Before #995 each distinct asset added three resolveVersion RPCs.
 */
const LIST_RPC_CEILING = 7;
const total = (counts: Counts) => Object.values(counts).reduce((sum, value) => sum + value, 0);

describe("Mapping attachment asset verification request budget (#995)", () => {
  it("keeps provider verification RPCs constant for 0, 1, 16 and 64 added assets", async () => {
    // Sample Studio already pins 4 seeded images, so the cases reference 4 + n distinct assets.
    const results: Record<number, Counts> = {};
    for (const count of [0, 1, 16, 64]) results[count] = (await measure(count)).counts;
    console.info(`[mapping-asset-budget] ${JSON.stringify(results)}`);
    for (const counts of Object.values(results)) {
      expect(counts.resolveVersion).toBe(0);
      expect(counts.pinManifest).toBe(3);
      expect(total(counts)).toBe(LIST_RPC_CEILING);
    }
  }, 120_000);
  it("blocks on a failed bulk verification without falling back to per-asset reads", async () => {
    const { counts, snapshot } = await measure(16, { failBulk: true });
    expect(counts.resolveVersion).toBe(0);
    expect(counts.pinManifest).toBe(1);
    expect(JSON.stringify(snapshot)).toContain("asset-capture-blocked");
  }, 60_000);
});
