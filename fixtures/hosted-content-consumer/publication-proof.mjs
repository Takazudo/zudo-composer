// Local fixture only: a persisted synthetic remote system, never a live Git/API publisher.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalSerialize, HostedContentError } from "zudo-composer/hosted-content";
import { createFixtureSeed, createFixtureService, fixtureActor, fixtureEntry } from "./fixture-data.mjs";
import { initializeSqliteDatabase, openSqliteHandle } from "./sqlite-storage.mjs";
import { projectHostedContent } from "./renderer/src/project.ts";

const destination = "fixture:approved-course-content";
const copy = value => structuredClone(value);
const digest = value => createHash("sha256").update(canonicalSerialize(value)).digest("hex");
const identities = state => ({ draftRevision: state.draftRevision, baseline: copy(state.baseline), definition: state.definition });
const same = (left, right) => canonicalSerialize(left) === canonicalSerialize(right);
const pause = milliseconds => new Promise(ready => setTimeout(ready, milliseconds));

async function writeDurable(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2)); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, filename);
  const directory = await open(dirname(filename), "r");
  try { await directory.sync(); } finally { await directory.close(); }
}

/**
 * The directory/destination are host configuration, never submission fields.
 * A disk lock serializes separate sink instances; atomic rename + fsync persists
 * the remote facts independently of the Composer SQLite transaction.
 */
export async function createFixtureExportSink({ directory, baseline, definition, enabled = true }) {
  await mkdir(directory, { recursive: true });
  const filename = join(directory, "remote.json");
  const lock = join(directory, ".remote-lock");
  let failNext = false;
  let unavailableNext = false;
  let staleNext = false;
  const transaction = async work => {
    const deadline = Date.now() + 8_000;
    for (;;) {
      try { await mkdir(lock); break; }
      catch (error) {
        if (error.code !== "EEXIST" || Date.now() >= deadline) throw error;
        await pause(10);
      }
    }
    try {
      let database;
      try { database = JSON.parse(await readFile(filename, "utf8")); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        database = { version: 1, destination, baseline: copy(baseline), definition, operations: [] };
      }
      assert.equal(database.destination, destination, "Host destination must remain fixed");
      const result = await work(database);
      await writeDurable(filename, database);
      return copy(result);
    } finally { await rm(lock, { recursive: true }); }
  };
  // Initialization does not overwrite existing remote baseline or facts.
  await transaction(async () => undefined);
  return {
    filename,
    async readRemote() { return JSON.parse(await readFile(filename, "utf8")); },
    failNextExport() { failNext = true; },
    unavailableNextLookup() { unavailableNext = true; },
    staleNextLookup() { staleNext = true; },
    async submit(request) {
      if (!enabled) throw new HostedContentError("configuration-required", "The fixture publication provider is disabled.");
      if (!request || !same(Object.keys(request).sort(), ["expectedBaseline", "operationKey", "publicationId", "snapshot"].sort()))
        throw new HostedContentError("invalid-request", "Only bound publication inputs are accepted; destination/path fields are forbidden.");
      const input = copy(request);
      if (!input.operationKey || !input.publicationId || input.snapshot.baseline === undefined)
        throw new HostedContentError("invalid-request", "Missing publication identity.");
      if (digest({ providers: input.snapshot.providers, assets: input.snapshot.assets, renderData: input.snapshot.renderData }) !== input.snapshot.digest)
        throw new HostedContentError("invalid-request", "Export requires the original complete trusted snapshot bytes.");
      if (!same(input.expectedBaseline, input.snapshot.baseline))
        throw new HostedContentError("baseline-conflict", "Export baseline does not match its immutable snapshot.");
      const fingerprint = digest(input);
      const result = await transaction(async database => {
        const existing = database.operations.find(operation => operation.operationKey === input.operationKey || operation.publicationId === input.publicationId);
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new HostedContentError("operation-key-reuse", "Remote operation identity is already bound.");
          return existing;
        }
        const operation = { ...input, fingerprint, destination, status: failNext ? "failed" : "building", statusVersion: 2,
          message: failNext ? "Deterministic export failure before integration." : "Immutable candidate exported to the local sink." };
        failNext = false;
        database.operations.push(operation);
        return operation;
      });
      return result;
    },
    async verify(publicationId) {
      return transaction(async database => {
        const operation = database.operations.find(item => item.publicationId === publicationId);
        if (!operation) throw new HostedContentError("not-found", "Remote operation not found.");
        if (operation.status === "building") { operation.status = "verified"; operation.statusVersion++; }
        return operation;
      });
    },
    async lookup(publicationId) {
      if (unavailableNext) { unavailableNext = false; throw new Error("Fixture remote status temporarily unavailable."); }
      const operation = (await this.readRemote()).operations.find(item => item.publicationId === publicationId);
      if (!operation) throw new HostedContentError("not-found", "Remote operation not found.");
      if (staleNext) { staleNext = false; return { ...operation, status: "building", statusVersion: 2 }; }
      return operation;
    },
    async confirmIntegration(publicationId) {
      const result = await transaction(async database => {
        const operation = database.operations.find(item => item.publicationId === publicationId);
        if (!operation) throw new HostedContentError("not-found", "Remote operation not found.");
        if (operation.status === "integrated") return { operation };
        if (operation.status !== "verified") throw new HostedContentError("invalid-request", "Only a verified export may integrate.");
        const conflict = operation.snapshot.definition !== database.definition ? "definition-conflict"
          : !same(operation.expectedBaseline, database.baseline) ? "baseline-conflict" : null;
        if (conflict) {
          operation.status = "conflict"; operation.statusVersion++;
          operation.message = `Independent remote ${conflict}; the immutable candidate was retained.`;
          return { operation, conflict };
        }
        // This is a synthetic local commit identity, not a claim that a Git commit was created.
        const gitSha = createHash("sha1").update(canonicalSerialize({ destination, previous: database.baseline,
          definition: database.definition, publicationId, digest: operation.snapshot.digest })).digest("hex");
        operation.evidence = { publicationId, snapshotId: operation.snapshot.id,
          expectedBaseline: copy(operation.expectedBaseline), gitSha, contentDigest: operation.snapshot.digest };
        operation.status = "integrated"; operation.statusVersion++;
        database.baseline = { gitSha, contentDigest: operation.snapshot.digest };
        return { operation };
      });
      if (result.conflict) throw new HostedContentError(result.conflict, result.operation.message);
      return result.operation;
    },
    /** Privileged fixture control models a canonical update outside this publication. */
    async advanceExternalBaseline(next, nextDefinition = definition) {
      return transaction(async database => { database.baseline = copy(next); database.definition = nextDefinition; return database.baseline; });
    },
  };
}

