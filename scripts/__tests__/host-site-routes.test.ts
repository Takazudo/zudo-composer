// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";
import type { SiteProject } from "zudo-composer/site-project";
import { compileStaticSite, createSiteManifest, SITE_HEADERS, SITE_MANIFEST, siteHeaders } from "../../server/site-build.mjs";
import { loadHostContext } from "../../server/host-context.mjs";
import { authoringSiteRoutes, readVerifiedHostManifest } from "../host-site-routes.mjs";
import { DEMO_EDITOR_AUTHORING_ROUTES, demoEditorRoutes, verifiedDemoEditorRoutes } from "../routes.mjs";
import { createDemoEditorManifest, DEMO_EDITOR_MANIFEST, DEMO_EDITOR_SEED, verifyDemoEditorArtifact } from "../hosted-demo/artifact.mjs";
import { writeEditorArtifact } from "../hosted-demo/__fixtures__/editor-artifact";
import { TARGET_KEYS, TARGETS } from "../hosted-demo/targets.mjs";

const root = resolve(import.meta.dirname, "../..");
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  await mkdir(join(root, ".artifacts"), { recursive: true });
  const host = await mkdtemp(join(root, ".artifacts/host-routes-"));
  temporary.push(host);
  const metadata = JSON.parse(await readFile(join(root, "packages/demo-sample/package.json"), "utf8"));
  await writeFile(join(host, "package.json"), JSON.stringify({ ...metadata, name: "route-proof" }));
  await writeFile(join(host, "zudo-composer.config.ts"), 'export default { pack: "@zudo-sg/ui/composer-pack" };');
  const project = JSON.parse(await readFile(join(root, "packages/demo-sample/site-project.json"), "utf8")) as SiteProject;
  const source = () => writeFile(join(host, "site-project.json"), JSON.stringify(project));
  await source();
  await cp(join(root, "packages/demo-sample/cms/assets"), join(host, "cms/assets"), { recursive: true });
  const directory = join(host, "dist-site");
  await mkdir(directory);
  await writeFile(join(directory, "index.html"), '<!doctype html><div id="app"></div>');
  await writeFile(join(directory, SITE_HEADERS), siteHeaders([]));
  const build = async () => {
    const { pack } = await loadHostContext({ workspaceRoot: host, env: {} });
    const current = await compileStaticSite({ projectPath: join(host, "site-project.json"), pack, assetsStoreRoot: join(host, "cms/assets") });
    const manifest = await createSiteManifest({ directory, projectId: current.project.id, projectSourceRevision: current.projectSourceRevision, routes: current.build.routes.map(({ pathname }) => pathname) });
    await writeFile(join(directory, SITE_MANIFEST), JSON.stringify(manifest));
    return manifest;
  };
  return { host, directory, project, source, build };
}

it("takes added sitemap routes through the compiler and verified manifest without central route edits", async () => {
  const host = await fixture();
  await host.build();
  const original = await readVerifiedHostManifest(host.host, { env: {} });
  expect(demoEditorRoutes(original.routes)).toEqual([...DEMO_EDITOR_AUTHORING_ROUTES, ...authoringSiteRoutes(original.routes)]);
  const sitemap = host.project.providers.sitemaps[0].records[0].document;
  const extra = structuredClone(sitemap.root[0].children[1]);
  extra.id = "new-host-page";
  extra.slug = "new-host-page";
  extra.title = "New host page";
  sitemap.root[0].children.push(extra);
  await host.source();
  await expect(readVerifiedHostManifest(host.host, { env: {} })).rejects.toThrow("artifact is stale");
  await host.build();
  const updated = await readVerifiedHostManifest(host.host, { env: {} });
  expect(new Set(updated.routes)).toEqual(new Set([...original.routes, "/new-host-page"]));
  expect(updated.routes).toContain("/new-host-page");
  expect(updated.routes).toHaveLength(original.routes.length + 1);
  expect(authoringSiteRoutes(updated.routes)).toContain("/site/new-host-page");
  expect(authoringSiteRoutes(original.routes)).not.toContain("/site/new-host-page");
});

