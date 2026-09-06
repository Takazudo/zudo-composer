// @ts-check
import { resolve } from "node:path";

export const SITE_PROJECT_SOURCE_ID = "virtual:site-project-source";
export const RESOLVED_SITE_PROJECT_SOURCE_ID = `\0${SITE_PROJECT_SOURCE_ID}`;
const PINNED_MEDIA = /^\/uploaded-media\/sha256-[a-f0-9]{64}\.(?:png|jpg|gif|webp|pdf)$/;

/** @param {any} value */
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
/** @param {any} source @param {any} currentToolchain */
export function assertBundledToolchain(source, currentToolchain) {
  if (!source || source.status !== "ready" || !source.artifact?.toolchain || canonical(source.artifact.toolchain) !== canonical(currentToolchain)) throw new TypeError("Bundled release toolchain does not match the current installed runtime.");
}

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
  return { status: "ready", artifact: { kind, identity: release.identity, project: loaded.project, build: release.build, completionDigest: release.completionDigest, files: release.files, mediaPins: release.stage.mediaLock?.pins ?? [], toolchain: release.stage.toolchain } };
}

/**
 * Read-only release source. Production receives an explicit precompiled bundle;
 * development resolves only the single verified active release pointer.
 * @param {{bundledSource: unknown, currentToolchain: unknown, readDevRelease?: () => Promise<any>, readDevMedia?: (pathname: string) => Promise<any>}} options
 */
export function siteProjectSourcePlugin(options) {
  if (!options || !("bundledSource" in options) || !options.bundledSource) throw new TypeError("siteProjectSourcePlugin requires an explicit bundled delivery source.");
  assertBundledToolchain(options.bundledSource, options.currentToolchain);
  let command = "build";
  /** @type {any} */ let server;
  const readRelease = async () => options.readDevRelease ? options.readDevRelease() : server.ssrLoadModule("/server/site-project-local/dev-reader.ts").then((module) => module.readActivatedSiteRelease());
  const delivery = async () => {
    try { const loaded = await readRelease(); return loaded ? readySource(loaded, "activated-local") : { status: "no-active", message: "No completed local release is activated." }; }
    catch (error) { return { status: "error", message: error instanceof Error ? error.message : "Activated local release is unavailable." }; }
  };
  const publish = (deliverySource) => {
    if (!server) return;
    const module = server.moduleGraph.getModuleById(RESOLVED_SITE_PROJECT_SOURCE_ID);
    if (module) server.moduleGraph.invalidateModule(module);
    server.ws.send({ type: "custom", event: "release:changed", data: { source: "activated-release", deliverySource } });
  };
  return {
    name: "zudo-site-project-source", enforce: "pre",
    configResolved(config) { command = config.command; },
    configureServer(viteServer) {
      server = viteServer;
      const configuredRoot = process.env.ZUDO_SITE_PROJECT_ROOT?.trim();
      const localRoot = configuredRoot ? resolve(configuredRoot) : resolve(viteServer.config.root, ".zudo-site-project");
      const active = resolve(localRoot, "active.json");
      // Active selection is replaced atomically. Keep a stable directory watch
      // as well as the exact file watch so repeated rename/unlink/add cycles do
      // not detach chokidar from the new inode.
      viteServer.watcher.add(localRoot);
      viteServer.watcher.add(active);
      let watched = new Set([localRoot, active]), requested = 0, applied = 0, refreshing = false, notifyPending = false, retryTimer, retryDelay = 25, closed = false;
      const pathsFor = (loaded) => {
        if (!loaded) return new Set([localRoot, active]);
        const { projectId, revision, buildId } = loaded.release.identity;
        const buildRoot = resolve(localRoot, "builds", buildId);
        return new Set([localRoot, active, resolve(localRoot, "projects", projectId, `${revision}.json`), resolve(buildRoot, "stage.json"), resolve(buildRoot, "build.json"), resolve(buildRoot, "complete.json"), ...Object.keys(loaded.release.files).map((name) => resolve(buildRoot, name))]);
      };
      const refresh = async () => {
        if (closed || refreshing) return; refreshing = true;
        try { while (!closed && applied < requested) {
          const generation = requested;
          let loaded, next, source, failed = false;
          try {
            loaded = await readRelease();
            next = pathsFor(loaded);
            source = loaded ? readySource(loaded, "activated-local") : { status: "no-active", message: "No completed local release is activated." };
          } catch { failed = true; }
          if (closed) break;
          if (generation !== requested) continue;
          if (failed) { notifyPending = true; scheduleRetry(); break; }
          if (retryTimer) { globalThis.clearTimeout(retryTimer); retryTimer = undefined; } retryDelay = 25;
          for (const path of next) if (!watched.has(path)) viteServer.watcher.add(path);
          for (const path of watched) if (!next.has(path)) viteServer.watcher.unwatch(path);
          watched = next; applied = generation;
          if (notifyPending) {
            try { publish(source); notifyPending = false; }
            catch { notifyPending = true; requested++; scheduleRetry(); break; }
          }
        } } finally { refreshing = false; if (!closed && applied < requested && !retryTimer) globalThis.queueMicrotask(() => { void refresh(); }); }
      };
      const scheduleRetry = () => { if (retryTimer || closed) return; const delay = retryDelay; retryDelay = Math.min(250, retryDelay * 2); retryTimer = globalThis.setTimeout(() => { retryTimer = undefined; if (!closed) void refresh(); }, delay); };
      const requestRefresh = (notify) => { if (closed) return; requested++; notifyPending ||= notify; globalThis.queueMicrotask(() => { void refresh(); }); };
      const changed = (path) => {
        if (watched.has(path)) requestRefresh(true);
      };
      viteServer.watcher.on("add", changed); viteServer.watcher.on("change", changed); viteServer.watcher.on("unlink", changed);
      viteServer.httpServer?.once("close", () => { closed = true; if (retryTimer) globalThis.clearTimeout(retryTimer); retryTimer = undefined; });
      requestRefresh(false);
      viteServer.middlewares?.use(async (req, res, next) => {
        let pathname; try { pathname = new URL(req.url ?? "", "http://localhost").pathname; } catch { return next(); }
        if (!PINNED_MEDIA.test(pathname)) return next();
        try {
          const value = options.readDevMedia ? await options.readDevMedia(pathname) : await viteServer.ssrLoadModule("/server/site-project-local/dev-reader.ts").then((module) => module.readActivatedSiteMedia(pathname));
          if (!value) return next();
          res.statusCode = 200; res.setHeader("Content-Type", value.mediaType); res.setHeader("Content-Length", String(value.bytes.byteLength)); res.setHeader("Cache-Control", "public, max-age=31536000, immutable"); res.setHeader("ETag", `"sha256-${pathname.slice("/uploaded-media/sha256-".length).split(".")[0]}"`); return res.end(Buffer.from(value.bytes));
        } catch { res.statusCode = 503; res.setHeader("Cache-Control", "no-store"); return res.end("Activated Media unavailable."); }
      });
    },
    resolveId(id) { return id === SITE_PROJECT_SOURCE_ID ? RESOLVED_SITE_PROJECT_SOURCE_ID : undefined; },
    async load(id) { if (id !== RESOLVED_SITE_PROJECT_SOURCE_ID) return undefined; return serializedModule(command === "build" ? options.bundledSource : await delivery()); },
  };
}

export default siteProjectSourcePlugin;
