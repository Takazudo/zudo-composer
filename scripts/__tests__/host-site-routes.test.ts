// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { SiteProject } from "zudo-composer/site-project";
import { compileStaticSite, createSiteManifest, SITE_HEADERS, SITE_MANIFEST, siteHeaders } from "../../server/site-build.mjs";
import { loadHostContext } from "../../server/host-context.mjs";
import { authoringSiteRoutes, readVerifiedHostManifest } from "../host-site-routes.mjs";
import { AUTHORING_ROUTES, SPA_ROUTES } from "../routes.mjs";
import { HOSTED_SITE_ROUTES } from "../../packages/demo-studio/hosted-routes.mjs";

const root = resolve(import.meta.dirname, "../..");
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  await mkdir(join(root, ".artifacts"), { recursive: true });
  const host = await mkdtemp(join(root, ".artifacts/host-routes-"));
  temporary.push(host);
  const metadata = JSON.parse(await readFile(join(root, "packages/demo-studio/package.json"), "utf8"));
  await writeFile(join(host, "package.json"), JSON.stringify({ ...metadata, name: "route-proof" }));
  await writeFile(join(host, "zudo-composer.config.ts"), 'export default { pack: "@zudo-sg/ui/composer-pack" };');
  const project = JSON.parse(await readFile(join(root, "packages/demo-studio/site-project.json"), "utf8")) as SiteProject;
  const source = () => writeFile(join(host, "site-project.json"), JSON.stringify(project));
  await source();
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
  expect(new Set(authoringSiteRoutes(original.routes))).toEqual(new Set(HOSTED_SITE_ROUTES));
  expect(SPA_ROUTES).toEqual([...AUTHORING_ROUTES, ...HOSTED_SITE_ROUTES]);
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
  expect(HOSTED_SITE_ROUTES).not.toContain("/site/new-host-page");
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

it("wires disk-discovered preparation ahead of both browser lanes and keeps their builders outside the lanes", async () => {
  const workflow = await readFile(join(root, ".github/workflows/ci.yml"), "utf8");
  const prep = workflow.indexOf("- run: pnpm demo:build-sites");
  for (const lane of ["site-project", "demos"]) {
    expect(prep).toBeGreaterThan(0);
    expect(prep).toBeLessThan(workflow.indexOf(`- run: pnpm test:browser:${lane}\n`));
    const script = await readFile(join(root, `scripts/run-${lane === "demos" ? "demos" : "site-project"}-browser.mjs`), "utf8");
    expect(script).toContain("readVerifiedHostManifest");
    expect(script).not.toMatch(/\[.*["']build-site["']/);
  }
  expect(await readFile(join(root, "scripts/build-demo-sites.mjs"), "utf8")).toContain("discoverPackedHosts(root)");
});
