import { describe, expect, it } from "vitest";
import { componentPackManifestSchema } from "@zudo-composer/component-contract";
import { activeComponentManifest, activeComponentRuntime } from "../../features/composer/active-pack";
import {
  ACTIVE_SITE_PROJECT_COMPONENT_PACK_REQUIREMENT,
  activeSiteProjectComponentManifest,
  activeSiteProjectValidationContext,
  serializeActiveSiteProjectComponentManifest,
} from "../site-project-manifest";

describe("active SiteProject component manifest seam", () => {
  it("is generated from and parser-verified against the pinned active provider", () => {
    expect(activeSiteProjectComponentManifest).toEqual(componentPackManifestSchema.parse(activeComponentManifest));
    expect(activeSiteProjectValidationContext.componentPack).toBe(activeSiteProjectComponentManifest);
    expect(ACTIVE_SITE_PROJECT_COMPONENT_PACK_REQUIREMENT).toEqual({
      contractVersion: activeComponentManifest.contractVersion,
      packId: activeComponentManifest.packId,
      packVersion: activeComponentManifest.packVersion,
    });
    expect(JSON.parse(serializeActiveSiteProjectComponentManifest())).toEqual(activeComponentManifest);
  });

  it("serializes manifest data only, never installed component runtime functions", () => {
    const serialized = serializeActiveSiteProjectComponentManifest();
    expect(serialized).not.toContain("runtime");
    expect(serialized).not.toContain(String(activeComponentRuntime.components[activeComponentManifest.components[0]!.id]?.component));
  });
});
