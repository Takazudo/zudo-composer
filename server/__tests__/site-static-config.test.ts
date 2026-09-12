import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plugin } from "vite";
import siteStaticConfig from "../../vite.site-static.config";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("static site Vite config", () => {
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
    vi.stubEnv("ZUDO_HOST_ROOT", host);
    vi.stubEnv("ZUDO_COMPOSER_PUBLIC_ASSETS_DIR", relative(host, publicAssets));
    vi.stubEnv("ZUDO_ASSETS_STORE_ROOT", assetsStoreRoot);

    if (typeof siteStaticConfig !== "function") throw new Error("The static config must load its host at build time.");
    const config = await siteStaticConfig({ command: "build", mode: "production" });
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
    expect(html).toContain('src="/server/site-build/client/main.tsx"');
  });
});
