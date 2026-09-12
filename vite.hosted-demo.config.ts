import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import componentPackPlugin from "./plugins/component-pack-plugin.mjs";
import hostStylesPlugin from "./plugins/host-styles-plugin.mjs";
import hostConfig from "./zudo-composer.config";
import { serializeSiteProject } from "./src/site-project/model/canonical";
import type { SiteProject } from "./src/site-project/model/types";
import sample from "./src/hosted-demo/sample-project.json";
import { prepareDemoAsset } from "./scripts/hosted-demo/prepare";
import { ASSET_AUTHORING_URL_PATTERN, ASSET_CHECKSUM_URL_SOURCE, ASSET_CONTENT_TYPE_BY_EXTENSION, ASSET_IMMUTABLE_CACHE_CONTROL, ASSET_KINDS, ASSET_NOSNIFF } from "./src/assets/model/asset-kinds.mjs";
import { HOSTED_DEMO_HEADERS } from "./scripts/hosted-demo/artifact.mjs";
import { hostedAssetHeaders } from "./src/assets/model/asset-kinds.mjs";
const root = import.meta.dirname;
const pack = componentPackPlugin({ workspaceRoot: root, pack: hostConfig.pack });
const demo: Plugin = {
  name: "explicit-hosted-demo",
  transformIndexHtml: { order: "pre", handler(html) {
    const entry = 'src="/src/main.tsx"';
    if (html.split(entry).length !== 2) throw new Error("Hosted demo requires exactly one ordinary application entry in index.html.");
    return html.replace(entry, 'src="/src/hosted-demo/main.tsx"');
  } },
  resolveId(id) { if (["virtual:hosted-demo-seed", "virtual:composer-file-provider-config", "virtual:composer-domain-providers", "virtual:release-config", "virtual:site-project-source"].includes(id)) return `\0${id}`; },
  async load(id) {
    if (id === "\0virtual:hosted-demo-seed") { const { snapshot } = await prepareDemoAsset(resolve(root, "cms/assets")); return `export const assets = ${JSON.stringify(snapshot)};`; }
    if (id === "\0virtual:composer-file-provider-config") return "export const fileProviderConfig = undefined;";
    if (id === "\0virtual:composer-domain-providers") return "export const domainProviderConfig = undefined;";
    if (id === "\0virtual:release-config") return "export default null;";
    if (id === "\0virtual:site-project-source") return 'export const siteProject = null; export const siteProjectRevision = null; export const deliverySource = {status:"no-active",message:"Disposable hosted demo has no local release server."}; export default siteProject;';
  },
  async generateBundle() {
    const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    if (!/^[a-f0-9]{40}$/.test(sourceRevision)) throw new Error("A full source Git revision is required.");
    const { files } = await prepareDemoAsset(resolve(root, "cms/assets"));
    this.emitFile({ type: "asset", fileName: HOSTED_DEMO_HEADERS, source: hostedAssetHeaders(files.map((file) => ({ path: file.fileName, byteLength: file.source.byteLength }))) });
    const assetConfig = `self.__zudoAssetConfig = { checksumUrlPattern: new RegExp(${JSON.stringify(`^${ASSET_CHECKSUM_URL_SOURCE}$`)}), authoringUrlPattern: new RegExp(${JSON.stringify(ASSET_AUTHORING_URL_PATTERN.source)}), contentTypeByExtension: ${JSON.stringify(ASSET_CONTENT_TYPE_BY_EXTENSION)}, kindsByMime: ${JSON.stringify(ASSET_KINDS)}, immutableCacheControl: ${JSON.stringify(ASSET_IMMUTABLE_CACHE_CONTROL)}, nosniff: ${JSON.stringify(ASSET_NOSNIFF)} };\n`;
    const worker = new TextEncoder().encode(assetConfig + `const bundledAssetPaths = ${JSON.stringify(files.map((file) => "/" + file.fileName))};\n` + await readFile(resolve(root, "scripts/hosted-demo/assets-worker.js"), "utf8"));
    files.push({ fileName: "hosted-demo-assets-worker.js", source: worker });
    for (const file of files) this.emitFile({ type: "asset", ...file });
  },
  async writeBundle() {
    const output = resolve(root, "dist-hosted-demo");
    const assets: Record<string, string> = {};
    async function walk(directory: string, prefix = "") {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (entry.isDirectory()) await walk(resolve(directory, entry.name), name + "/");
        else if (name !== "hosted-demo-manifest.json") assets[name] = createHash("sha256").update(await readFile(resolve(directory, entry.name))).digest("hex");
      }
    }
    await walk(output);
    const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await writeFile(resolve(output, "hosted-demo-manifest.json"), JSON.stringify({ schemaVersion: 1, sourceRevision, projectSourceRevision: createHash("sha256").update(serializeSiteProject(sample as SiteProject)).digest("hex"), mode: "disposable-hosted-demo", assets }, null, 2) + "\n");
  },
};
export default defineConfig({ base: "/", publicDir: false, build: { outDir: "dist-hosted-demo" }, plugins: [demo, pack, hostStylesPlugin({ stylesPath: resolve(root, "styles/base.css"), styles: hostConfig.styles, configPath: resolve(root, "zudo-composer.config.ts") }), tailwindcss(), preact()] });
