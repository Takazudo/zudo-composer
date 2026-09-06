// @ts-check
import { resolve } from "node:path";

export const SITE_PROJECT_SOURCE_ID = "virtual:site-project-source";
export const RESOLVED_SITE_PROJECT_SOURCE_ID = `\0${SITE_PROJECT_SOURCE_ID}`;
const PINNED_MEDIA = /^\/uploaded-media\/sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf)$/;

/** @param {unknown} source */
function serializedModule(source) {
  const ready = source && typeof source === "object" && "status" in source && source.status === "ready" && "artifact" in source;
  const artifact = ready ? source.artifact : undefined;
  const project = artifact && typeof artifact === "object" && "project" in artifact ? artifact.project : null;
  const revision = artifact && typeof artifact === "object" && "identity" in artifact && artifact.identity && typeof artifact.identity === "object" && "revision" in artifact.identity ? artifact.identity.revision : null;
  return `export const deliverySource = ${JSON.stringify(source)};\nexport const siteProject = ${JSON.stringify(project)};\nexport const siteProjectRevision = ${JSON.stringify(revision)};\nexport default siteProject;\n`;
}

/** @param {any} loaded @param {"activated-local"|"bundled-static"} kind */
function readySource(loaded, kind) {
  const release = loaded.release;
  return { status: "ready", artifact: { kind, identity: release.identity, project: loaded.project, build: release.build, completionDigest: release.completionDigest, files: release.files, mediaPins: release.stage.mediaLock?.pins ?? [] } };
}

/**
 * Read-only release source. Production receives an explicit precompiled bundle;
 * development resolves only the single verified active release pointer.
 * @param {{bundledSource: unknown, readDevRelease?: () => Promise<any>, readDevMedia?: (pathname: string) => Promise<any>}} options
 */
export function siteProjectSourcePlugin(options) {
  if (!options || !("bundledSource" in options) || !options.bundledSource) throw new TypeError("siteProjectSourcePlugin requires an explicit bundled delivery source.");
  let command = "build";
  /** @type {any} */ let server;
  /** @type {string|undefined} */ let currentCanonical;
  /** @type {string|undefined} */ let currentBuild;
  let reloadPending = false;
  const readRelease = async () => options.readDevRelease ? options.readDevRelease() : server.ssrLoadModule("/server/site-project-local/dev-reader.ts").then((module) => module.readActivatedSiteRelease());
  const delivery = async () => {
    try { const loaded = await readRelease(); return loaded ? readySource(loaded, "activated-local") : { status: "no-active", message: "No completed local release is activated." }; }
    catch (error) { return { status: "error", message: error instanceof Error ? error.message : "Activated local release is unavailable." }; }
  };
  const reload = () => {
    if (!server) return;
    const module = server.moduleGraph.getModuleById(RESOLVED_SITE_PROJECT_SOURCE_ID);
    if (module) { server.moduleGraph.invalidateModule(module); void server.reloadModule?.(module); }
    server.ws.send({ type: "custom", event: "release:changed", data: { source: "activated-release" } });
  };
  return {
    name: "zudo-site-project-source", enforce: "pre",
    configResolved(config) { command = config.command; },
    configureServer(viteServer) {
      server = viteServer;
      const configuredRoot = process.env.ZUDO_SITE_PROJECT_ROOT?.trim();
      const localRoot = configuredRoot ? resolve(configuredRoot) : resolve(viteServer.config.root, ".zudo-site-project");
      const active = resolve(localRoot, "active.json");
      viteServer.watcher.add(active);
      const watchCurrent = async () => {
        try {
          const loaded = await readRelease();
          const nextCanonical = loaded ? resolve(localRoot, "projects", loaded.release.identity.projectId, `${loaded.release.identity.revision}.json`) : undefined;
          const nextBuild = loaded ? resolve(localRoot, "builds", loaded.release.identity.buildId, "complete.json") : undefined;
          for (const prior of [currentCanonical, currentBuild]) if (prior && prior !== nextCanonical && prior !== nextBuild) viteServer.watcher.unwatch(prior);
          currentCanonical = nextCanonical; currentBuild = nextBuild;
          for (const next of [nextCanonical, nextBuild]) if (next) viteServer.watcher.add(next);
        } catch { currentCanonical = undefined; currentBuild = undefined; }
      };
      void watchCurrent();
      const changed = (path) => {
        if (![active, currentCanonical, currentBuild].includes(path) || reloadPending) return;
        reloadPending = true;
        globalThis.queueMicrotask(() => { void watchCurrent().finally(() => { reloadPending = false; reload(); }); });
      };
      viteServer.watcher.on("add", changed); viteServer.watcher.on("change", changed); viteServer.watcher.on("unlink", changed);
      viteServer.middlewares?.use(async (req, res, next) => {
        let pathname; try { pathname = new URL(req.url ?? "", "http://localhost").pathname; } catch { return next(); }
        if (!PINNED_MEDIA.test(pathname)) return next();
        try {
          const value = options.readDevMedia ? await options.readDevMedia(pathname) : await viteServer.ssrLoadModule("/server/site-project-local/dev-reader.ts").then((module) => module.readActivatedSiteMedia(pathname));
          if (!value) { res.statusCode = 404; res.setHeader("Cache-Control", "no-store"); return res.end("Pinned activated Media not found."); }
          res.statusCode = 200; res.setHeader("Content-Type", value.mediaType); res.setHeader("Content-Length", String(value.bytes.byteLength)); res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); res.setHeader("ETag", `"sha256-${pathname.slice("/uploaded-media/sha256-".length).split(".")[0]}"`); return res.end(Buffer.from(value.bytes));
        } catch { res.statusCode = 503; res.setHeader("Cache-Control", "no-store"); return res.end("Activated Media unavailable."); }
      });
    },
    resolveId(id) { return id === SITE_PROJECT_SOURCE_ID ? RESOLVED_SITE_PROJECT_SOURCE_ID : undefined; },
    async load(id) { if (id !== RESOLVED_SITE_PROJECT_SOURCE_ID) return undefined; return serializedModule(command === "build" ? options.bundledSource : await delivery()); },
  };
}

export default siteProjectSourcePlugin;
