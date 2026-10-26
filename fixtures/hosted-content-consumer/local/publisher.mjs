// Local publication for the persistent local host. Remote facts, status recording, stale-observation
// rejection and integration evidence are publication-proof.mjs's sink and provider, reused unchanged.
// New here, because that proof drives its steps from test code and has no artifact: an immutable
// artifact store, and a driver that runs the steps for a real begin-publication and resumes them after a
// restart. Nothing here talks to Git, Cloudflare or any network service.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createFixtureExportSink, createFixturePublicationProvider } from "../publication-proof.mjs";

export const localArtifactNotice = "Local artifact only. It is not live, not production and not deployed.";
const terminal = new Set(["integrated", "deployed", "failed", "conflict"]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const pause = milliseconds => new Promise(ready => setTimeout(ready, milliseconds));
const safeId = id => typeof id === "string" && /^[A-Za-z0-9-]{1,80}$/.test(id);

async function writeFileDurable(filename, bytes) {
  const file = await open(filename, "wx", 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

/**
 * Immutable artifacts: `<id>/site/` holds the renderer's unmodified build output, beside the exact snapshot
 * and a manifest. Written to a staging directory, fsynced, then renamed into place exactly once.
 */
export function createLocalArtifactStore({ directory }) {
  const target = id => {
    if (!safeId(id)) throw new Error("Invalid local publication identity");
    return join(directory, id);
  };
  const readManifest = async id => {
    try { return JSON.parse(await readFile(join(target(id), "local-artifact.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  };
  return {
    directory,
    readManifest,
    async readSnapshot(id) { return JSON.parse(await readFile(join(target(id), "snapshot.json"), "utf8")); },
    async list() {
      try { return (await readdir(directory)).filter(name => safeId(name)); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    },
    /** Resolves a site path inside one artifact, or null when it escapes or does not exist. */
    async resolveSiteFile(id, path) {
      const parts = path.split("/").filter(Boolean);
      if (!safeId(id) || parts.some(part => part === ".." || part === "." || part.includes("\\"))) return null;
      const candidates = path.endsWith("/") || !parts.length ? [join(target(id), "site", ...parts, "index.html")]
        : [join(target(id), "site", ...parts), join(target(id), "site", ...parts, "index.html")];
      for (const filename of candidates) {
        try { if ((await stat(filename)).isFile()) return filename; } catch { /* try the next candidate */ }
      }
      return null;
    },
    async ensure({ publication, snapshot, operationKey, renderer, beforeCommit }) {
      const existing = await readManifest(publication.id);
      if (existing) {
        if (existing.snapshotId !== snapshot.id || existing.snapshotDigest !== snapshot.digest)
          throw new Error(`Local artifact ${publication.id} already exists for another snapshot; it is never overwritten.`);
        return existing;
      }
      await mkdir(directory, { recursive: true });
      const staging = join(directory, `.staging-${publication.id}-${randomUUID()}`);
      await mkdir(staging);
      try {
        const site = join(staging, "site");
        const paths = await renderer.renderArtifact(snapshot, site);
        const files = [];
        for (const path of paths) {
          const handle = await open(join(site, path), "r");
          try { files.push({ path: `site/${path}`, sha256: sha256(await handle.readFile()) }); await handle.sync(); } finally { await handle.close(); }
        }
        const snapshotBytes = Buffer.from(JSON.stringify(snapshot, null, 2));
        await writeFileDurable(join(staging, "snapshot.json"), snapshotBytes);
        files.push({ path: "snapshot.json", sha256: sha256(snapshotBytes) });
        const manifest = { kind: "zudo-composer-local-hosted-artifact", notice: localArtifactNotice,
          publicationId: publication.id, operationKey, snapshotId: snapshot.id, snapshotDigest: snapshot.digest,
          draftRevision: snapshot.draftRevision, expectedBaseline: publication.expectedBaseline,
          renderer: { ...renderer.identity, installation: renderer.location, toolSha: renderer.toolSha }, createdAt: new Date().toISOString(), files };
        await writeFileDurable(join(staging, "local-artifact.json"), Buffer.from(JSON.stringify(manifest, null, 2)));
        await syncDirectory(staging);
        await beforeCommit?.();
        await rename(staging, target(publication.id));
        await syncDirectory(directory);
        return manifest;
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    },
  };
}

/**
 * Drives one stored publication to a terminal state. Every step is idempotent and reads persisted facts
 * first, so a restart, a lost acknowledgement or a repeated (stale) notification resumes rather than
 * duplicating or regressing: remote lookup → submit → artifact → verify → local integration → reconcile.
 */
export async function createLocalPublisher({ directory, artifactsDirectory, baseline, definition, actor, openService, renderer, faults = {}, log = () => {} }) {
  const sink = await createFixtureExportSink({ directory, baseline, definition });
  const artifacts = createLocalArtifactStore({ directory: artifactsDirectory });
  const inflight = new Map();
  const errors = new Map();
  let failBuild = !!faults.failBuildOnce;
  if (faults.failExportOnce) sink.failNextExport();
  const submit = sink.submit.bind(sink);
  sink.submit = async request => {
    const operation = await submit(request);
    // Test-only: the sink persisted the export but this process dies before recording it (lost acknowledgement).
    if (faults.crashAfterRemoteSubmit) { log("fault: exiting after durable remote submit"); process.exit(75); }
    return operation;
  };
  const operationKeyFor = publicationId => `local-artifact-${publicationId}`;

  const lookup = async publicationId => {
    try { return await sink.lookup(publicationId); }
    catch (error) { if (error.code === "not-found") return null; throw error; }
  };

  async function run(publicationId) {
    const context = openService();
    try {
      const { service, storage } = context;
      const provider = createFixturePublicationProvider({ service, storage, sink });
      let publication = await service.getPublication(actor, publicationId);
      if (terminal.has(publication.status)) return publication;
      let remote = await lookup(publicationId);
      if (!remote) remote = await provider.submit(publicationId, operationKeyFor(publicationId));
      if (remote.status === "building") {
        const snapshot = await storage.readSnapshot(publication.snapshotId);
        if (!snapshot) throw new Error("The stored immutable snapshot is missing");
        await provider.synchronize(publicationId);
        try {
          await artifacts.ensure({ publication, snapshot, operationKey: operationKeyFor(publicationId), renderer, async beforeCommit() {
            if (faults.buildDelayMs) await pause(faults.buildDelayMs);
            if (failBuild) { failBuild = false; throw new Error("Injected local artifact generation failure"); }
          } });
        } catch (error) {
          publication = await service.getPublication(actor, publicationId);
          await service.recordStatus({ publicationId, snapshotId: publication.snapshotId, statusVersion: publication.statusVersion + 1,
            status: "unavailable", message: `Local artifact generation failed: ${error.message}. The saved draft and snapshot are retained; retry or restart the local host.`,
            facts: { ...publication.facts, localArtifact: "failed" } });
          throw error;
        }
        if (faults.crashAfterArtifact) { log("fault: exiting after artifact rename, before verification"); process.exit(75); }
        remote = await provider.verify(publicationId);
      }
      if (remote.status === "verified") {
        try { remote = await sink.confirmIntegration(publicationId); }
        catch (error) { if (!["baseline-conflict", "definition-conflict"].includes(error.code)) throw error; }
        if (faults.crashAfterRemoteIntegration) { log("fault: exiting after local sink integration, before reconciliation"); process.exit(75); }
      }
      return await provider.synchronize(publicationId);
    } finally { context.close(); }
  }

  const advance = publicationId => {
    if (!safeId(publicationId)) return Promise.reject(new Error("Invalid local publication identity"));
    if (inflight.has(publicationId)) return inflight.get(publicationId);
    const job = run(publicationId).then(result => { errors.delete(publicationId); return result; },
      error => { errors.set(publicationId, error.message); log(`local publication ${publicationId}: ${error.message}`); throw error; })
      .finally(() => inflight.delete(publicationId));
    inflight.set(publicationId, job);
    return job;
  };

  async function knownIds() {
    const context = openService();
    try {
      const remote = await sink.readRemote();
      const head = await context.storage.readHead();
      const ids = [...remote.operations.map(operation => operation.publicationId), ...(head.activePublicationId ? [head.activePublicationId] : []), ...await artifacts.list()];
      return [...new Set(ids)];
    } finally { context.close(); }
  }

  return {
    sink, artifacts, advance,
    /** Resume every non-terminal publication after a start or restart. */
    async recover() {
      for (const id of await knownIds()) {
        const context = openService();
        let publication;
        try { publication = await context.service.getPublication(actor, id).catch(() => null); } finally { context.close(); }
        if (publication && !terminal.has(publication.status)) await advance(id).catch(() => undefined);
      }
    },
    async list() {
      const ids = await knownIds();
      const context = openService();
      try {
        const rows = [];
        for (const id of ids) {
          const publication = await context.service.getPublication(actor, id).catch(() => null);
          if (!publication) continue;
          const manifest = await artifacts.readManifest(id);
          rows.push({ publicationId: id, snapshotId: publication.snapshotId, status: publication.status, lastProvenStatus: publication.lastProvenStatus ?? null,
            statusVersion: publication.statusVersion, message: publication.message ?? null, running: inflight.has(id), error: errors.get(id) ?? null,
            artifact: manifest ? { url: `/local-artifacts/${id}/`, snapshotDigest: manifest.snapshotDigest, createdAt: manifest.createdAt, notice: manifest.notice } : null });
        }
        return rows.reverse();
      } finally { context.close(); }
    },
    async idle() { while (inflight.size) await Promise.allSettled([...inflight.values()]); },
  };
}
