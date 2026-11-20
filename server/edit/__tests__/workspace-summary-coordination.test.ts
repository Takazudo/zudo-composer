import { expect, it, vi } from "vitest";
import { createBrowserCoordinator } from "../browser-coordinator.mjs";
import { AUTHORING_READ_HEADER, retryAuthoringRead } from "../../../src/shared/authoring-read-retry";
import { createWorkspaceSummary, type WorkspaceSummaryIntegration } from "../../../src/app/workspace-summary";
import type { ComponentCatalog } from "../../../src/composer/model/types";
// This Node-only coordinator regression supplies its own stores. Avoid loading
// browser Vite adapters just to read their persistence channel constants.
vi.mock("../../../src/app/persistence-channels", () => ({ ASSET_PERSISTENCE_CHANNEL: "assets" }));
vi.mock("../../../src/composer/storage/file-provider", () => ({ COMPOSITION_FILE_PROVIDER_CHANNEL: "compositions:files" }));
vi.mock("../../../src/content/storage/file-provider", () => ({ CONTENT_FILE_PROVIDER_DOMAIN: "content" }));
vi.mock("../../../src/mapping/storage/file-provider", () => ({ MAPPING_FILE_PROVIDER_DOMAIN: "mapping" }));
vi.mock("../../../src/sitemapper/storage/file-provider", () => ({ SITEMAP_FILE_PROVIDER_DOMAIN: "sitemapper" }));
import { COMPOSITION_SCHEMA_VERSION } from "../../../src/composer/model/types";
const compositionRecord = (id: string) => ({ id, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", document: { schemaVersion: COMPOSITION_SCHEMA_VERSION, id, name: id, root: [] } });
function createFakeIntegration(): { integration: WorkspaceSummaryIntegration } {
  return { integration: {
    initialization: { initialize: async () => ({ status: "ready" }), retry: async () => ({ status: "ready" }) },
    componentProvider: { catalog: { pack: {} as ComponentCatalog["pack"], get: () => undefined, has: () => false, ids: () => [] } },
    compositionProviders: [{ descriptor: { id: "files", label: "Files" }, store: { list: async () => [] } }],
    contentProvider: { descriptor: { id: "content" }, store: { listModels: async () => [], scanEntries: async () => { throw new Error("unused"); } } },
    contentCatalog: { listModels: async () => ({ status: "listed", entries: [], failures: [] }), resolveModel: async () => ({ status: "not-found" }) },
    mappingCatalog: { list: async () => ({ status: "listed", entries: [], failures: [] }), resolve: async () => ({ status: "not-found" }) },
    mappingCompositionCatalog: { list: async () => ({ status: "listed", entries: [], failures: [] }), resolve: async () => ({ status: "not-found" }) },
    sitemapProvider: { store: { list: async () => [], get: async id => ({ status: "not-found", id }) } },
    assetProvider: undefined,
  } };
}
it("canonical summary completes across actual preview exclusion through the existing pure-read retry", async () => {
  const gate = createBrowserCoordinator({ challengeMs: 100 });
  const peer = { send: (message: { challenge: string; epoch: number }) => gate.answer("tab", peer, message.challenge, message.epoch, true), resume: () => {} };
  gate.bind("tab", peer);
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const preview = gate.run("tab", async () => { enter(); await waiting; });
  await entered;
  const { integration } = createFakeIntegration();
  const derive = vi.fn(async () => gate.provider("tab", 0, async () => []));
  integration.compositionProviders[0]!.store.list = derive;
  // This is the same late output continuation refusal observed in installed C;
  // the action itself is never admitted while preview owns the coordinator.
  await expect(derive()).rejects.toMatchObject({ code: "authoring-busy" });
  const attempt = vi.fn(async () => {
    try { return new Response(JSON.stringify({ ok: true, result: await gate.provider("tab", 0, async () => ({ mutationToken: "a".repeat(64), records: [compositionRecord("hero")] })) }), { status: 200 }); }
    catch (cause) { const error = cause as { code: string; message: string }; return new Response(JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }), { status: 409 }); }
  });
  integration.compositionProviders[0]!.store.snapshot = async () => {
    const response = await retryAuthoringRead("http://localhost/snapshot", { headers: { [AUTHORING_READ_HEADER]: "1" } }, attempt, { timeoutMs: 1000, delayMs: 1 });
    expect(response.status).toBe(200);
    return (await response.json()).result;
  };
  const summary = createWorkspaceSummary(integration);
  const counts = summary.counts();
  try { await vi.waitFor(() => expect(attempt).toHaveBeenCalled()); }
  finally { release(); await preview; }
  expect((await counts).compositions).toEqual({ status: "ok", value: { compositions: 1, patterns: 0, globalTemplates: 0 } });
  expect(attempt.mock.calls.length).toBeGreaterThan(1);
  expect(derive).toHaveBeenCalledTimes(1); // Only the deliberate before-fix reproduction.
});
