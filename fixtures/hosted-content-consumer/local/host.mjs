// Composition root of the persistent local Hosted Content host. Identity, storage, renderer and publisher
// are chosen here, once, at startup; the public service, editor and preview receive them only as injected
// dependencies. Local-only: no production auth, no D1, no Git or Cloudflare connection.
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFixturePolicy, createFixtureSeed, createFixtureService, fixtureActor, fixtureEntry } from "../fixture-data.mjs";
import { initializeSqliteDatabase, openSqliteHandle } from "../sqlite-storage.mjs";
import { fixedHostDefinition, projectHostedContent } from "../renderer/src/project.ts";
import { defaultRendererHostRoot, openRendererHost } from "./renderer-host.mjs";
import { createLocalPublisher, localArtifactNotice } from "./publisher.mjs";
import { createLocalHttpServer } from "./http.mjs";
import { buildLocalUi } from "./ui-bundle.mjs";

export const defaultLocalPort = 4179;
export const defaultLocalDirectory = () => resolve(process.cwd(), ".zudo-local/hosted-content");
const markerName = "local-host.json";
const markerKind = "zudo-composer-local-hosted-content";

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } };

async function readMarker(directory) {
  try { return JSON.parse(await readFile(join(directory, markerName), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function entries(directory) {
  try { return await readdir(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
async function liveLockOwner(directory) {
  try {
    const pid = Number(await readFile(join(directory, "host.lock"), "utf8"));
    return Number.isSafeInteger(pid) && pid !== process.pid && alive(pid) ? pid : null;
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** One running host per directory; a lock left by a dead process is taken over. */
async function acquireLock(directory) {
  const filename = join(directory, "host.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(filename, "wx");
      try { await file.writeFile(String(process.pid)); await file.sync(); } finally { await file.close(); }
      return async () => { await rm(filename, { force: true }); };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = await liveLockOwner(directory);
      if (owner) throw new Error(`Another local host (pid ${owner}) is using ${directory}. Stop it or choose another --dir.`, { cause: error });
      await rm(filename, { force: true });
    }
  }
  throw new Error(`Could not lock ${directory}`);
}

/** Reset is explicit and only ever deletes a directory this host created (or an empty one). */
async function resetDirectory(directory) {
  const names = await entries(directory);
  if (!names.length) return;
  if ((await readMarker(directory))?.kind !== markerKind) throw new Error(`Refusing to reset ${directory}: it is not a local hosted content directory.`);
  const owner = await liveLockOwner(directory);
  if (owner) throw new Error(`Refusing to reset ${directory}: a local host (pid ${owner}) is running.`);
  for (const name of names) await rm(join(directory, name), { recursive: true, force: true });
}

export async function startLocalHostedContent({ directory = defaultLocalDirectory(), port = defaultLocalPort, reset = false,
  rendererHost = defaultRendererHostRoot(), faults = {}, log = message => console.error(message) } = {}) {
  directory = resolve(directory);
  // Checked before touching data: the real renderer must already be prepared (never installed implicitly).
  const renderer = await openRendererHost({ root: rendererHost });
  if (reset) await resetDirectory(directory);
  const existing = await entries(directory);
  const marker = await readMarker(directory);
  if (existing.length && marker?.kind !== markerKind) throw new Error(`${directory} is not empty and was not created by the local host. Choose another --dir.`);
  await mkdir(directory, { recursive: true });
  const releaseLock = await acquireLock(directory);
  try {
    // --- Injected dependencies (the only place local choices are made) ---
    // Identity: the fixture's fixed local actor, authorized inside createFixtureService. Storage: SQLite.
    // Renderer: the prepared real host renderer. Publisher: the local sink/provider plus artifact driver.
    const identity = { actor: fixtureActor };
    const policy = createFixturePolicy();
    const seed = createFixtureSeed();
    const definition = seed.state.definition;
    const locations = { directory, database: join(directory, "content.sqlite"), artifacts: join(directory, "artifacts"), sink: join(directory, "publication") };
    if (marker && marker.definition !== definition) throw new Error(`${directory} was created for another hosted definition or renderer. Start with --reset or choose another --dir.`);
    const instance = marker ?? { kind: markerKind, instanceId: randomUUID(), createdAt: new Date().toISOString(), definition, renderer: renderer.identity, notice: localArtifactNotice };
    if (!marker) await writeFile(join(directory, markerName), JSON.stringify(instance, null, 2) + "\n");
    await initializeSqliteDatabase(locations.database, seed);
    // Every request and publication step gets its own SQLite connection.
    const openService = () => { const handle = openSqliteHandle(locations.database); return { service: createFixtureService(handle.storage, projectHostedContent), storage: handle.storage, close: () => handle.close() }; };
    const withService = async work => { const context = openService(); try { return await work(context.service); } finally { context.close(); } };
    const publisher = await createLocalPublisher({ directory: locations.sink, artifactsDirectory: locations.artifacts, baseline: seed.state.baseline,
      definition, actor: identity.actor, openService, renderer, faults, log });
    // --- End of injected dependencies ---

    const ui = await buildLocalUi();
    const presentation = { instanceId: instance.instanceId, selection: { entry: fixtureEntry, fieldId: "title" }, routeId: fixedHostDefinition.route.id,
      previewUrl: "/preview.html", pack: renderer.pack, renderer: renderer.identity, notice: localArtifactNotice,
      locations: { database: locations.database, artifacts: locations.artifacts } };
    const http = createLocalHttpServer({ withService, actor: identity.actor, policy, presentation, publisher, ui, renderer, log });
    let actualPort;
    try { actualPort = await http.listen(port); }
    catch (error) {
      if (error.code === "EADDRINUSE") throw new Error(`Port ${port} is in use. Pass --port <n> to choose another loopback port.`, { cause: error });
      throw error;
    }
    const url = `http://127.0.0.1:${actualPort}/`;
    const recovered = publisher.recover();
    let closed = false;
    return { url, port: actualPort, ...locations, rendererLocation: renderer.location, sinkFile: publisher.sink.filename, instanceId: instance.instanceId, publisher, recovered,
      async close() {
        if (closed) return;
        closed = true;
        await http.close();
        await publisher.idle();
        await releaseLock();
      } };
  } catch (error) { await releaseLock(); throw error; }
}
