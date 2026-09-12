import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { build, normalizePath, type InlineConfig, type Plugin } from "vite";
import { APP_ROOT, SITE_BUILD_ENTRY, appModuleId } from "../../plugins/roots.mjs";
import { APP_HTML_PATH } from "../../plugins/composer-app-html.mjs";
import { resolveComposerModules } from "../../plugins/module-resolution.mjs";
import { resolveStaticSiteConfig } from "../site-build/vite-config";
import { runSiteBuild } from "../site-build/run.mjs";
import { verifySiteStaticArtifact } from "../site-build.mjs";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("static site Vite config", () => {
  it("rejects relative and unresolved root overrides before loading a host", async () => {
    await expect(resolveStaticSiteConfig({ workspaceRoot: "relative-host" })).rejects.toThrow(/absolute resolved path/);
    await expect(resolveStaticSiteConfig({ workspaceRoot: `${APP_ROOT}/..` })).rejects.toThrow(/absolute resolved path/);
  });

  it("emits the configured public bytes and rewrites the shell to the shipped visitor entry", async () => {
    const root = resolve(import.meta.dirname, "../..");
    const host = join(root, "packages/demo-webshop");
    const publicAssets = await mkdtemp(join(host, "public/site-assets-test-"));
    directories.push(publicAssets);
    const assetsStoreRoot = await mkdtemp(join(tmpdir(), "site-config-assets-"));
    directories.push(assetsStoreRoot);
    await cp(join(host, "cms/assets"), assetsStoreRoot, { recursive: true });
    const bytes = Buffer.from([0x00, 0xff, 0x80, 0x0d, 0x0a]);
    const checksumName = `sha256-${createHash("sha256").update(bytes).digest("hex")}.png`;
    await mkdir(join(publicAssets, "nested"));
    await writeFile(join(publicAssets, "nested/logo.png"), bytes);
    await writeFile(join(publicAssets, checksumName), bytes);
    vi.stubEnv("ZUDO_COMPOSER_PUBLIC_ASSETS_DIR", relative(host, publicAssets));
    vi.stubEnv("ZUDO_ASSETS_STORE_ROOT", assetsStoreRoot);

    const config = await resolveStaticSiteConfig({ workspaceRoot: host });
    expect(config.configFile).toBe(false);
    expect(config.root).toBe(host);
    expect(config.base).toBe("/");
    expect(config.build?.rollupOptions?.input).toBe(APP_HTML_PATH);
    expect(config.resolve).toEqual(resolveComposerModules());
    const plugins = (await Promise.all(config.plugins ?? [])).flat();
    const site = plugins.find((plugin): plugin is Plugin => Boolean(plugin && typeof plugin === "object" && "name" in plugin && plugin.name === "explicit-site-static"));
    if (!site?.generateBundle || !site.transformIndexHtml) throw new Error("Missing static site build hooks.");

    const emitted: Array<{ type: string; fileName?: string; source?: string | Uint8Array }> = [];
    const generateBundle = typeof site.generateBundle === "function" ? site.generateBundle : site.generateBundle.handler;
    await Reflect.apply(generateBundle, { emitFile(file: typeof emitted[number]) { emitted.push(file); return file.fileName; } }, [{}, {}, false]);
    expect(emitted.find(({ fileName }) => fileName === "uploaded-assets/nested/logo.png")?.source).toEqual(bytes);
    expect(emitted.find(({ fileName }) => fileName === `uploaded-assets/${checksumName}`)?.source).toEqual(bytes);
    expect(emitted.find(({ fileName }) => fileName === "_headers")?.source).toContain(`/uploaded-assets/${checksumName}\n  Content-Type: image/png`);

    const transformIndexHtml = typeof site.transformIndexHtml === "function" ? site.transformIndexHtml : site.transformIndexHtml.handler;
    const html = await Reflect.apply(transformIndexHtml, undefined, [await readFile(join(root, "index.html"), "utf8"), {}]);
    expect(html).toContain(`src=${JSON.stringify(appModuleId(SITE_BUILD_ENTRY))}`);
  });

  it("builds the tool shell at index.html without reading or changing an external host's HTML or Vite config", async () => {
    const temporary = await realpath(await mkdtemp(join(tmpdir(), "site-config-host-")));
    directories.push(temporary);
    const host = join(temporary, "host");
    const linkedHost = join(temporary, "linked-host");
    const demo = join(APP_ROOT, "packages/demo-webshop");
    await mkdir(host);
    for (const name of ["package.json", "zudo-composer.config.ts", "components", "styles", "site-project.json", "cms/assets"]) {
      await cp(join(demo, name), join(host, name), { recursive: true });
    }
    await mkdir(join(host, "node_modules/@zudo-composer"), { recursive: true });
    await symlink(APP_ROOT, join(host, "node_modules/zudo-composer"), "dir");
    await symlink(join(APP_ROOT, "node_modules/preact"), join(host, "node_modules/preact"), "dir");
    await symlink(join(APP_ROOT, "node_modules/@zudo-composer/component-contract"), join(host, "node_modules/@zudo-composer/component-contract"), "dir");
    await symlink(host, linkedHost, "dir");
    const hostHtml = '<!doctype html><title>Host-owned HTML</title><script type="module" src="/host-only-missing.ts"></script>';
    const hostConfig = 'throw new Error("The host Vite config must not run");';
    await writeFile(join(host, "index.html"), hostHtml);
    await writeFile(join(host, "vite.config.ts"), hostConfig);
    await mkdir(join(host, "dist-site"));
    await writeFile(join(host, "dist-site/stale.txt"), "stale build");
    // The retired environment hop must have no authority over an explicit root.
    vi.stubEnv("ZUDO_HOST_ROOT", join(temporary, "wrong-host"));
    const buildProof = async (config: InlineConfig) => {
      expect(config.root).toBe(host);
      expect(config.build?.outDir).toBe(join(host, "dist-site"));
      expect(config.build?.rollupOptions?.input).toBe(APP_HTML_PATH);
      const site = config.plugins?.find((plugin): plugin is Plugin => Boolean(plugin && typeof plugin === "object" && "name" in plugin && plugin.name === "explicit-site-static"));
      if (!site?.resolveId) throw new Error("The static builder must own its HTML input.");
      const resolveId = typeof site.resolveId === "function" ? site.resolveId : site.resolveId.handler;
      expect(Reflect.apply(resolveId, undefined, [join(host, "other.html"), undefined, { isEntry: true }])).toBeUndefined();
      expect(Reflect.apply(resolveId, undefined, [APP_HTML_PATH, undefined, { isEntry: false }])).toBeUndefined();
      // Exercise the real HTML/output pipeline and shipped config evaluator
      // with a tiny visitor body. Full demo graphs are covered by build lanes.
      return build({
        ...config,
        logLevel: "silent",
        plugins: [{
          name: "bounded-static-visitor-proof",
          enforce: "pre",
          load(id) {
            if (normalizePath(id) === normalizePath(resolve(APP_ROOT, SITE_BUILD_ENTRY))) return `
              import "virtual:zudo-composer-host-styles";
              import "./styles.css";
              document.getElementById("app").textContent = "Package visitor";
            `;
          },
        }, ...config.plugins ?? []],
      });
    };
    const manifest = await runSiteBuild({ workspaceRoot: linkedHost }, { build: buildProof });
    expect(manifest.projectId).toBe("demo-webshop");
    expect(manifest.routes).toHaveLength(21);
    expect(manifest.files).toHaveProperty("index.html");
    expect(Object.keys(manifest.files).every((name) => !name.startsWith(".") && !name.startsWith("node_modules/"))).toBe(true);
    expect(manifest.files).not.toHaveProperty("stale.txt");
    expect(await readFile(join(host, "index.html"), "utf8")).toBe(hostHtml);
    expect(await readFile(join(host, "vite.config.ts"), "utf8")).toBe(hostConfig);
    const builtHtml = await readFile(join(host, "dist-site/index.html"), "utf8");
    expect(builtHtml).not.toContain("Host-owned HTML");
    expect(builtHtml).not.toContain("host-only-missing");
    expect(builtHtml).not.toContain("/@fs");
    expect(builtHtml).toContain('src="/assets/');
    expect(builtHtml).toContain('rel="stylesheet"');
    const stylesheet = Object.keys(manifest.files).find((name) => name.endsWith(".css"));
    expect(stylesheet).toBeDefined();
    const css = await readFile(join(host, "dist-site", stylesheet!), "utf8");
    expect(css).toContain("--shop-palette-gray-0");
    expect(css).toContain(".site-root__skip");
    expect(await verifySiteStaticArtifact({ directory: join(host, "dist-site") })).toEqual(manifest);
  });
});
