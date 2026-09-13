import { defineConfig, normalizePath, type InlineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import preact from "@preact/preset-vite";
import tailwindPlugin from "./plugins/tailwind-plugin.mjs";
import componentPackPlugin from "./plugins/component-pack-plugin.mjs";
import { loadComponentPack } from "./plugins/component-pack.mjs";
import hostStylesPlugin from "./plugins/host-styles-plugin.mjs";
import { APP_HTML_PATH, rewriteAppEntry } from "./plugins/composer-app-html.mjs";
import { APP_ROOT, resolveFsAllow, resolveWorkspaceRoot } from "./plugins/roots.mjs";
import { resolveComposerModules } from "./plugins/module-resolution.mjs";
import { loadHostConfig } from "./server/host-context.mjs";
import { createModuleEvaluator } from "./server/module-evaluator.mjs";
import { validateSiteProject } from "./src/site-project/model/validation";
import { prepareDemoAsset } from "./scripts/hosted-demo/prepare";
import { ASSET_AUTHORING_URL_PATTERN, ASSET_CHECKSUM_URL_SOURCE, ASSET_CONTENT_TYPE_BY_EXTENSION, ASSET_IMMUTABLE_CACHE_CONTROL, ASSET_KINDS, ASSET_NOSNIFF, hostedAssetHeaders } from "./src/assets/model/asset-kinds.mjs";
import { HOSTED_DEMO_HEADERS, DEMO_EDITOR_MANIFEST, DEMO_EDITOR_SEED, createDemoEditorManifest } from "./scripts/hosted-demo/artifact.mjs";
import type { DemoEditorSeed } from "./scripts/hosted-demo/seed";

export const DEMO_EDITOR_ENTRY = "src/hosted-demo/main.tsx";
const VIRTUAL_MODULES = ["virtual:demo-editor-project", "virtual:hosted-demo-seed", "virtual:composer-file-provider-config", "virtual:composer-domain-providers", "virtual:release-config", "virtual:site-project-source"];

/** The host owns module resolution, styles and data; the tool owns the HTML shell. */
export async function resolveDemoEditorConfig(hostDir: string): Promise<InlineConfig> {
  if (!hostDir) throw new Error("Demo editor builds require an explicit host directory.");
  const hostRoot = resolveWorkspaceRoot(hostDir);
  // Build only the selected host's committed configuration. Local dev-server
  // environment overrides must not redirect its assets or stylesheet elsewhere.
  const { paths, settings, configPath } = await loadHostConfig(hostRoot, {});
  const componentPack = componentPackPlugin({ workspaceRoot: hostRoot, pack: settings.pack });
  const { pack } = await loadComponentPack(hostRoot, settings.pack, createModuleEvaluator(hostRoot));
  const projectPath = resolve(hostRoot, "site-project.json");
  const validated = validateSiteProject(JSON.parse(await readFile(projectPath, "utf8")), { componentPack: pack.manifest });
  if (!validated.ok) throw new Error(`Demo editor project ${projectPath} is incompatible with ${settings.pack}:\n${validated.diagnostics.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`).join("\n")}`);
  const project = validated.project;
  const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: APP_ROOT, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error("A full source Git revision is required.");
  const seed = await prepareDemoAsset(paths.assets);
  const { name: hostId } = JSON.parse(await readFile(resolve(hostRoot, "package.json"), "utf8"));
  const bundledSeed: DemoEditorSeed = { hostId, project, componentPack: pack.manifest, assets: seed.snapshot };
  const outDir = resolve(hostRoot, "dist-editor");
  const htmlEntryId = normalizePath(resolve(hostRoot, "index.html"));

  const demo: Plugin = {
    name: "explicit-demo-editor",
    enforce: "pre",
    transformIndexHtml: { order: "pre", handler: (html) => rewriteAppEntry(html, DEMO_EDITOR_ENTRY).replace(/\s*<!--[\s\S]*?-->/g, "") },
    resolveId(id, _importer, { isEntry }) {
      // Vite emits HTML relative to root. Give the tool-owned shell a host-rooted
      // ID without requiring, reading or overwriting the host's index.html.
      if (isEntry && normalizePath(id) === normalizePath(APP_HTML_PATH)) return htmlEntryId;
      if (VIRTUAL_MODULES.includes(id)) return `\0${id}`;
    },
    load(id) {
      if (normalizePath(id) === htmlEntryId) return readFile(APP_HTML_PATH, "utf8");
      if (id === "\0virtual:demo-editor-project") return `export const project = ${JSON.stringify(project)};`;
      if (id === "\0virtual:hosted-demo-seed") return `export const assets = ${JSON.stringify(seed.snapshot)};`;
      if (id === "\0virtual:composer-file-provider-config") return "export const fileProviderConfig = undefined;";
      if (id === "\0virtual:composer-domain-providers") return "export const domainProviderConfig = undefined;";
      if (id === "\0virtual:release-config") return "export default null;";
      if (id === "\0virtual:site-project-source") return 'export const siteProject = null; export const siteProjectRevision = null; export const deliverySource = {status:"no-active",message:"Disposable hosted demo has no local release server."}; export default siteProject;';
    },
    async generateBundle() {
      this.emitFile({ type: "asset", fileName: DEMO_EDITOR_SEED, source: JSON.stringify(bundledSeed) + "\n" });
      this.emitFile({ type: "asset", fileName: HOSTED_DEMO_HEADERS, source: hostedAssetHeaders(seed.files.map((file) => ({ path: file.fileName, byteLength: file.source.byteLength }))) });
      const assetConfig = `self.__zudoAssetConfig = { checksumUrlPattern: new RegExp(${JSON.stringify(`^${ASSET_CHECKSUM_URL_SOURCE}$`)}), authoringUrlPattern: new RegExp(${JSON.stringify(ASSET_AUTHORING_URL_PATTERN.source)}), contentTypeByExtension: ${JSON.stringify(ASSET_CONTENT_TYPE_BY_EXTENSION)}, kindsByMime: ${JSON.stringify(ASSET_KINDS)}, immutableCacheControl: ${JSON.stringify(ASSET_IMMUTABLE_CACHE_CONTROL)}, nosniff: ${JSON.stringify(ASSET_NOSNIFF)} };\n`;
      const worker = new TextEncoder().encode(assetConfig + `const bundledAssetPaths = ${JSON.stringify(seed.files.map((file) => "/" + file.fileName))};\n` + await readFile(resolve(APP_ROOT, "scripts/hosted-demo/assets-worker.js"), "utf8"));
      this.emitFile({ type: "asset", fileName: "hosted-demo-assets-worker.js", source: worker });
      for (const file of seed.files) this.emitFile({ type: "asset", ...file });
    },
    async writeBundle() {
      const manifest = await createDemoEditorManifest({ directory: outDir, sourceRevision });
      await writeFile(resolve(outDir, DEMO_EDITOR_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
    },
  };

  return {
    configFile: false,
    root: hostRoot,
    base: "/",
    publicDir: false,
    resolve: resolveComposerModules(),
    optimizeDeps: { exclude: [componentPack.identity.packageName, "@takazudo/zfb-md-wasm"], entries: [resolve(APP_ROOT, DEMO_EDITOR_ENTRY)] },
    server: { fs: { allow: [...resolveFsAllow(hostRoot), componentPack.identity.packageRoot] } },
    build: { outDir, emptyOutDir: true, rollupOptions: { input: APP_HTML_PATH } },
    plugins: [demo, componentPack, hostStylesPlugin({ stylesPath: paths.styles, styles: settings.styles, configPath }), tailwindPlugin(), preact()],
  };
}

export default defineConfig(() => {
  const hostDir = process.env.ZUDO_DEMO_EDITOR_HOST;
  if (!hostDir) throw new Error("Select a demo host with pnpm demo:build-editor <sample|shop|landing|blog|dir>.");
  return resolveDemoEditorConfig(hostDir);
});
