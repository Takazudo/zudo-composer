import { describe, expect, it, vi } from "vitest";
import { componentCatalog, project } from "../../compiler/__tests__/fixtures";
import { captureSiteProjectAssetLock } from "../capture";
import { createProjectAssetUsageInspection } from "../usage";
import type { VersionedAssetStore } from "../../../assets/library";

describe("coherent project assets inspection", () => {
  it("coalesces reads and detects a changed exact project revision", async () => {
    const value = project();
    const readProject = vi.fn(async () => structuredClone(value));
    const inspection = createProjectAssetUsageInspection({ readProject, catalog: componentCatalog });
    const first = inspection.read(), second = inspection.read();
    expect(first).toBe(second);
    const result = await first;
    expect(result.index.complete).toBe(true);
    expect(readProject).toHaveBeenCalledTimes(2);
    expect(await inspection.isCurrent(result.revision)).toBe(true);
    value.providers.compositions[0]!.records[0]!.document.root[0]!.props.title = "Changed";
    expect(await inspection.isCurrent(result.revision)).toBe(false);
  });
  it("captures media-free projects without a provider and returns typed provider failure", async () => {
    expect(await captureSiteProjectAssetLock(project(), componentCatalog, undefined)).toMatchObject({ status: "ready", lock: undefined });
    const unavailable = { snapshot: async () => { throw new Error("Offline"); } } as unknown as VersionedAssetStore;
    expect(await captureSiteProjectAssetLock(project(), componentCatalog, unavailable)).toMatchObject({ status: "blocked", index: { complete: false }, diagnostics: [{ code: "unavailable", message: "Offline" }] });
  });
});
