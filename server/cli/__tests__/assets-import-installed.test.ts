import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import type { Connect, Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hookHandler, httpRequest, httpResponse, strictFixture } from "../../../plugins/__tests__/test-helpers";
import { APP_ROOT } from "../../../plugins/roots.mjs";
import { createFilesystemAssetStore } from "../../../src/assets/storage/filesystem/store";
import { resolveComposerDevConfig } from "../../dev-server.mjs";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function installedHost() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "asset-import-install-")));
  roots.push(root);
  const host = join(root, "host with spaces");
  const tool = join(host, "node_modules/zudo-composer");
  await mkdir(tool, { recursive: true });
  // Exercise TypeScript below node_modules, with no tool scripts or fixture bytes.
  // Dependency reuse keeps this bounded; the manager owns the packed-install gate.
  for (const name of ["package.json", "bin", "server", "plugins", "src"]) {
    await cp(join(APP_ROOT, name), join(tool, name), { recursive: true,
      filter: (path) => !relative(APP_ROOT, path).split(sep).some((part) => ["node_modules", "__tests__", "type-tests"].includes(part)),
    });
  }
  await symlink(join(APP_ROOT, "node_modules"), join(tool, "node_modules"), "dir");
  await mkdir(join(host, "node_modules/@zudo-composer"));
  await symlink(join(APP_ROOT, "node_modules/@zudo-composer/fixture-themeset"), join(host, "node_modules/@zudo-composer/fixture-themeset"), "dir");
  await writeFile(join(host, "package.json"), JSON.stringify({ name: "asset-import-host", type: "module" }));
  await mkdir(join(host, "images-src/nested"), { recursive: true });
  await copyFile(join(APP_ROOT, "scripts/demo-assets/demo-sunrise.png"), join(host, "images-src/nested/photo.png"));
  await writeFile(join(host, "images-src/manifest.json"), JSON.stringify([{ file: "nested/photo.png", alt: "Host-owned source", use: "hero", aspect: "3:2" }]));
  return { root, host, tool };
}

function invoke(bin: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input = "") {
  return new Promise<{ status: number; stdout: string; stderr: string }>((settle) => {
    const child = execFile(process.execPath, [bin, "assets", "import", ...args], { cwd, env, encoding: "utf8", timeout: 25_000 }, (error, stdout, stderr) => {
      settle({ status: error ? typeof error.code === "number" ? error.code : 1 : 0, stdout, stderr });
    });
    child.stdin?.on("error", () => { /* The exit result reports a failed child. */ });
    child.stdin?.end(input);
  });
}

async function devAssetRedirect(workspaceRoot: string, env: NodeJS.ProcessEnv, assetId: string) {
  const { composerConfig, inlineConfig } = await resolveComposerDevConfig({ workspaceRoot, env });
  const plugin = inlineConfig.plugins?.find((value): value is Plugin => !!value && typeof value === "object"
    && "name" in value && value.name === "composer-file-provider");
  if (!plugin) throw new Error("The authoring dev config did not register its file provider.");
  const middlewares: Connect.NextHandleFunction[] = [];
  hookHandler(plugin.configResolved).call(strictFixture({}), strictFixture<ResolvedConfig>({ command: "serve" }));
  // Drive the real configured plugin against its real store, without binding a port.
  await hookHandler(plugin.configureServer).call(strictFixture({}), strictFixture<ViteDevServer>({
    ssrLoadModule: async () => ({ createFilesystemAssetStore }),
    middlewares: strictFixture<ViteDevServer["middlewares"]>({ use: vi.fn().mockImplementation((middleware: Connect.NextHandleFunction) => { middlewares.push(middleware); }) }),
  }));
  const request = Object.assign(httpRequest(), { method: "GET", url: `/uploaded-assets/asset-${assetId}` });
  const response = httpResponse();
  let index = 0;
  const next = async (): Promise<void> => { await middlewares[index++]?.(request, response, next); };
  await next();
  return { composerConfig, response };
}

describe("installed assets import", () => {
  it.each([
    { settings: { dataDir: "content-store" }, assetDirectory: "content-store/assets" },
    { settings: { dataDir: "content-store", assetsDir: "library/files" }, assetDirectory: "library/files" },
  ])("uses resolved host config $assetDirectory for positional import, JSON reruns and dev reads", async ({ settings, assetDirectory }) => {
    const { root, host, tool } = await installedHost();
    const bin = join(tool, "bin/zudo-composer.mjs");
    await writeFile(join(host, "zudo-composer.config.ts"), `import { defineComposerConfig } from "zudo-composer/config";\nexport default defineComposerConfig(${JSON.stringify({ pack: "@zudo-composer/fixture-themeset/composer-pack", ...settings })});\n`);
    const obsoleteStore = join(root, "wrong-legacy-store");
    const env: NodeJS.ProcessEnv = { ...process.env, ZUDO_ASSETS_STORE_ROOT: obsoleteStore, ZUDO_COMPOSER_DATA_DIR: "wrong-env-data" };
    delete env.ZUDO_COMPOSER_ASSETS_DIR;
    const first = await invoke(bin, ["images-src/manifest.json", "--root", relative(root, host)], root, env);
    expect(first).toEqual({ status: 0, stdout: '{"ok":true,"result":{"added":1,"skipped":0}}\n', stderr: "" });
    const assetRoot = join(host, assetDirectory);
    const store = await createFilesystemAssetStore({ assetsStoreRoot: assetRoot });
    const [record] = (await store.snapshot()).records;
    expect(record.document.fileName).toBe("photo.png");
    expect(record.document.note).toBe("Host-owned source");
    const catalog = await readFile(join(assetRoot, "catalog.json"), "utf8");
    const files = await readdir(join(assetRoot, "versions"));
    expect(await invoke(bin, [], host, env, '{"manifest":"images-src/manifest.json"}\n'))
      .toEqual({ status: 0, stdout: '{"ok":true,"result":{"added":0,"skipped":1}}\n', stderr: "" });
    expect(await readFile(join(assetRoot, "catalog.json"), "utf8")).toBe(catalog);
    expect(await readdir(join(assetRoot, "versions"))).toEqual(files);
    const dev = await devAssetRedirect(host, env, record.id);
    expect(dev.composerConfig.paths.assets).toBe(assetRoot);
    expect(dev.response.statusCode).toBe(307);
    expect(dev.response.headers.location).toBe(record.document.versions[0].url);
    for (const path of [join(host, "cms"), join(tool, "cms"), join(root, "cms"), obsoleteStore, join(host, "wrong-env-data")]) {
      await expect(readdir(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
    if (settings.assetsDir) await expect(readdir(join(host, "content-store/assets"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(join(tool, "scripts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns one canonical error for invalid stdin and a host configuration failure", async () => {
    const { host, tool } = await installedHost();
    const bin = join(tool, "bin/zudo-composer.mjs");
    const env = { ...process.env };
    delete env.ZUDO_COMPOSER_PACK;
    const malformed = await invoke(bin, [], host, env, "{}\n{}");
    expect(malformed.status).toBe(2);
    expect(JSON.parse(malformed.stdout)).toMatchObject({ ok: false, error: { code: "malformed-request" } });
    expect(malformed.stderr).toBe("");
    const noConfig = await invoke(bin, ["images-src/manifest.json"], host, env);
    expect(noConfig.status).toBe(1);
    expect(noConfig.stdout).toBe('{"error":{"code":"internal","message":"The Assets import failed unexpectedly."},"ok":false}\n');
    expect(noConfig.stderr).toContain("`pack` is required");
    await expect(readdir(join(host, "cms"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
