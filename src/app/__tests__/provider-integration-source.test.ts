import { afterEach, expect, it, vi } from "vitest";
import { createProductionProviderIntegration } from "../provider-integration";
import { createTemporaryWorkspaceProviders, type TemporaryWorkspaceProviders } from "../../test/workspace-providers";
import { loadSampleSiteProject } from "../../test/site-project-fixture";
import { activeSiteProjectValidationContext } from "../site-project-manifest";

const source = vi.hoisted(() => ({ status: "error", message: "Activated release toolchain does not match the current installed runtime." }));
vi.mock("virtual:site-project-source", async (importOriginal) => {
  const original = await importOriginal<typeof import("virtual:site-project-source")>();
  return {
    ...original,
    get default() { return source.status === "ready" ? original.default : null; },
    get deliverySource() { return source; },
  };
});

const hosts: TemporaryWorkspaceProviders[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.dispose()));
  source.status = "error";
});

async function host() {
  const value = await createTemporaryWorkspaceProviders();
  hosts.push(value);
  return value;
}

it("retains the activated source error in initialization and catalog diagnostics", async () => {
  const current = createProductionProviderIntegration({ createProviders: (await host()).createProviders });
  expect(await current.initialization.initialize()).toMatchObject({
    status: "error", error: { phase: "source", message: source.message },
  });
  expect(await current.contentCatalog.listModels()).toMatchObject({
    entries: [], failures: [expect.objectContaining({ reason: source.message })],
  });
});

it("keeps the missing activation diagnostic for a true no-active source", async () => {
  source.status = "no-active";
  const current = createProductionProviderIntegration({ createProviders: (await host()).createProviders });
  expect(await current.initialization.initialize()).toMatchObject({
    status: "error", error: { message: expect.stringContaining("No development SiteProject is activated.") },
  });
});

it("initializes the injected project when the source is ready", async () => {
  source.status = "ready";
  const current = createProductionProviderIntegration({ createProviders: (await host()).createProviders });
  expect(await current.initialization.initialize()).toEqual({ status: "ready" });
});

it("honors an explicit project despite an injected source error", async () => {
  const current = createProductionProviderIntegration({
    project: loadSampleSiteProject(activeSiteProjectValidationContext),
    sourceRevision: "0".repeat(64),
    createProviders: (await host()).createProviders,
  });
  expect(await current.initialization.initialize()).toEqual({ status: "ready" });
});
