import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build, normalizePath, type Plugin } from "vite";
import { APP_ROOT } from "../../plugins/roots.mjs";
import { APP_HTML_PATH } from "../../plugins/composer-app-html.mjs";
import { resolveComponentPack } from "../../plugins/component-pack.mjs";
import { resolveComposerModules } from "../../plugins/module-resolution.mjs";
import { DEMO_EDITOR_ENTRY, resolveDemoEditorConfig } from "../../vite.demo-editor.config";
import { serializeSiteProject } from "../../src/site-project/model/canonical";
import { DEMO_EDITOR_MANIFEST, sha256 } from "../../scripts/hosted-demo/artifact.mjs";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function webshop() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "demo-editor-host-")));
  directories.push(directory);
  const host = join(directory, "host");
  await mkdir(host);
  for (const name of ["package.json", "zudo-composer.config.ts", "components", "styles", "site-project.json", "cms/assets"]) {
    await cp(join(APP_ROOT, "packages/demo-webshop", name), join(host, name), { recursive: true });
  }
  await mkdir(join(host, "node_modules/@zudo-composer"), { recursive: true });
  await symlink(APP_ROOT, join(host, "node_modules/zudo-composer"), "dir");
  await symlink(join(APP_ROOT, "node_modules/preact"), join(host, "node_modules/preact"), "dir");
  await symlink(join(APP_ROOT, "node_modules/@zudo-composer/component-contract"), join(host, "node_modules/@zudo-composer/component-contract"), "dir");
  return host;
}

