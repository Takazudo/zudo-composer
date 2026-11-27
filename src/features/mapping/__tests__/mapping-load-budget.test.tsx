import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../../App";
import { createProductionProviderIntegration } from "../../../app/provider-integration";
import { activeSiteProjectValidationContext } from "../../../app/site-project-manifest";
import { serializeSiteProject } from "../../../site-project/model/canonical";
import { loadSampleSiteProject } from "../../../test/site-project-fixture";
import { SAMPLE_ASSETS_STORE_ROOT } from "../../../test/sample-asset-lock";
import { createTemporaryWorkspaceProviders, type ObservedProviderRequest, type TemporaryWorkspaceProviders } from "../../../test/workspace-providers";
import { providerFixture } from "../../assets/__tests__/versioned-fixture";
import { notifyPersistenceChange } from "../../../shared/persistence-generation";

const hosts: TemporaryWorkspaceProviders[] = [];
afterEach(async () => { cleanup(); await Promise.all(hosts.splice(0).map((host) => host.dispose())); window.history.replaceState(null, "", "/"); });

function key({ endpoint, operation }: ObservedProviderRequest) { return `${endpoint}:${operation}`; }
function tally(requests: readonly ObservedProviderRequest[]) {
  const counts: Record<string, number> = {};
  for (const request of requests) counts[key(request)] = (counts[key(request)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
async function quiet(requests: readonly unknown[], ms = 150) {
  for (;;) { const before = requests.length; await new Promise((resolve) => setTimeout(resolve, ms)); if (requests.length === before) return; }
}

async function load(route: string, options: { notifyDuringCapture?: boolean } = {}) {
  const requests: ObservedProviderRequest[] = [];
  let armed = false, notified = false;
  const host = await createTemporaryWorkspaceProviders({ observe: (request) => {
    requests.push(request);
    // A persisted-change hint from another tab, landing inside the first capture window.
    if (armed && !notified && request.endpoint.includes("sitemapper") && request.operation === "snapshot") { notified = true; queueMicrotask(() => notifyPersistenceChange("workspace")); }
  } });
  hosts.push(host);
  const { provider } = await providerFixture({ seedFrom: SAMPLE_ASSETS_STORE_ROOT });
  const project = loadSampleSiteProject(activeSiteProjectValidationContext);
  project.collectionAttachments.push({ id: "cards", order: 0, composition: { providerId: "files", recordId: "home-page" }, target: { nodeId: "home-copy-stack", slotId: "content" }, mapping: { providerId: "mapping-filesystem", recordId: "journal-entry-mapping" } });
  const integration = createProductionProviderIntegration({ project, sourceRevision: createHash("sha256").update(serializeSiteProject(project)).digest("hex"), assetProvider: provider, createProviders: host.createProviders });
  await integration.initialization.initialize();
  await quiet(requests);
  requests.length = 0;
  armed = !!options.notifyDuringCapture;
  window.history.replaceState(null, "", route);
  render(<App integration={integration} />);
  return { requests, integration };
}

const CAPTURE_PASS = 3; // A workspace capture reads each domain token, value and token again.
function passes(counts: Record<string, number>) { return (counts["/__zudo_composer_sitemapper_provider:snapshot"] ?? 0) / CAPTURE_PASS; }

describe("Mapping load request budget (#994)", () => {
  it("loads the /mapping library with one attachment capture pass and no session churn", async () => {
    const { requests, integration } = await load("/mapping");
    const generation = integration.sessions.generation;
    await screen.findByRole("heading", { name: "Mappings" });
    await quiet(requests, 300);
    const counts = tally(requests);
    console.info(`[mapping-load-budget] library ${JSON.stringify(counts)}`);
    expect(passes(counts)).toBe(1);
    expect(integration.sessions.generation).toBe(generation);
  }, 60_000);
  it("opens a deep-linked Mapping after one attachment capture pass", async () => {
    const { requests } = await load("/mapping?provider=mapping-filesystem&mapping=journal-entry-mapping");
    await screen.findAllByText("Source fields", {}, { timeout: 20_000 });
    await quiet(requests, 300);
    const counts = tally(requests);
    console.info(`[mapping-load-budget] deep-link ${JSON.stringify(counts)}`);
    expect(passes(counts)).toBe(1);
  }, 60_000);
  it("re-reads once, not in retry rounds, when a persisted change lands mid-capture", async () => {
    const { requests } = await load("/mapping", { notifyDuringCapture: true });
    await screen.findByRole("heading", { name: "Mappings" });
    await waitFor(() => expect(requests.some(({ endpoint }) => endpoint.includes("sitemapper"))).toBe(true));
    await quiet(requests, 300);
    const counts = tally(requests);
    console.info(`[mapping-load-budget] mid-capture change ${JSON.stringify(counts)}`);
    // The stale pass completes, and exactly one fresh pass follows the change.
    expect(passes(counts)).toBe(2);
  }, 60_000);
});
