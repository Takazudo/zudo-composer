import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { readAssetUrls } from "zudo-composer/authoring";
import { loadHostContext } from "zudo-composer/vite";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const execute = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function importAssets(host: string, manifestPath = "images-src/manifest.json"): Promise<{ added: number; skipped: number }> {
  const bin = join(host, "node_modules/zudo-composer/bin/zudo-composer.mjs");
  try {
    const result = await execute(process.execPath, [bin, "assets", "import", manifestPath], { cwd: host, encoding: "utf8", timeout: 25_000 });
    const response = JSON.parse(result.stdout) as { ok?: boolean; result?: { added: number; skipped: number } };
    if (response.ok !== true || !response.result) throw new Error("The assets CLI did not return import counts.");
    return response.result;
  } catch (error: unknown) {
    const failure = error as { code?: unknown; stderr?: unknown; stdout?: unknown; message?: string };
    if (failure.code !== undefined) {
      throw new Error(`assets import exited ${String(failure.code)}: ${String(failure.stderr || failure.stdout || failure.message || "")}`, { cause: error });
    }
    throw error;
  }
}

async function hostFixture(settings: { dataDir?: string; assetsDir?: string }, manifestPath: string) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "host-authoring-")));
  roots.push(root);
  const host = join(root, "host with spaces");
  const modules = join(host, "node_modules");
  await mkdir(join(modules, "@zudo-composer"), { recursive: true });
  await symlink(repositoryRoot, join(modules, "zudo-composer"), "dir");
  await symlink(join(repositoryRoot, "node_modules/preact"), join(modules, "preact"), "dir");
  await symlink(join(repositoryRoot, "packages/component-contract"), join(modules, "@zudo-composer/component-contract"), "dir");
  await writeFile(join(host, "package.json"), JSON.stringify({ name: "authoring-host", type: "module", exports: { "./components": "./components.tsx" } }));
  // A bare tsx register() would honor this React setting and fail without React.
  await writeFile(join(host, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" } }));
  await writeFile(join(host, "zudo-composer.config.ts"), `import { defineComposerConfig } from "zudo-composer/config";
export default defineComposerConfig(${JSON.stringify({ pack: "authoring-host/components", publicAssetsDir: "published/uploads", ...settings })});
`);
  await writeFile(join(host, "components.tsx"), `import { defineComponent, defineComponentPack } from "@zudo-composer/component-contract";
const specimen = <span>Preact</span>;
if (specimen.type !== "span") throw new Error("The JSX runtime did not evaluate the pack.");
export const Title = ({ title }: { title: string }) => <h1>{title}</h1>;
export const componentPack = defineComponentPack({ packId: "authoring-host", packVersion: "1.0.0", components: [
  defineComponent<{ title: string }>()(Title, { id: "host.title", schemaVersion: 1, title: "Title", category: "Content", description: "",
    source: { module: "authoring-host/components", exportKind: "named", exportName: "Title" }, defaults: { title: "Hello" },
    fields: [{ prop: "title", label: "Title", schema: { type: "string" }, editor: { kind: "text" } }],
  }),
] });
`);
  const sourceRoot = dirname(join(host, manifestPath));
  await mkdir(join(sourceRoot, "nested"), { recursive: true });
  await writeFile(join(sourceRoot, "nested/example.txt"), "Authoring source bytes\n");
  await writeFile(join(host, manifestPath), JSON.stringify([{ file: "nested/example.txt", alt: "Configured source" }]));
  return { root, host };
}

describe("host authoring through public entries", () => {
  it.each([
    { settings: { dataDir: "content-store" }, assetsDirectory: "content-store/assets", manifestPath: "images-src/manifest.json" },
    { settings: { dataDir: "content-store", assetsDir: "media/library" }, assetsDirectory: "media/library", manifestPath: "source-images/seed.json" },
  ])("uses $assetsDirectory for importing, lookup, and byte-stable JSX generation", async ({ settings, assetsDirectory, manifestPath }) => {
    const { host } = await hostFixture(settings, manifestPath);
    const defaultManifest = manifestPath === "images-src/manifest.json" ? undefined : manifestPath;
    expect(await importAssets(host, defaultManifest)).toEqual({ added: 1, skipped: 0 });
    const catalogPath = join(host, assetsDirectory, "catalog.json");
    const before = await readFile(catalogPath, "utf8");
    expect(await importAssets(host, defaultManifest)).toEqual({ added: 0, skipped: 1 });
    expect(await readFile(catalogPath, "utf8")).toBe(before);
    const { composerConfig } = await loadHostContext({ workspaceRoot: host });
    expect(composerConfig.paths.assets).toBe(join(host, assetsDirectory));
    const urls = readAssetUrls(composerConfig);
    expect(Object.keys(urls)).toEqual(["example.txt"]);
    expect(urls["example.txt"]).toMatch(/^\/uploaded-assets\/asset-/u);
    for (const directory of ["cms", "published", ...(settings.assetsDir ? ["content-store/assets"] : [])]) {
      await expect(readdir(join(host, directory))).rejects.toMatchObject({ code: "ENOENT" });
    }
    if (defaultManifest !== undefined) await expect(readdir(join(host, "images-src"))).rejects.toMatchObject({ code: "ENOENT" });

    await writeFile(join(host, "site-project.ts"), `import { defineSite, node, readAssetUrls } from "zudo-composer/authoring";
import type { Site } from "zudo-composer/site-project";
import { loadHostContext } from "zudo-composer/vite";
import { componentPack } from "./components";
const { composerConfig } = await loadHostContext({ workspaceRoot: import.meta.dirname });
const urls = readAssetUrls(composerConfig);
const site: Site = defineSite({ id: "public-host", name: "Public host", componentPack });
const home = site.page({ name: "Home", root: [node("host.title", { title: urls["example.txt"] })] });
site.sitemap({ name: "Routes", root: { title: "Home", page: home } });
export default site;
`);
    const bin = join(host, "node_modules/zudo-composer/bin/zudo-composer.mjs");
    const generated = await execute(process.execPath, [bin, "generate"], { cwd: host, timeout: 25_000 });
    expect(generated.stdout).toContain("Wrote");
    expect(generated.stderr).toBe("");
    const first = await readFile(join(host, "site-project.json"));
    const rerun = await execute(process.execPath, [bin, "generate"], { cwd: host, timeout: 25_000 });
    expect(rerun.stdout).toContain("Unchanged");
    expect(await readFile(join(host, "site-project.json"))).toEqual(first);
    const checked = await execute(process.execPath, [bin, "generate", "--check"], { cwd: host, timeout: 25_000 });
    expect(checked.stdout).toContain("Current");
    expect(checked.stderr).toBe("");
    await writeFile(join(host, "site-project.json"), "stale\n");
    await expect(execute(process.execPath, [bin, "generate", "--check"], { cwd: host, timeout: 25_000 }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringMatching(/site-project\.json.*stale/su) });
  });

  it("surfaces public importer rejection without creating an asset store", async () => {
    const { host } = await hostFixture({ assetsDir: "media/library" }, "images-src/manifest.json");
    await writeFile(join(host, "images-src/manifest.json"), JSON.stringify([{ file: "missing.txt" }]));
    await expect(importAssets(host)).rejects.toThrow(/assets import exited 2:.*not-found/su);
    await expect(readdir(join(host, "media"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
