import { describe, expect, it } from "vitest";
import { activeComponentProvider } from "../features/composer/active-pack";
import type { CompositionNode } from "../composer/model/types";
import { compileSiteProject } from "../site-project/compiler";
import { assetAuthoringUrl } from "../assets/model";
import type { SiteProject } from "../site-project/model/types";
import { loadSampleSiteProject } from "./site-project-fixture";
import { captureSampleAssetLock } from "./sample-asset-lock";

// A real record id from the committed packages/demo-sample/cms/assets/catalog.json.
const SEEDED_ASSET_ID = "assets-d69f531b-c600-45c5-a6bf-13d40a19b734";

function firstHrefNode(nodes: readonly CompositionNode[]): CompositionNode | undefined {
  for (const node of nodes) {
    if (typeof node.props.href === "string") return node;
    for (const slot of Object.values(node.slots)) {
      const found = firstHrefNode(slot);
      if (found) return found;
    }
  }
  return undefined;
}

/** Point one existing `href` at a managed Assets reference, the way authoring
 * would once Sample Studio uses real images (sub B5). */
function injectAssetReference(project: SiteProject, url: string): void {
  for (const provider of project.providers.compositions) {
    for (const record of provider.records) {
      const node = firstHrefNode(record.document.root);
      if (node) { node.props.href = url; return; }
    }
  }
  throw new Error("No composition node with an href prop was found to inject an Assets reference into.");
}

describe("Sample Studio Assets lock helper", () => {
  it("compiles an injected /uploaded-assets/asset-<id> reference under release policy without asset-impact-incomplete", async () => {
    const project = loadSampleSiteProject({ componentPack: activeComponentProvider.manifest });
    injectAssetReference(project, assetAuthoringUrl(SEEDED_ASSET_ID));

    const { lock } = await captureSampleAssetLock(project, activeComponentProvider.catalog);
    expect(lock?.pins.some((pin) => pin.assetId === SEEDED_ASSET_ID)).toBe(true);

    const compiled = await compileSiteProject(project, { componentCatalog: activeComponentProvider.catalog, assetLock: lock });
    if (compiled.status !== "ready") {
      expect(compiled.diagnostics.map(({ code }) => code)).not.toContain("asset-impact-incomplete");
      throw new Error(`Injected-asset compilation blocked: ${compiled.diagnostics.map(({ message }) => message).join(" ")}`);
    }
    expect(compiled.status).toBe("ready");
  });
});
