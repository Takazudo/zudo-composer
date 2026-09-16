import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { ASSET_SCHEMA_VERSION, type AssetSnapshot } from "../../assets/model";
import { activeSiteProjectComponentManifest } from "../../app/site-project-manifest";
import { loadSampleSiteProject } from "../../test/site-project-fixture";

Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });

// A handoff always carries its own project and assets, so the bundled seed
// modules must never be read on that path. The test lane's `virtual:*`
// stubs (vitest.config.ts) stay `null`, which would crash validation or the
// bundled-fetch fallback and so doubles as a canary if that read returns.

const emptyAssetSnapshot: AssetSnapshot = { schemaVersion: ASSET_SCHEMA_VERSION, mutationToken: "0".repeat(64), records: [], folders: [] };

function mockServiceWorker() {
  const worker = { controller: {}, addEventListener: vi.fn(), register: vi.fn(async () => ({})) };
  Object.defineProperty(navigator, "serviceWorker", { value: worker, configurable: true });
  return worker;
}

describe("createHostedDemoIntegration", () => {
  const originalHash = window.location.hash;

  beforeEach(() => {
    mockServiceWorker();
  });

  afterEach(() => {
    window.location.hash = originalHash;
    vi.restoreAllMocks();
  });

  it("resolves a handed-off snapshot without installing ticket or click listeners", async () => {
    const project = loadSampleSiteProject({ componentPack: activeSiteProjectComponentManifest });
    const token = "handoff-token";
    window.location.hash = `demoPreview=${token}`;
    const opener = {
      postMessage: vi.fn((message: { type: string; token: string }) => {
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: window.location.origin,
              source: opener as unknown as Window,
              data: {
                type: "hosted-demo-preview-response",
                token: message.token,
                snapshot: { project, assets: { snapshot: emptyAssetSnapshot, bytes: {} } },
              },
            }),
          );
        });
      }),
    };
    Object.defineProperty(window, "opener", { value: opener, configurable: true });

    const windowListenerSpy = vi.spyOn(window, "addEventListener");
    const documentListenerSpy = vi.spyOn(document, "addEventListener");

    const { createHostedDemoIntegration } = await import("../bootstrap");
    const { integration, assets } = await createHostedDemoIntegration();

    expect(opener.postMessage).toHaveBeenCalledWith({ type: "hosted-demo-preview-request", token }, window.location.origin);
    const capture = await integration.captureWorkspace();
    expect(capture.status).toBe("ready");
    if (capture.status === "ready") expect(capture.project.name).toBe(project.name);
    expect(assets.exportSeed().snapshot.mutationToken).toBe(emptyAssetSnapshot.mutationToken);

    // Only the one-shot handoff receiver runs here; the frame-assets relay and
    // the preview-request ticket listener are installed by bootstrapHostedDemo.
    expect(windowListenerSpy.mock.calls.filter(([type]) => type === "message")).toHaveLength(1);
    expect(documentListenerSpy).not.toHaveBeenCalled();
  });
});
