import { defineConfig, type Plugin, type UserConfig } from "vite";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import preact from "@preact/preset-vite";
import tailwindPlugin from "./plugins/tailwind-plugin.mjs";
import componentPackPlugin from "./plugins/component-pack-plugin.mjs";
import hostStylesPlugin from "./plugins/host-styles-plugin.mjs";
import { loadHostContext } from "./server/host-context.mjs";
import { compileStaticSite, SITE_MANIFEST, SITE_HEADERS, createSiteManifest } from "./server/site-build.mjs";
import { collectStaticSiteAssets } from "./server/site-build/assets";

const root = import.meta.dirname;
const STUBBED = ["virtual:composer-file-provider-config", "virtual:composer-domain-providers", "virtual:release-config", "virtual:site-project-source"];

export default defineConfig(async (): Promise<UserConfig> => {
  const hostRootValue = process.env.ZUDO_HOST_ROOT;
  if (!hostRootValue) throw new Error("ZUDO_HOST_ROOT must name the host project to build (e.g. packages/demo-webshop).");
  const hostRoot = resolve(root, hostRootValue);
  const { composerConfig, pack } = await loadHostContext({ workspaceRoot: hostRoot });
  const { paths, settings, configPath } = composerConfig;
  const compiled = await compileStaticSite({ projectPath: resolve(hostRoot, "site-project.json"), pack, assetsStoreRoot: paths.assets });
  const outDir = resolve(hostRoot, "dist-site");

  const site: Plugin = {
    name: "explicit-site-static",
    transformIndexHtml: { order: "pre", handler(html) {
      const entry = 'src="/src/main.tsx"';
      if (html.split(entry).length !== 2) throw new Error("The static site build requires exactly one ordinary application entry in index.html.");
      const title = compiled.project.name.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
      return html.replace(entry, 'src="/server/site-build/client/main.tsx"').replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`).replace(/\s*<meta name="description"[^>]*>/, "").replace(/\s*<!--[\s\S]*?-->/g, "");
    } },
    resolveId(id) { if (id === "virtual:site-static-project" || STUBBED.includes(id)) return `\0${id}`; },
    load(id) {
      if (id === "\0virtual:site-static-project") return `export const project = ${JSON.stringify(compiled.project)};\nexport const build = ${JSON.stringify(compiled.build)};\n`;
      if (id === "\0virtual:composer-file-provider-config") return "export const fileProviderConfig = undefined;";
      if (id === "\0virtual:composer-domain-providers") return "export const domainProviderConfig = undefined;";
      if (id === "\0virtual:release-config") return "export default null;";
      if (id === "\0virtual:site-project-source") return 'export const siteProject = null; export const siteProjectRevision = null; export const deliverySource = {status:"no-active",message:"A static site has no local release server."}; export default siteProject;';
    },
    async generateBundle() {
      const assets = await collectStaticSiteAssets({ assetFiles: compiled.assetFiles, publicAssets: paths.publicAssets });
      for (const { fileName, source } of assets.files) this.emitFile({ type: "asset", fileName, source });
      this.emitFile({ type: "asset", fileName: SITE_HEADERS, source: assets.headers });
    },
    async writeBundle() {
      const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
      const manifest = await createSiteManifest({ directory: outDir, projectId: compiled.project.id, sourceRevision, projectSourceRevision: compiled.projectSourceRevision, routes: compiled.build.routes.map(({ pathname }) => pathname) });
      await writeFile(resolve(outDir, SITE_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
    },
  };

  return {
    base: "/",
    publicDir: false,
    build: { outDir, emptyOutDir: true },
    plugins: [
      site,
      componentPackPlugin({ workspaceRoot: hostRoot, pack: settings.pack }),
      hostStylesPlugin({ stylesPath: paths.styles, styles: settings.styles, configPath }),
      tailwindPlugin(),
      preact(),
    ],
  };
});
