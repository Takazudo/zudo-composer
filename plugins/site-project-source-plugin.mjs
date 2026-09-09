// @ts-check
import { resolve } from "node:path";
import { appModuleId, resolveSiteProjectLocalRoot, resolveWorkspaceRoot } from "./roots.mjs";
import { COMPONENT_PACK_ID } from "./component-pack-plugin.mjs";
import { ASSET_CHECKSUM_URL_PATTERN, ASSET_IMMUTABLE_CACHE_CONTROL, ASSET_NOSNIFF, assetContentDisposition } from "../src/assets/model/asset-kinds.mjs";

export const SITE_PROJECT_SOURCE_ID = "virtual:site-project-source";
export const RESOLVED_SITE_PROJECT_SOURCE_ID = `\0${SITE_PROJECT_SOURCE_ID}`;
const PINNED_ASSET = ASSET_CHECKSUM_URL_PATTERN;

/** @param {unknown} source */
function serializedModule(source) {
  const ready = source && typeof source === "object" && "status" in source && source.status === "ready" && "artifact" in source;
  const artifact = ready ? source.artifact : undefined;
  const project = artifact && typeof artifact === "object" && "project" in artifact ? artifact.project : null;
  const revision = artifact && typeof artifact === "object" && "identity" in artifact && artifact.identity && typeof artifact.identity === "object" && "revision" in artifact.identity ? artifact.identity.revision : null;
  return `export const deliverySource = ${JSON.stringify(source)};\nexport const siteProject = ${JSON.stringify(project)};\nexport const siteProjectRevision = ${JSON.stringify(revision)};\nexport default siteProject;\n`;
}

/** @param {any} loaded */
function readySource(loaded) {
  const release = loaded.release;
  return { status: "ready", artifact: { kind: "activated-local", identity: release.identity, project: loaded.project, build: release.build, completionDigest: release.completionDigest, files: release.files, assetPins: release.stage.assetLock?.pins ?? [], toolchain: release.stage.toolchain } };
}

/**
 * Read-only release source. It resolves only the single verified active release
 * pointer, in every command.
 * @param {{readDevRelease?: () => Promise<any>, readDevAsset?: (pathname: string) => Promise<any>, workspaceRoot?: string, packIdentity?: import("./component-pack.d.mts").ResolvedComponentPack}} [options]
 */
export function siteProjectSourcePlugin(options = {}) {
  /** @type {any} */ let server;
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
  const devReaderId = appModuleId("server/site-project-local/dev-reader.ts");
  // The reader re-derives the current toolchain to compare it against the
  // activated release's, so it needs the same pack the service stamped with.
  const readerOptions = async () => ({ workspaceRoot, packIdentity: options.packIdentity, pack: (await server.ssrLoadModule(COMPONENT_PACK_ID)).componentPack });
  const readRelease = async () => options.readDevRelease ? options.readDevRelease() : server.ssrLoadModule(devReaderId).then(async (module) => module.readActivatedSiteRelease(await readerOptions()));
  const delivery = async () => {
    try { const loaded = await readRelease(); return loaded ? readySource(loaded) : { status: "no-active", message: "No completed local release is activated." }; }
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
    configureServer(viteServer) {
      server = viteServer;
      // The same resolver the store uses, so the watcher and the reader can
      // never disagree about which release tree is being served.
      const localRoot = resolveSiteProjectLocalRoot(workspaceRoot);
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
      /** @type {Promise<void> | undefined} */ let inFlightRefresh;
      const performRefresh = async () => {
        if (closed || refreshing) return; refreshing = true;
        try { while (!closed && applied < requested) {
          const generation = requested;
          let loaded, next, source, failed = false;
          try {
            loaded = await readRelease();
            next = pathsFor(loaded);
            source = loaded ? readySource(loaded) : { status: "no-active", message: "No completed local release is activated." };
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
      const refresh = () => {
        if (closed || refreshing) return inFlightRefresh;
        inFlightRefresh = performRefresh();
        return inFlightRefresh;
      };
      const scheduleRetry = () => { if (retryTimer || closed) return; const delay = retryDelay; retryDelay = Math.min(250, retryDelay * 2); retryTimer = globalThis.setTimeout(() => { retryTimer = undefined; if (!closed) void refresh(); }, delay); };
      const requestRefresh = (notify) => { if (closed) return; requested++; notifyPending ||= notify; globalThis.queueMicrotask(() => { void refresh(); }); };
      const changed = (path) => {
        if (watched.has(path)) requestRefresh(true);
      };
      viteServer.watcher.on("add", changed); viteServer.watcher.on("change", changed); viteServer.watcher.on("unlink", changed);
      const stopRefresh = () => { closed = true; if (retryTimer) globalThis.clearTimeout(retryTimer); retryTimer = undefined; };
      viteServer.httpServer?.once("close", stopRefresh);
      // Vite tears down SSR transports concurrently with plugin close hooks.
      // Drain our current load before entering that teardown, including in
      // middleware mode where there is no HTTP server close event.
      if (viteServer.close) {
        const close = viteServer.close.bind(viteServer);
        viteServer.close = async () => {
          stopRefresh();
          await inFlightRefresh;
          return close();
        };
      }
      requestRefresh(false);
      viteServer.middlewares?.use(async (req, res, next) => {
        if (req.method !== undefined && req.method !== "GET" && req.method !== "HEAD") return next();
        let pathname; try { pathname = new URL(req.url ?? "", "http://localhost").pathname; } catch { return next(); }
        if (!PINNED_ASSET.test(pathname)) return next();
        try {
          const value = options.readDevAsset ? await options.readDevAsset(pathname) : await viteServer.ssrLoadModule(devReaderId).then(async (module) => module.readActivatedSiteAssets(pathname, await readerOptions()));
          if (!value) return next();
          const checksum = pathname.slice("/uploaded-assets/sha256-".length).split(".", 1)[0];
          res.statusCode = 200;
          res.setHeader("Content-Type", value.mimeType);
          res.setHeader("Content-Length", String(value.bytes.byteLength));
          res.setHeader("Cache-Control", ASSET_IMMUTABLE_CACHE_CONTROL);
          res.setHeader("X-Content-Type-Options", ASSET_NOSNIFF);
          res.setHeader("ETag", `"sha256-${checksum}"`);
          const disposition = assetContentDisposition(value.mimeType, checksum);
          if (disposition !== undefined) res.setHeader("Content-Disposition", disposition);
          return req.method === "HEAD" ? res.end() : res.end(Buffer.from(value.bytes));
        } catch { res.statusCode = 503; res.setHeader("Cache-Control", "no-store"); return res.end("Activated Assets unavailable."); }
      });
    },
    resolveId(id) { return id === SITE_PROJECT_SOURCE_ID ? RESOLVED_SITE_PROJECT_SOURCE_ID : undefined; },
    async load(id) { if (id !== RESOLVED_SITE_PROJECT_SOURCE_ID) return undefined; return serializedModule(await delivery()); },
  };
}

export default siteProjectSourcePlugin;
