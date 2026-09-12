import { normalizePath, type InlineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import preact from "@preact/preset-vite";
import tailwindPlugin from "../../plugins/tailwind-plugin.mjs";
import componentPackPlugin from "../../plugins/component-pack-plugin.mjs";
import hostStylesPlugin from "../../plugins/host-styles-plugin.mjs";
import { APP_HTML_PATH, rewriteAppEntry } from "../../plugins/composer-app-html.mjs";
import { SITE_BUILD_ENTRY, resolveWorkspaceRoot } from "../../plugins/roots.mjs";
import { resolveComposerModules } from "../../plugins/module-resolution.mjs";
import { loadHostContext } from "../host-context.mjs";
import { compileStaticSite, SITE_MANIFEST, SITE_HEADERS, createSiteManifest } from "../site-build.mjs";
import { collectStaticSiteAssets } from "./assets";
import { resolveSiteSourceRevision } from "./source-revision.mjs";
import type { BuildSiteOptions } from "./run.mjs";

const STUBBED = ["virtual:composer-file-provider-config", "virtual:composer-domain-providers", "virtual:release-config", "virtual:site-project-source"];

/** The shipped static builder owns its shell and visitor; the host owns the Vite root. */
export async function resolveStaticSiteConfig(options: Pick<BuildSiteOptions, "workspaceRoot" | "sourceRevision" | "env"> = {}): Promise<InlineConfig> {
  const sourceRevision = resolveSiteSourceRevision(options.sourceRevision, options.env);
  const hostRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const { composerConfig, pack } = await loadHostContext({ workspaceRoot: hostRoot, env: options.env });
  const { paths, settings, configPath } = composerConfig;
  const compiled = await compileStaticSite({ projectPath: resolve(hostRoot, "site-project.json"), pack, assetsStoreRoot: paths.assets });
  const outDir = resolve(hostRoot, "dist-site");
  const htmlEntryId = normalizePath(resolve(hostRoot, "index.html"));

  const site: Plugin = {
    name: "explicit-site-static",
    enforce: "pre",
    transformIndexHtml: { order: "pre", handler(html) {
      const title = compiled.project.name.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);
      return rewriteAppEntry(html, SITE_BUILD_ENTRY).replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`).replace(/\s*<meta name="description"[^>]*>/, "").replace(/\s*<!--[\s\S]*?-->/g, "");
    } },
    resolveId(id, _importer, { isEntry }) {
      // Vite emits HTML relative to its root. The absolute tool input would
      // otherwise become ../tool/index.html (rejected by the bundler), or a
      // nested node_modules path. Project just this entry onto a host-rooted
      // module ID, then load the tool's bytes without touching host index.html.
      if (isEntry && normalizePath(id) === normalizePath(APP_HTML_PATH)) return htmlEntryId;
      if (id === "virtual:site-static-project" || STUBBED.includes(id)) return `\0${id}`;
    },
    load(id) {
      if (normalizePath(id) === htmlEntryId) return readFile(APP_HTML_PATH, "utf8");
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
      const manifest = await createSiteManifest({ directory: outDir, projectId: compiled.project.id, sourceRevision, projectSourceRevision: compiled.projectSourceRevision, routes: compiled.build.routes.map(({ pathname }) => pathname) });
      await writeFile(resolve(outDir, SITE_MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
    },
  };

  return {
    configFile: false,
    root: hostRoot,
    base: "/",
    publicDir: false,
    resolve: resolveComposerModules(),
    build: { outDir, emptyOutDir: true, rollupOptions: { input: APP_HTML_PATH } },
    plugins: [
      site,
      componentPackPlugin({ workspaceRoot: hostRoot, pack: settings.pack }),
      hostStylesPlugin({ stylesPath: paths.styles, styles: settings.styles, configPath }),
      tailwindPlugin(),
      preact(),
    ],
  };
}
