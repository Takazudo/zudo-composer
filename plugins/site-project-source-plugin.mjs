// @ts-check
import { resolve } from "node:path";

export const SITE_PROJECT_SOURCE_ID = "virtual:site-project-source";
export const RESOLVED_SITE_PROJECT_SOURCE_ID = `\0${SITE_PROJECT_SOURCE_ID}`;

/** @param {unknown} value @param {string | null} revision */
function serializedModule(value, revision) {
  return `export const siteProject = ${JSON.stringify(value)};\nexport const siteProjectRevision = ${JSON.stringify(revision)};\nexport default siteProject;\n`;
}

/**
 * Generic read-only SiteProject source. The bundled value is mandatory so a
 * production build is completely determined before Vite config evaluation.
 *
 * @param {{bundledProject: unknown, bundledRevision: string, readDevProject?: () => Promise<unknown>}} options
 */
export function siteProjectSourcePlugin(options) {
  if (!options || !("bundledProject" in options) || !/^[a-f0-9]{64}$/.test(options.bundledRevision)) {
    throw new TypeError("siteProjectSourcePlugin requires bundledProject and its canonical SHA-256 revision.");
  }
  let command = "build";
  let server;
  let currentCanonical;
  let currentActive;
  let reloadPending = false;

  const reload = () => {
    if (!server) return;
    const module = server.moduleGraph.getModuleById(RESOLVED_SITE_PROJECT_SOURCE_ID);
    if (module) server.moduleGraph.invalidateModule(module);
    server.ws.send({ type: "full-reload", path: "*" });
  };

  return {
    name: "zudo-site-project-source",
    enforce: "pre",
    configResolved(config) { command = config.command; },
    configureServer(viteServer) {
      server = viteServer;
      // Keep the watcher aligned with the store used by the dev reader. The
      // acceptance lane supplies a disposable root through this env seam.
      const configuredRoot = process.env.ZUDO_SITE_PROJECT_ROOT?.trim();
      const localRoot = configuredRoot ? resolve(configuredRoot) : resolve(viteServer.config.root, ".zudo-site-project");
      currentActive = resolve(localRoot, "active.json");
      viteServer.watcher.add(currentActive);
      const watchCurrent = async () => {
        try {
          const loaded = options.readDevProject
            ? await options.readDevProject()
            : await viteServer.ssrLoadModule("/server/site-project-local/dev-reader.ts").then((module) => module.readActivatedSiteProject());
          const next = loaded && typeof loaded === "object" && "project" in loaded && "revision" in loaded
            ? resolve(localRoot, "projects", `${loaded.project.id}.site-project.json`) : undefined;
          if (currentCanonical && currentCanonical !== next) viteServer.watcher.unwatch(currentCanonical);
          currentCanonical = next;
          if (next) viteServer.watcher.add(next);
        } catch { currentCanonical = undefined; }
      };
      void watchCurrent();
      const changed = (path) => {
        if (path !== currentActive && path !== currentCanonical) return;
        if (reloadPending) return;
        reloadPending = true;
        globalThis.queueMicrotask(() => { void watchCurrent().finally(() => { reloadPending = false; reload(); }); });
      };
      viteServer.watcher.on("add", changed);
      viteServer.watcher.on("change", changed);
      viteServer.watcher.on("unlink", changed);
    },
    resolveId(id) { return id === SITE_PROJECT_SOURCE_ID ? RESOLVED_SITE_PROJECT_SOURCE_ID : undefined; },
    async load(id) {
      if (id !== RESOLVED_SITE_PROJECT_SOURCE_ID) return undefined;
      if (command === "build") return serializedModule(options.bundledProject, options.bundledRevision);
      const activated = options.readDevProject
        ? await options.readDevProject()
        : await server.ssrLoadModule("/server/site-project-local/dev-reader.ts").then((module) => module.readActivatedSiteProject());
      return serializedModule(activated?.project ?? null, activated?.revision ?? null);
    },
  };
}

export default siteProjectSourcePlugin;