describe("per-host demo editor Vite config", () => {
  it("requires an explicit absolute, resolved host directory", async () => {
    await expect(resolveDemoEditorConfig(undefined as unknown as string)).rejects.toThrow(/explicit host directory/);
    await expect(resolveDemoEditorConfig("relative-host")).rejects.toThrow(/absolute resolved path/);
    await expect(resolveDemoEditorConfig(`${APP_ROOT}/..`)).rejects.toThrow(/absolute resolved path/);
  });

  it("rejects a project from another pack before building", async () => {
    const host = await webshop();
    await cp(join(APP_ROOT, "packages/demo-sample/site-project.json"), join(host, "site-project.json"));
    await expect(resolveDemoEditorConfig(host)).rejects.toThrow(/incompatible with demo-webshop\/components/);
  });

  it.each([false, true])("builds the webshop self-reference and selected seed/styles with host HTML present: %s", async (withHostHtml) => {
    const host = await webshop();
    const hostHtml = '<!doctype html><title>Host-owned HTML</title><script type="module" src="/missing-host-entry.ts"></script>';
    if (withHostHtml) {
      await writeFile(join(host, "index.html"), hostHtml);
      await cp(join(host, "styles/base.css"), join(host, "styles/editor.css"));
      await rm(join(host, "styles/base.css"));
      await writeFile(join(host, "zudo-composer.config.ts"), 'import { defineComposerConfig } from "zudo-composer/config"; export default defineComposerConfig({ pack: "demo-webshop/components", styles: "styles/editor.css" });');
    }
    const hostConfig = 'throw new Error("The host Vite config must not run");';
    await writeFile(join(host, "vite.config.ts"), hostConfig);
    await mkdir(join(host, "dist-editor"));
    await writeFile(join(host, "dist-editor/stale.txt"), "stale editor output");
    await mkdir(join(host, "dist-site"));
    await writeFile(join(host, "dist-site/keep.txt"), "independent site artifact");
    await mkdir(join(host, "public/uploaded-assets"), { recursive: true });
    await writeFile(join(host, "public/uploaded-assets/private.txt"), "MUST NOT SHIP");

    // Local dev overrides must not steer the selected editor into the dogfood
    // stylesheet or store. The host's config alone supplies those paths.
    vi.stubEnv("ZUDO_COMPOSER_STYLES", "missing-root-styles.css");
    vi.stubEnv("ZUDO_ASSETS_STORE_ROOT", join(APP_ROOT, "cms/assets"));
    const config = await resolveDemoEditorConfig(host);
    expect(config.configFile).toBe(false);
    expect(config.root).toBe(host);
    expect(config.resolve).toEqual(resolveComposerModules());
    expect(config.build?.outDir).toBe(join(host, "dist-editor"));
    expect(config.build?.rollupOptions?.input).toBe(APP_HTML_PATH);
    expect(config.optimizeDeps?.exclude).toContain("demo-webshop");
    expect(config.server?.fs?.allow).toContain(host);
    const identity = resolveComponentPack(host, "demo-webshop/components");
    expect(identity.packageRoot).toBe(host);
    expect(identity.entryPath).toBe(join(host, "components/pack.ts"));
    const plugins = config.plugins ?? [];
    const editor = plugins.find((plugin): plugin is Plugin => Boolean(plugin && typeof plugin === "object" && "name" in plugin && plugin.name === "explicit-demo-editor"));
    if (!editor?.resolveId) throw new Error("Missing demo editor HTML resolver");
    const resolveId = typeof editor.resolveId === "function" ? editor.resolveId : editor.resolveId.handler;
    expect(Reflect.apply(resolveId, undefined, [APP_HTML_PATH, undefined, { isEntry: false }])).toBeUndefined();
    expect(Reflect.apply(resolveId, undefined, [join(host, "other.html"), undefined, { isEntry: true }])).toBeUndefined();

    // Real Vite HTML, CSS and module graph with a bounded entry. The four full
    // editor builds separately cover the entire app, while this proves the
    // host package's self-reference without a node_modules/demo-webshop link.
    await build({
      ...config,
      logLevel: "silent",
      plugins: [{
        name: "bounded-demo-editor-entry",
        enforce: "pre",
        load(id) {
          if (normalizePath(id) === normalizePath(resolve(APP_ROOT, DEMO_EDITOR_ENTRY))) return `
            import { componentPack } from "virtual:zudo-composer-pack";
            import { project } from "virtual:demo-editor-project";
            import { assets } from "virtual:hosted-demo-seed";
            import "virtual:zudo-composer-host-styles";
            globalThis.demoEditorProof = { pack: componentPack.manifest, project, assets };
          `;
        },
      }, ...plugins],
    });

    const output = join(host, "dist-editor");
    const manifest = JSON.parse(await readFile(join(output, DEMO_EDITOR_MANIFEST), "utf8"));
    const project = JSON.parse(await readFile(join(host, "site-project.json"), "utf8"));
    expect(manifest.projectSourceRevision).toBe(sha256(serializeSiteProject(project)));
    expect(manifest.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
    expect(manifest.files).toHaveProperty("index.html");
    expect(manifest.files).toHaveProperty("hosted-demo-assets-worker.js");
    expect(manifest.files).not.toHaveProperty("stale.txt");
    expect(manifest.files).not.toHaveProperty("uploaded-assets/private.txt");
    const html = await readFile(join(output, "index.html"), "utf8");
    expect(html).not.toContain("Host-owned HTML");
    expect(html).not.toContain("/@fs");
    const names = await readdir(join(output, "assets"));
    const js = (await Promise.all(names.filter((name) => name.endsWith(".js")).map((name) => readFile(join(output, "assets", name), "utf8")))).join("\n");
    const css = (await Promise.all(names.filter((name) => name.endsWith(".css")).map((name) => readFile(join(output, "assets", name), "utf8")))).join("\n");
    expect(js).toContain("demo-webshop");
    expect(js).toContain("shop.product-card");
    expect(js).toContain("shop-hero.webp");
    expect(js).not.toContain("sample-studio-site");
    expect(js).not.toContain("demo-sunrise.png");
    expect(css).toContain("--shop-palette-gray-0");
    expect(await readFile(join(host, "dist-site/keep.txt"), "utf8")).toBe("independent site artifact");
    expect(await readFile(join(host, "vite.config.ts"), "utf8")).toBe(hostConfig);
    if (withHostHtml) expect(await readFile(join(host, "index.html"), "utf8")).toBe(hostHtml);
    else await expect(readFile(join(host, "index.html"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