/** Host-owned provider reads complete candidate bytes through its trusted adapter. */
export function createFixturePublicationProvider({ service, storage, sink }) {
  const raw = async publicationId => {
    const database = await storage.read();
    const publication = database.publications.find(item => item.id === publicationId);
    const snapshot = database.snapshots.find(item => item.id === publication?.snapshotId);
    if (!publication || !snapshot) throw new HostedContentError("not-found", "Stored publication or trusted candidate not found.");
    return { publication, snapshot };
  };
  const record = async operation => {
    const current = await service.getPublication(fixtureActor, operation.publicationId);
    const lastRemoteVersion = Number(current.facts?.remoteStatusVersion ?? 0);
    if (operation.statusVersion < lastRemoteVersion ||
      (operation.statusVersion === lastRemoteVersion && operation.status === current.status)) return current;
    // Remote version rejects old observations; local sequence also orders availability changes.
    return service.recordStatus({ publicationId: operation.publicationId,
      snapshotId: operation.snapshot.id, statusVersion: current.statusVersion + 1, status: operation.status,
      message: operation.message, facts: { provider: destination, snapshotDigest: operation.snapshot.digest,
        remoteStatusVersion: String(operation.statusVersion) } });
  };
  return {
    async submit(publicationId, operationKey) {
      const { publication, snapshot } = await raw(publicationId);
      try {
        const operation = await sink.submit({ publicationId, operationKey, snapshot, expectedBaseline: publication.expectedBaseline });
        await record(operation); return operation;
      } catch (error) {
        if (error.code === "configuration-required") await service.recordStatus({ publicationId, snapshotId: snapshot.id,
          statusVersion: publication.statusVersion + 1, status: "unavailable", message: error.message,
          facts: { provider: destination, configuration: "disabled" } });
        throw error;
      }
    },
    async verify(publicationId) { const operation = await sink.verify(publicationId); await record(operation); return operation; },
    async synchronize(publicationId) {
      let operation;
      try { operation = await sink.lookup(publicationId); }
      catch (error) {
        const { publication, snapshot } = await raw(publicationId);
        return service.recordStatus({ publicationId, snapshotId: snapshot.id, statusVersion: publication.statusVersion + 1,
          status: "unavailable", message: error.message, facts: { ...publication.facts, provider: destination } });
      }
      if (operation.status === "integrated") {
        const { publication, snapshot } = await raw(publicationId);
        if (operation.snapshot.id !== snapshot.id || operation.snapshot.digest !== snapshot.digest ||
          !same(operation.expectedBaseline, publication.expectedBaseline))
          throw new HostedContentError("baseline-conflict", "Remote evidence does not identify the stored publication.");
        await service.recordConfirmedIntegration(copy(operation.evidence));
        return service.getPublication(fixtureActor, publicationId);
      }
      return record(operation);
    },
  };
}

