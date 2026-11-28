import { render, settle } from "../../../test/render";
import { describe, expect, it, vi } from "vitest";
import "../../composer/test-support/cleanup";
import type { VersionedAssetStore } from "../../../assets/library";
import type { ProductionProviderIntegration } from "../../../app/provider-integration";
import { activeComponentProvider } from "../../composer/active-pack";
import { testServices } from "../../sitemapper/test-support/services";
import { MappingApp } from "../mapping-app";
import { READY_BINDING, mappingRecord, openedHarness } from "./harness";

const stores = vi.hoisted(() => [] as unknown[]);
vi.mock("../../composer/preview/assets-snapshot", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../composer/preview/assets-snapshot")>();
  return {
    ...original,
    assetResolvedPreviewSnapshot: (...args: Parameters<typeof original.assetResolvedPreviewSnapshot>) => {
      stores.push(args[3]?.store);
      return original.assetResolvedPreviewSnapshot(...args);
    },
  };
});

describe("Mapping preview Assets", () => {
  // Without the workspace's Asset store a managed `/uploaded-assets/asset-…`
  // URL blocks the preview: "Managed URL requires an available Assets provider identity".
  it("hands the workspace's Asset store to the resolved Mapping preview", async () => {
    const workspace = await openedHarness(mappingRecord([READY_BINDING]));
    const store = { provider: { id: "assets-filesystem", label: "Project assets" } } as unknown as VersionedAssetStore;
    const integration = {
      workspace: { id: "workspace" },
      sessions: { register: () => ({ changed() {}, detach() {} }) },
      assetProvider: { store },
    } as unknown as ProductionProviderIntegration;
    render(
      <MappingApp
        provider={workspace.provider}
        contentCatalog={workspace.content}
        compositionCatalog={workspace.compositions}
        contentEntries={workspace.contentEntries}
        componentProvider={activeComponentProvider}
        controller={workspace.controller}
        location={{ pathname: "/mapping", search: "" }}
        navigate={vi.fn()}
        services={testServices({ integration })}
      />,
    );
    await settle();
    expect(stores.length).toBeGreaterThan(0);
    expect(stores.every((candidate) => candidate === store)).toBe(true);
  });
});