it("rejects a tampered route list, artifact bytes, project identity, tool identity and source revision", async () => {
  const host = await fixture();
  const manifest = await host.build();
  const write = (value: unknown) => writeFile(join(host.directory, SITE_MANIFEST), JSON.stringify(value));
  await write({ ...manifest, routes: [...manifest.routes, "/phantom"] });
  await expect(readVerifiedHostManifest(host.host, { env: {} })).rejects.toThrow("routes differ");
  await write({ ...manifest, projectId: "wrong-host" });
  await expect(readVerifiedHostManifest(host.host, { env: {} })).rejects.toThrow("different host project");
  await write({ ...manifest, tool: { name: "zudo-composer", version: "99.0.0" } });
  await expect(readVerifiedHostManifest(host.host, { env: {} })).rejects.toThrow("different installed tool identity");
  await write({ ...manifest, sourceRevision: "other-source" });
  await expect(readVerifiedHostManifest(host.host, { env: { GITHUB_SHA: "expected-source" } })).rejects.toThrow("sourceRevision does not match");
  await write(manifest);
  await writeFile(join(host.directory, "index.html"), "Changed artifact bytes");
  await expect(readVerifiedHostManifest(host.host, { env: {} })).rejects.toThrow("checksum");
});

it("wires disk-discovered preparation ahead of browser lanes and builds every editor host", async () => {
  const source = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
  const workflow = parse(source);
  const prep = source.indexOf("- run: pnpm demo:build-sites");
  for (const lane of ["site-project", "demos"]) {
    expect(prep).toBeGreaterThan(0);
    expect(prep).toBeLessThan(source.indexOf(`- run: pnpm test:browser:${lane}\n`));
    const script = await readFile(join(root, `scripts/run-${lane === "demos" ? "demos" : "site-project"}-browser.mjs`), "utf8");
    expect(script).toContain("readVerifiedHostManifest");
    expect(script).not.toMatch(/\[.*["']build-site["']/);
  }
  expect(await readFile(join(root, "scripts/build-demo-sites.mjs"), "utf8")).toContain("discoverPackedHosts(root)");
  const staticTargets = TARGET_KEYS.filter((key) => TARGETS[key].kind === "site-static");
  expect(workflow.jobs["demo-sites-build"].strategy.matrix.site).toEqual(staticTargets);
  const editorJob = workflow.jobs["demo-editors-build"];
  expect(editorJob.strategy["fail-fast"]).toBe(false);
  expect(editorJob.strategy.matrix.name).toEqual(staticTargets);
  expect(editorJob.steps.find((step: { run?: string }) => step.run?.includes("demo:build-editor")).run).toContain("${{ matrix.name }}");
  expect(editorJob.steps.find((step: { run?: string }) => step.run?.includes("test:browser:demo-editor")).run).toContain("${{ matrix.name }}");
  const editorTargets = TARGET_KEYS.filter((key) => TARGETS[key].kind === "demo-editor");
  expect(editorJob.strategy.matrix.include.map((entry: { target: string }) => entry.target)).toEqual(editorTargets);
});

it("recompiles editor routes from its own bundled project without a static-site manifest", async () => {
  const fixture = await writeEditorArtifact();
  temporary.push(fixture.root);
  const original = await verifyDemoEditorArtifact({ directory: fixture.root });
  expect(verifiedDemoEditorRoutes(original.manifest).slice(0, DEMO_EDITOR_AUTHORING_ROUTES.length)).toEqual(DEMO_EDITOR_AUTHORING_ROUTES);
  expect(original.manifest.routes).toContain("/site");
  const sitemap = fixture.seed.project.providers.sitemaps[0]!.records[0]!.document;
  const extra = structuredClone(sitemap.root[0]!.children[1]!);
  extra.id = "editor-added-page";
  extra.slug = "editor-added-page";
  extra.title = "Editor added page";
  sitemap.root[0]!.children.push(extra);
  await fixture.saveFile(DEMO_EDITOR_SEED, JSON.stringify(fixture.seed));
  // A stale manifest cannot supply routes after the bundled project changes.
  await expect(verifyDemoEditorArtifact({ directory: fixture.root })).rejects.toThrow("checksum");
  const updated = await createDemoEditorManifest({ directory: fixture.root, sourceRevision: fixture.manifest.sourceRevision });
  await writeFile(join(fixture.root, DEMO_EDITOR_MANIFEST), JSON.stringify(updated));
  const verified = await verifyDemoEditorArtifact({ directory: fixture.root });
  expect(verified.manifest.routes).toContain("/site/editor-added-page");
  expect(verified.manifest.routes).toHaveLength(original.manifest.routes.length + 1);
  expect(verified.manifest.projectSourceRevision).not.toBe(original.manifest.projectSourceRevision);
  expect(verifiedDemoEditorRoutes(verified.manifest)).toEqual(verified.manifest.routes);
});
