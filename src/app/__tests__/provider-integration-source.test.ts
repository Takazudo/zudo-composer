import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { siteProjectSourcePlugin, RESOLVED_SITE_PROJECT_SOURCE_ID } from "../../../plugins/site-project-source-plugin.mjs";
import { hookHandler, strictFixture } from "../../../plugins/__tests__/test-helpers";
import { composer } from "../../../server/config/config";
import { produceReadyWorkspace } from "../../../server/cli/ready-workspace";
import { readActivatedSiteRelease } from "../../../server/site-project-local/dev-reader";
import { toolchain } from "../../../server/site-project-local/__tests__/release-fixture";
import { componentPack } from "../../test/composer-pack";
import { createProductionProviderIntegration } from "../provider-integration";
import { createTemporaryWorkspaceProviders, type TemporaryWorkspaceProviders } from "../../test/workspace-providers";
import { loadSampleSiteProject } from "../../test/site-project-fixture";
import { activeSiteProjectValidationContext } from "../site-project-manifest";

const source = vi.hoisted(() => ({ status: "error", message: "Activated release toolchain does not match the current installed runtime." }));
const originalSource = { ...source };
vi.mock("virtual:site-project-source", async (importOriginal) => {
  const original = await importOriginal<typeof import("virtual:site-project-source")>();
  return {
    ...original,
    get default() { return source.status === "ready" ? original.default : null; },
    get siteProjectRevision() { return source.status === "ready" ? original.siteProjectRevision : null; },
    get deliverySource() { return source; },
  };
});

const hosts: TemporaryWorkspaceProviders[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.dispose()));
  Object.assign(source, originalSource);
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

it("opens generated committed CMS ready and populated when the real dev source is no-active", async () => {
  const currentHost = await host();
  const input = loadSampleSiteProject(activeSiteProjectValidationContext);
  const config = composer({ workspaceRoot: currentHost.root, pack: "@zudo-sg/ui/composer-pack" }, { env: {} });
  const generated = await produceReadyWorkspace(input, { config, pack: componentPack, toolchain: { ...toolchain, componentPack: input.componentPack } });
  const sourcePlugin = siteProjectSourcePlugin({
    workspaceRoot: currentHost.root,
    readDevRelease: () => readActivatedSiteRelease({ workspaceRoot: currentHost.root }),
  });
  const serialized = await hookHandler(sourcePlugin.load).call(strictFixture({}), RESOLVED_SITE_PROJECT_SOURCE_ID);
  if (typeof serialized !== "string") throw new Error("Expected the real dev-source module text.");
  expect(serialized).toContain('"status":"no-active"');
  expect(serialized).toContain("export const siteProject = null;");
  Object.assign(source, JSON.parse(serialized.split("\n")[0]!.slice("export const deliverySource = ".length, -1)));
  await expect(lstat(join(currentHost.root, ".zudo-site-project"))).rejects.toMatchObject({ code: "ENOENT" });

  // Normal dev open supplies neither a creation attempt nor an active project.
  const current = createProductionProviderIntegration({ createProviders: currentHost.createProviders, assetProvider: null });
  expect(await current.initialization.initialize()).toEqual({ status: "ready" });
  expect(await current.workspace.metadata()).toMatchObject({ id: generated.workspaceId, status: "ready", mutationToken: 1 });
  expect((await current.compositionProviders[0]!.store.list()).length).toBe(input.providers.compositions[0]!.records.length);
  expect((await current.contentProvider.store.listModels()).length).toBe(input.providers.content[0]!.models.length);
  const snapshot = await current.getCurrentSiteProject();
  const persisted = structuredClone(input);
  // The canonical Content writer stamps every newly seeded Entry with its
  // first store generation; publication uses the original values and times.
  for (const provider of persisted.providers.content) for (const entry of provider.entries) { entry.generation = 1; entry.lifecycle = "published"; }
  expect(snapshot).toEqual({ status: "ready", project: persisted });
  const creation = createProductionProviderIntegration({ creation: {}, createProviders: currentHost.createProviders, assetProvider: null });
  expect(await creation.initialization.initialize()).toMatchObject({ status: "error", error: { message: expect.stringContaining("already complete; open it explicitly") } });
  // No seed, repair, registry write, or source initialization happened on open.
  for (const file of generated.files) expect(createHash("sha256").update(await readFile(join(currentHost.root, file.path))).digest("hex")).toBe(file.digest);
  await expect(lstat(join(currentHost.root, ".zudo-site-project"))).rejects.toMatchObject({ code: "ENOENT" });
});