/** Run independently of browser availability. Returned snapshots are trusted raw delivery candidates. */
export async function runFixturePublicationProof({ directory, artifactDirectory } = {}) {
  const parent = directory ?? tmpdir(); await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "composer-publication-proof-"));
  const evidence = { node: process.version, provider: destination, system: "persisted local synthetic remote, no live Git/API",
    assertions: 0, scenarios: [], traces: [], downstreamD1: "not tested" };
  const snapshots = [];
  const check = (actual, expected, message) => { evidence.assertions++; assert.deepEqual(actual, expected, message); };
  const rejects = async (work, code) => {
    let caught; try { await work(); } catch (error) { caught = error; }
    check(caught?.code, code, `Expected ${code}`);
  };
  const scenario = async (name, execute) => {
    const path = join(root, name); await mkdir(path);
    const seed = createFixtureSeed(); const filename = join(path, "content.sqlite");
    await initializeSqliteDatabase(filename, seed);
    const handles = new Set();
    const openContext = () => {
      const handle = openSqliteHandle(filename); handles.add(handle);
      const service = createFixtureService(handle.storage, projectHostedContent);
      return { handle, service, provider: null };
    };
    const sinkOptions = { directory: join(path, "remote"), baseline: seed.state.baseline, definition: seed.state.definition };
    let sink = await createFixtureExportSink(sinkOptions);
    let context = openContext();
    const connect = () => { context.provider = createFixturePublicationProvider({ service: context.service, storage: context.handle.storage, sink }); };
    connect();
    const restart = async () => {
      for (const handle of handles) handle.close(); handles.clear();
      sink = await createFixtureExportSink(sinkOptions); context = openContext(); connect(); return context;
    };
    try { await execute({ context, sink, restart, openContext, sinkOptions }); evidence.scenarios.push(name); }
    finally { for (const handle of handles) handle.close(); }
  };
  const save = (service, state, key, value, target = fixtureEntry) => service.execute(fixtureActor,
    { kind: "set-fields", operationKey: key, expected: identities(state), entry: target,
      values: target.modelId === "faq" ? { question: value } : { title: value }, clear: [] });
  const captureBegin = async (context, state, suffix) => {
    const captured = await context.service.execute(fixtureActor, { kind: "capture-snapshot", operationKey: `capture-${suffix}`, expected: identities(state) });
    const snapshot = (await context.handle.storage.read()).snapshots.find(item => item.id === captured.snapshot.id);
    const begun = await context.service.execute(fixtureActor, { kind: "begin-publication", operationKey: `begin-${suffix}`,
      expected: identities(state), snapshotId: snapshot.id });
    return { snapshot, publication: begun.publication };
  };
  try {
    for (const newlyCreated of [false, true]) {
      await scenario(newlyCreated ? "two-publications-new-entry" : "two-publications-existing-entry", async ({ context, sink, restart, openContext }) => {
        const initial = await context.service.readState(fixtureActor);
        let target = fixtureEntry;
        const savedA = newlyCreated ? await context.service.execute(fixtureActor, { kind: "create-entry", operationKey: "save-a",
          expected: identities(initial), collectionId: "questions", values: { question: "新規の質問A", answer: "新規の回答" }, before: null })
          : await save(context.service, initial, "save-a", "講座A");
        if (newlyCreated) target = savedA.createdEntry;
        const A = await captureBegin(context, savedA.state, "a");
        const originalA = copy(A.snapshot);
        const exported = await context.provider.submit(A.publication.id, "remote-a");
        check(exported.snapshot, originalA, "Provider exports complete original trusted candidate");
        check(exported.snapshot.providers[0].entries.find(entry => entry.id === "home").values.slug,
          "fixed-home", "Export uses complete protected canonical values from the trusted adapter");
        check(exported.destination, destination, "Destination is fixed host configuration");
        await context.provider.verify(A.publication.id);
        const independent = openContext();
        const savedB = await save(independent.service, savedA.state, "save-b", newlyCreated ? "新規の質問B" : "講座B", target);
        check((await context.handle.storage.read()).snapshots.find(item => item.id === A.snapshot.id), originalA, "B save cannot mutate candidate A");
        const remoteA = await sink.confirmIntegration(A.publication.id);
        check((await sink.readRemote()).baseline, { gitSha: remoteA.evidence.gitSha, contentDigest: A.snapshot.digest }, "Remote integration persists before database reconciliation");
        check((await context.service.readState(fixtureActor)).baseline, initial.baseline, "Crash gap leaves database baseline at B0");
        context = await restart();
        await context.provider.synchronize(A.publication.id);
        const afterA = await context.service.readState(fixtureActor);
        const field = newlyCreated ? "question" : "title";
        const currentEntry = afterA.providers[0].entries.find(entry => entry.id === target.recordId);
        check(currentEntry.values[field], newlyCreated ? "新規の質問B" : "講座B", "Remote recovery advances A while preserving latest B");
        check(afterA.baseline, { gitSha: remoteA.evidence.gitSha, contentDigest: A.snapshot.digest }, "Recovered baseline B1 is exact remote A");
        check(afterA.integrationFence, 1, "Remote recovery reconciles exactly once");
        check((await context.service.readReceipt(fixtureActor, "save-b")).result, savedB, "B receipt survives remote/database crash gap");
        if (newlyCreated) check(currentEntry.lifecycle, "draft", "Newer created Entry B remains a working draft");
        const B = await captureBegin(context, afterA, "b");
        const deliveredB = B.snapshot.providers[0].entries.find(entry => entry.id === target.recordId);
        check(deliveredB.values[field], currentEntry.values[field], "Second immutable candidate includes latest B");
        if (newlyCreated) {
          check(deliveredB.lifecycle, "published", "Delivery B includes still-draft created Entry");
          check(B.snapshot.renderData.questions.some(question => question.id === target.recordId && question.question === "新規の質問B"), true,
            "Same fixed host projection includes created Entry B");
        }
        const operationB = await context.provider.submit(B.publication.id, "remote-b");
        await context.provider.verify(B.publication.id);
        // A newly opened sink reads the independently persisted B1; it cannot trust SQLite's guess.
        const reopenedSink = await createFixtureExportSink({ directory: dirname(sink.filename), baseline: initial.baseline, definition: initial.definition });
        const remoteB = await reopenedSink.confirmIntegration(B.publication.id);
        await context.provider.synchronize(B.publication.id);
        const afterB = await context.service.readState(fixtureActor);
        check(afterB.baseline, { gitSha: remoteB.evidence.gitSha, contentDigest: B.snapshot.digest }, "B2 matches independently persisted remote B");
        check(afterB.integrationFence, 2, "Two remote integrations advance fence twice");
        check((await reopenedSink.readRemote()).operations.length, 2, "Restart/recovery never duplicates a blind remote publication");
        check(await reopenedSink.submit({ publicationId: A.publication.id, operationKey: "remote-a", snapshot: originalA,
          expectedBaseline: A.publication.expectedBaseline }), remoteA, "Exact remote A retry returns original fact after remote B2 advanced");
        await context.service.recordConfirmedIntegration(remoteA.evidence);
        await context.service.recordStatus({ publicationId: A.publication.id, snapshotId: A.snapshot.id, statusVersion: 999, status: "building" });
        check(await context.service.readState(fixtureActor), afterB, "Late A integration/status cannot regress baseline or clean newer work");
        check((await context.service.getPublication(fixtureActor, A.publication.id)).status, "integrated", "Late A status never claims building after integration");
        check((await context.handle.storage.read()).snapshots.find(item => item.id === A.snapshot.id), originalA, "Original complete candidate A stays immutable through two integrations");
        check(operationB.snapshot, B.snapshot, "Remote export B uses exact candidate B bytes");
        const name = newlyCreated ? "new-entry" : "existing-entry";
        snapshots.push({ scenario: name, A: originalA, B: B.snapshot, target });
        evidence.traces.push({ scenario: name, snapshotA: A.snapshot.id, digestA: A.snapshot.digest, snapshotB: B.snapshot.id,
          digestB: B.snapshot.digest, baseline1: afterA.baseline, baseline2: afterB.baseline, databaseReopenedBeforeReconciliation: true });
      });
    }

    await scenario("export-failure-retains-draft", async ({ context, sink }) => {
      const saved = await save(context.service, await context.service.readState(fixtureActor), "failure-save", "保存済みの講座");
      const { snapshot, publication } = await captureBegin(context, saved.state, "failure");
      sink.failNextExport(); const failed = await context.provider.submit(publication.id, "remote-failed");
      check(failed.status, "failed", "Export failure is a persisted provider fact");
      check((await context.service.getPublication(fixtureActor, publication.id)).status, "failed", "Export failure reports failed without live/deployed claim");
      check((await context.service.readState(fixtureActor)), saved.state, "Export failure retains durable draft");
      check((await context.handle.storage.read()).snapshots[0], snapshot, "Export failure retains immutable candidate");
      check((await sink.readRemote()).baseline, saved.state.baseline, "Failed export cannot advance remote baseline");
    });

    await scenario("unavailable-and-stale-status", async ({ context, sink }) => {
      const saved = await save(context.service, await context.service.readState(fixtureActor), "unavailable-save", "保存済み");
      const { publication } = await captureBegin(context, saved.state, "unavailable");
      await context.provider.submit(publication.id, "remote-unavailable"); await context.provider.verify(publication.id);
      sink.unavailableNextLookup(); const unavailable = await context.provider.synchronize(publication.id);
      check(unavailable.status, "unavailable", "Unavailable lookup reports uncertainty rather than false failure/integration");
      check(unavailable.lastProvenStatus, "verified", "Unavailable status retains last proven verified stage");
      sink.staleNextLookup(); const stale = await context.provider.synchronize(publication.id);
      check(stale, unavailable, "Stale remote poll cannot regress state to building");
      const fresh = await context.provider.synchronize(publication.id);
      check(fresh.status, "verified", "Fresh authoritative lookup restores proven stage after temporary outage");
      check(fresh.statusVersion > unavailable.statusVersion, true, "Availability recovery uses monotonic local status sequence");
      check(await context.service.readState(fixtureActor), saved.state, "Unavailable/stale status retains draft");
    });

    await scenario("disabled-provider-and-forbidden-destination", async ({ context, sink, sinkOptions }) => {
      const saved = await save(context.service, await context.service.readState(fixtureActor), "disabled-save", "保持された講座");
      const { snapshot, publication } = await captureBegin(context, saved.state, "disabled");
      const disabled = await createFixtureExportSink({ ...sinkOptions, enabled: false });
      const provider = createFixturePublicationProvider({ service: context.service, storage: context.handle.storage, sink: disabled });
      await rejects(() => provider.submit(publication.id, "remote-disabled"), "configuration-required");
      const state = await context.service.getPublication(fixtureActor, publication.id);
      check(state.status, "unavailable", "Disabled provider exposes unavailable configuration truth");
      check(state.facts.configuration, "disabled", "Disabled configuration is an explicit provider fact");
      check((await disabled.readRemote()).operations.length, 0, "Disabled provider does not export remotely");
      await rejects(() => sink.submit({ publicationId: publication.id, operationKey: "forged-destination", snapshot,
        expectedBaseline: publication.expectedBaseline, destination: "https://forged.example.invalid" }), "invalid-request");
      check(await context.service.readState(fixtureActor), saved.state, "Disabled/forbidden destination retains draft");
    });

    await scenario("independent-external-baseline-conflict", async ({ context, sink }) => {
      const saved = await save(context.service, await context.service.readState(fixtureActor), "external-save", "競合でも保持");
      const { snapshot, publication } = await captureBegin(context, saved.state, "external");
      await context.provider.submit(publication.id, "remote-external"); await context.provider.verify(publication.id);
      const external = { gitSha: "e".repeat(40), contentDigest: "external-canonical-content" };
      await sink.advanceExternalBaseline(external);
      await rejects(() => sink.confirmIntegration(publication.id), "baseline-conflict");
      await context.provider.synchronize(publication.id);
      check((await context.service.getPublication(fixtureActor, publication.id)).status, "conflict", "Independent canonical base conflict is recoverable provider truth");
      check(await context.service.readState(fixtureActor), saved.state, "External canonical conflict retains draft and original known baseline");
      check((await context.handle.storage.read()).snapshots[0], snapshot, "External canonical conflict retains exact reviewed candidate");
      check((await sink.readRemote()).baseline, external, "Remote CAS never overwrites outside canonical update");
    });

    if (artifactDirectory) {
      await mkdir(artifactDirectory, { recursive: true });
      for (const trace of snapshots) for (const label of ["A", "B"])
        await writeDurable(join(artifactDirectory, `${trace.scenario}-${label}.snapshot.json`), trace[label]);
      await writeDurable(join(artifactDirectory, "publication-evidence.json"), evidence);
    }
    return { evidence, snapshots };
  } finally { if (!directory) await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
  const result = await runFixturePublicationProof({ directory: option("--directory"), artifactDirectory: option("--artifacts") });
  console.log(JSON.stringify(result.evidence, null, 2));
}
