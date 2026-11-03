// Local Worker/D1 binding proof. Every storage call below goes to a real D1 binding implemented by the pinned
// local workerd (Miniflare), with state persisted on disk. "restart" disposes the workerd process and starts a
// new one on the same directory. This is local evidence only: no Cloudflare account, remote binding or
// production D1 is involved, and some production network failures cannot be reproduced locally.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { createHostedContentService } from "zudo-composer/hosted-content";
import {
  createHostedContentConformancePolicy, createHostedContentConformanceSeed, hostedConformanceDigest, runHostedContentConformance,
} from "zudo-composer/hosted-content/testing";
import { ARTICLE_HOST_TABLES, initializeArticleD1 } from "./article-cms/d1-article.mjs";
import {
  D1_SCHEMA_VERSION, D1_TABLE_DEFINITIONS, HostedD1Error, classifyD1Database, createD1HostedStorage, createD1ProposalStore, dumpD1Database,
  initializeD1Database, snapshotD1Database,
} from "./d1-storage.mjs";
import { localRuntimeVersions, startD1Runtime } from "./d1-runtime.mjs";

const actor = { id: "allowed-editor" };
const lesson = { providerId: "content", modelId: "lesson", recordId: "lesson-entry" };
const identity = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
const edit = (state, operationKey, title) => ({ kind: "set-fields", operationKey, expected: identity(state), entry: lesson, values: { title }, clear: [] });
const titleOf = state => state.providers[0].entries.find(entry => entry.id === lesson.recordId).values.title;

const gate = () => {
  let entered, release;
  const enteredPromise = new Promise(done => { entered = done; });
  const wait = new Promise(done => { release = done; });
  return { held: { entered, wait }, public: { entered: enteredPromise, release } };
};

/** Proof-only hooks: they decide which fault the next commit receives and never touch a service response. */
function proofHooks() {
  let fault, held, delayed, last;
  return {
    hooks: {
      takeFault() { const value = fault; fault = undefined; return value; },
      takeGate() { const value = held; held = undefined; return value; },
      takeSubmitDelay() { const value = delayed; delayed = undefined; return value; },
      submitted(promise) { last = promise; promise.catch(() => undefined); },
    },
    fault(next) { fault = next; },
    hold() { const created = gate(); held = created.held; return created.public; },
    delaySubmit() { const created = gate(); delayed = created.held; return created.public; },
    lastSubmission: () => last,
  };
}

/** The public conformance factory over a real local D1 binding, with an actual runtime restart. */
export function createLocalD1ConformanceFactory({ directory, keepFiles = false, log = [] } = {}) {
  return {
    async create(seed, scenario) {
      const parent = directory ?? tmpdir();
      await mkdir(parent, { recursive: true });
      const root = await mkdtemp(join(parent, `composer-d1-${scenario}-`));
      let runtime = await startD1Runtime({ persist: root });
      await initializeD1Database(await runtime.database(), seed);
      let generation = 0, disposed = false;
      return {
        root,
        async open() {
          if (disposed) throw new Error("D1 conformance backend is closed");
          const openedAt = generation;
          // Every handle gets its own binding proxy and adapter instance; no state is shared in JavaScript.
          const db = await runtime.database();
          const proof = proofHooks();
          const storage = createD1HostedStorage(db, { proof: proof.hooks });
          const check = () => { if (disposed || openedAt !== generation) throw new Error("D1 handle belongs to a stopped runtime"); };
          const guarded = Object.fromEntries(Object.entries(storage).map(([name, method]) => [name, async (...args) => { check(); return method(...args); }]));
          return { storage: guarded, faultNextCommit(next) { check(); proof.fault(next); }, holdNextCommit() { check(); return proof.hold(); },
            async dump() { check(); return dumpD1Database(db); } };
        },
        async restart() {
          generation++;
          await runtime.dispose();
          log.push(`${scenario}: workerd stopped and restarted on ${root}`);
          // Reopen without initialization: the persisted D1 state must already hold the site.
          runtime = await startD1Runtime({ persist: root });
        },
        async close() {
          generation++; disposed = true;
          await runtime.dispose();
          if (!keepFiles) await rm(root, { recursive: true, force: true });
        },
      };
    },
  };
}

function conformanceService(storage, name) {
  let next = 0;
  return createHostedContentService({ siteId: "conformance", definition: "definition-v1", policy: createHostedContentConformancePolicy(), storage,
    authorize(who) { if (who.id !== actor.id) throw new Error("Unauthorized fixture actor"); },
    digest: hostedConformanceDigest, createId: () => `${name}-${++next}`, now: () => "2026-01-01T00:00:00.000Z",
    project: (providers, assets) => structuredClone({ providers, assets }), validateSubmission: () => undefined });
}

const isGuardRefusal = message => /NOT NULL constraint failed: hosted_commit_guard\.ok/.test(message);

async function expectError(work, predicate, message) {
  let error;
  try { await work(); } catch (caught) { error = caught; }
  assert.ok(error && predicate(error), `${message}: received ${error?.stack ?? error}`);
  return error;
}

/** D1-specific cases beyond the shared runner: storage-level refusals, faults, uncertainty, restart and proposals. */
export async function runD1SpecificProof({ directory }) {
  const results = [];
  let assertions = 0;
  const check = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
  const ok = (value, message) => { assertions++; assert.ok(value, message); };
  const root = await mkdtemp(join(directory, "composer-d1-specific-"));
  const persist = join(root, "state");
  let runtime = await startD1Runtime({ persist });
  const db = async () => runtime.database();
  try {
    const first = await initializeD1Database(await db(), createHostedContentConformanceSeed());
    check(first.seeded, true, "an absent database is seeded");
    const proof = proofHooks();
    let storage = createD1HostedStorage(await db(), { proof: proof.hooks });
    let service = conformanceService(storage, "specific");
    const saved = await service.execute(actor, edit(await service.readState(actor), "save-1", "Saved once"));
    results.push({ case: "initialize-and-save", proves: "explicit schema initialization seeds only an absent site; a service write commits through one batch" });

    // Zero-row head UPDATE: the guard aborts the batch, so the receipt and revision that follow never commit.
    const head = await storage.readHead(), before = await dumpD1Database(await db());
    const changed = structuredClone(head); changed.version = "next"; changed.state.draftRevision = "never";
    const revision = (await storage.listRevisions(lesson, { limit: 1 }))[0];
    const receipt = { actorId: actor.id, operationKey: "stale-write", fingerprint: "f", result: { state: changed.state } };
    check(await storage.commit({ expectedVersion: "stale", head: changed, receipt, revisions: [{ ...revision, id: "fresh-revision", sequence: revision.sequence + 1 }] }), false, "stale head is refused");
    check(await dumpD1Database(await db()), before, "a zero-row head UPDATE lets nothing that follows commit");
    // Duplicate revision identity and duplicate per-entry sequence roll back the head CAS and receipt too.
    check(await storage.commit({ expectedVersion: head.version, head: changed, receipt, revisions: [{ ...revision, sequence: revision.sequence + 1 }] }), false, "duplicate revision id is refused");
    check(await storage.commit({ expectedVersion: head.version, head: changed, receipt, revisions: [{ ...revision, id: "fresh-revision" }] }), false, "duplicate entry sequence is refused");
    check(await dumpD1Database(await db()), before, "duplicate revision id/sequence roll back head and receipt completely");
    results.push({ case: "conditional-refusals", proves: "stale CAS, duplicate revision id and duplicate (entry, sequence) each refuse the whole batch with no writes" });

    // Missing head: the precondition guard refuses before any write, so no receipt, snapshot, revision or publication is orphaned.
    const orphanRoot = await mkdtemp(join(root, "missing-head-"));
    const orphanRuntime = await startD1Runtime({ persist: orphanRoot });
    try {
      const orphanDb = await orphanRuntime.database();
      await initializeD1Database(orphanDb, createHostedContentConformanceSeed());
      await orphanDb.prepare("DELETE FROM hosted_head").run();
      const orphanBefore = await snapshotD1Database(orphanDb);
      const seedHead = { version: "orphan-next", state: changed.state, baselineProviders: [], activePublicationId: null };
      const snapshotRow = { id: "orphan-snapshot", draftRevision: "r0" }, publicationRow = { id: "orphan-publication", snapshotId: "orphan-snapshot", status: "submitted", statusVersion: 1 };
      for (const [label, expectedVersion] of [["seed version", "seed"], ["any version", "anything"]]) {
        check(await createD1HostedStorage(orphanDb).commit({ expectedVersion, head: seedHead, receipt, snapshot: snapshotRow, publication: publicationRow,
          revisions: [{ ...revision, id: "orphan-revision", sequence: revision.sequence + 1 }] }), false, `a commit against a missing head (${label}) is refused`);
        check(await snapshotD1Database(orphanDb), orphanBefore, `a refused commit against a missing head (${label}) leaves every table unchanged`);
      }
    } finally { await orphanRuntime.dispose(); }
    // The postcondition guard is real D1 behavior: after a zero-row UPDATE, changes() is 0 and the guard aborts the batch.
    const zeroRowBefore = await dumpD1Database(await db());
    const zeroRow = await (await db()).batch([
      (await db()).prepare("UPDATE hosted_head SET version = 'never' WHERE id = 1 AND version = 'no-such-version'"),
      (await db()).prepare("INSERT INTO hosted_commit_guard (ok) SELECT NULL WHERE changes() <> 1"),
      (await db()).prepare("INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES ('allowed-editor', 'after-zero-row', 'f', '{}')"),
    ]).then(() => "committed", error => error.message);
    ok(isGuardRefusal(zeroRow), `changes() after a zero-row UPDATE aborts the batch in local D1 (${zeroRow})`);
    check(await dumpD1Database(await db()), zeroRowBefore, "nothing after the zero-row UPDATE committed");
    results.push({ case: "missing-head-and-row-count-guard", proves: "with no head row every commit is refused and no record is orphaned; the changes() postcondition aborts a batch whose UPDATE matched zero rows" });

    // An actual SQL statement failure after the head UPDATE: a storage failure, not a conflict, and nothing persists.
    proof.fault("receipt-persistence");
    const failure = await expectError(() => service.execute(actor, edit(saved.state, "sql-failure", "Must not persist")), error => error instanceof HostedD1Error && error.outcome === "failed", "SQL failure is a storage failure");
    ok(/CHECK constraint failed/.test(failure.message), "the real D1 CHECK failure is kept in the diagnostic");
    check(await dumpD1Database(await db()), before, "SQL failure after the head write rolls back head, receipt and revision together");
    check(await storage.readReceipt(actor.id, "sql-failure"), null, "no receipt after a failed batch");
    results.push({ case: "sql-failure-after-head", proves: "a real CHECK failure placed right after the head UPDATE aborts the batch; reported as HostedD1Error(failed), never revision-conflict", diagnostic: failure.message });

    // Lost response after a durable batch: the caller sees an unknown outcome; the same key recovers once.
    proof.fault("lost-acknowledgement");
    const lostRequest = edit(saved.state, "lost-ack", "Committed but unacknowledged");
    await expectError(() => service.execute(actor, lostRequest), error => error instanceof HostedD1Error && error.outcome === "unknown", "lost acknowledgement is an unknown outcome");
    const lostReceipt = await service.readReceipt(actor, "lost-ack");
    ok(lostReceipt, "the durable batch left its receipt");
    const revisionsBefore = (await dumpD1Database(await db())).revisions.length;
    check(await service.execute(actor, structuredClone(lostRequest)), lostReceipt.result, "exact retry returns the original result");
    check((await dumpD1Database(await db())).revisions.length, revisionsBefore, "recovery adds no revision");
    await expectError(() => service.execute(actor, { ...lostRequest, values: { title: "Different request" } }), error => error.code === "operation-key-reuse", "a reused key with a different request is refused");
    results.push({ case: "lost-acknowledgement", proves: "a response lost after the D1 batch completed recovers through its receipt exactly once; a different request under that key is refused" });

    // Uncertain outcome: the adapter stops waiting, but the batch is still in flight and commits later.
    const slowProof = proofHooks();
    const slow = createD1HostedStorage(await db(), { timeoutMs: 150, proof: slowProof.hooks });
    const slowService = conformanceService(slow, "slow");
    const state = (await slowService.readState(actor));
    const held = slowProof.delaySubmit();
    const uncertainRequest = edit(state, "uncertain", "Committed after the wait timed out");
    const timedOut = await expectError(() => slowService.execute(actor, uncertainRequest), error => error instanceof HostedD1Error && error.outcome === "unknown", "a timed-out wait is an unknown outcome");
    check(await slowService.readReceipt(actor, "uncertain"), null, "nothing committed yet: the outcome is still pending, not a failure");
    held.release();
    await slowProof.lastSubmission();
    const late = await slowService.readReceipt(actor, "uncertain");
    ok(late, "the timed-out batch committed later; the timeout did not cancel it");
    const countLate = (await dumpD1Database(await db())).revisions.length;
    check(await slowService.execute(actor, structuredClone(uncertainRequest)), late.result, "the same operation identity recovers the later committed result");
    check((await dumpD1Database(await db())).revisions.length, countLate, "no duplicate revision after the uncertain recovery");
    // A retry that wins while the first submission is still in flight: the late batch is refused by CAS and receipt key.
    const raceProof = proofHooks();
    const raceStorage = createD1HostedStorage(await db(), { timeoutMs: 150, proof: raceProof.hooks });
    const raceService = conformanceService(raceStorage, "race");
    const raceState = await raceService.readState(actor);
    const raceHold = raceProof.delaySubmit();
    const raceRequest = edit(raceState, "uncertain-race", "Retried while in flight");
    await expectError(() => raceService.execute(actor, raceRequest), error => error instanceof HostedD1Error && error.outcome === "unknown", "first attempt times out");
    const retried = await conformanceService(createD1HostedStorage(await db()), "race-retry").execute(actor, structuredClone(raceRequest));
    raceHold.release();
    const lateOutcome = await raceProof.lastSubmission().then(() => "committed", error => error.message);
    ok(/constraint failed/.test(lateOutcome), `the in-flight original is refused after the retry won (${lateOutcome})`);
    check((await raceService.readReceipt(actor, "uncertain-race")).result, retried, "exactly one result exists for the operation");
    check((await dumpD1Database(await db())).revisions.filter(item => item.operation.key === "uncertain-race").length, 1, "exactly one revision for the operation");
    results.push({ case: "uncertain-timeout", proves: "a D1 wait that times out reports an unknown outcome, the write still commits later and is recovered under the same key; a retry that wins first makes the late original refuse", diagnostic: timedOut.message });

    // Local limit refusal before any write; one command is never split across batches.
    const current = await storage.readHead(), huge = structuredClone(current); huge.version = "huge";
    huge.state.providers[0].entries[0].values.title = "x".repeat(2_100_000);
    const limitBefore = await dumpD1Database(await db());
    await expectError(() => storage.commit({ expectedVersion: current.version, head: huge }), error => error instanceof HostedD1Error && error.outcome === "limit", "oversized row refused locally");
    check(await dumpD1Database(await db()), limitBefore, "a refused oversized commit writes nothing");
    results.push({ case: "limit-refusal", proves: "a row over D1's 2,000,000-byte limit is refused before submission; atomicity is not weakened by splitting" });

    // Proposals: create-only, owner-bound, and durable across a runtime restart.
    const owner = "article-cms:site:proof";
    const proposals = createD1ProposalStore(await db(), { owner });
    const record = { schemaVersion: 1, owner, actorId: actor.id, proposal: { id: "proposal-1", createdAt: "2026-01-01T00:00:00.000Z" } };
    await proposals.create(record);
    await expectError(() => proposals.create(record), error => error.code === "operation-key-reuse", "a proposal id is create-only");
    await expectError(() => proposals.create({ ...record, owner: "other", proposal: { ...record.proposal, id: "proposal-2" } }), error => error.code === "forbidden", "another owner is refused");
    check(await createD1ProposalStore(await db(), { owner: "other-site" }).read("proposal-1"), null, "another owner cannot read the proposal");
    const contentBefore = await dumpD1Database(await db());

    // Runtime disposed while a batch is in flight: after reopen, the commit is all or nothing.
    let sent; const submittedBatch = new Promise(done => { sent = done; });
    const crashStorage = createD1HostedStorage(await db(), { proof: { submitted(promise) { promise.catch(() => undefined); sent(); } } });
    const crashService = conformanceService(crashStorage, "crash");
    const crashState = await crashService.readState(actor);
    const inFlight = crashService.execute(actor, edit(crashState, "crash-in-flight", "Maybe committed")).then(() => "acknowledged", error => `unacknowledged: ${error.message}`);
    // Stop the runtime only once the batch has actually been submitted to D1.
    await submittedBatch;
    await runtime.dispose();
    const crashOutcome = await inFlight;
    runtime = await startD1Runtime({ persist });
    storage = createD1HostedStorage(await db());
    service = conformanceService(storage, "after-restart");
    const reopened = await dumpD1Database(await db());
    const crashReceipt = reopened.receipts.find(item => item.operationKey === "crash-in-flight");
    const crashRevisions = reopened.revisions.filter(item => item.operation.key === "crash-in-flight");
    check(Boolean(crashReceipt), crashRevisions.length === 1 && titleOf(reopened.state) === "Maybe committed", "receipt, revision and head committed together or not at all");
    if (crashOutcome === "acknowledged") ok(crashReceipt, "an acknowledged commit survived the stop");
    results.push({ case: "runtime-stop-during-batch", proves: "stopping workerd with a batch in flight leaves head, receipt and revision all present or all absent after reopen", observed: { acknowledgement: crashOutcome, committed: Boolean(crashReceipt) } });

    // Restart reopened persisted state without a seed; a repeated initialization does not reset it.
    const again = await initializeD1Database(await db(), createHostedContentConformanceSeed());
    check(again.seeded, false, "repeated startup never reseeds");
    check(await dumpD1Database(await db()), reopened, "repeated initialization leaves data unchanged");
    ok(reopened.receipts.some(item => item.operationKey === "lost-ack"), "receipts survived the runtime restart");
    check(titleOf(contentBefore.state) === titleOf(reopened.state) || Boolean(crashReceipt), true, "content survived the runtime restart");
    check((await createD1ProposalStore(await db(), { owner }).read("proposal-1"))?.proposal.id, "proposal-1", "the proposal survived the runtime restart");
    results.push({ case: "runtime-restart", proves: "a new workerd process on the same directory reads the site, receipts and proposals without seeding; re-initialization is a no-op", persist });

    return { results, assertions, persist };
  } finally {
    await runtime.dispose().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}

const conformanceSeedWithTitle = title => { const seed = createHostedContentConformanceSeed(); seed.state.providers[0].entries[0].values.title = title; return seed; };

/**
 * Initialization against real local D1 databases, one runtime per case. Every refusal compares complete
 * before/after snapshots: all schema objects with their definitions and every table's rows.
 * `initialize` is the initializer under test (the default is the current one).
 */
export async function runD1InitializationProof({ directory, initialize = initializeD1Database }) {
  const root = await mkdtemp(join(directory, "composer-d1-init-"));
  const cases = [];
  let assertions = 0;
  const check = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
  const run = async (name, proves, work) => {
    const persist = join(root, name);
    let runtime = await startD1Runtime({ persist });
    const context = { persist, db: () => runtime.database(), async restart() { await runtime.dispose(); runtime = await startD1Runtime({ persist }); } };
    try { cases.push({ case: name, proves, passed: true, observed: await work(context) }); }
    catch (error) { cases.push({ case: name, proves, passed: false, failure: error.message }); }
    finally { await runtime.dispose().catch(() => undefined); }
  };
  const refusedUnchanged = async (db, label, options) => {
    const before = await snapshotD1Database(db);
    const outcome = await initialize(db, createHostedContentConformanceSeed(), options).then(result => `accepted ${JSON.stringify(result)}`, error => error);
    check(outcome instanceof HostedD1Error && outcome.outcome === "incompatible", true, `${label}: refused as incompatible (${outcome?.message ?? outcome})`);
    check(await snapshotD1Database(db), before, `${label}: schema objects, definitions and every row are unchanged`);
    return { refusal: outcome.message, objects: before.schema.map(object => `${object.type} ${object.name}`) };
  };
  const exec = async (db, ...sql) => db.batch(sql.map(text => db.prepare(text)));
  const definitions = D1_TABLE_DEFINITIONS;

  await run("empty", "a database with no application objects is created and seeded in one batch", async ({ db }) => {
    check((await snapshotD1Database(await db())).schema.filter(object => object.name !== "_cf_METADATA"), [], "the database starts empty");
    check((await initialize(await db(), createHostedContentConformanceSeed())).seeded, true, "an empty database is seeded");
    check((await classifyD1Database(await db())).kind, "current", "the result is a complete current store");
    check((await dumpD1Database(await db())).state, createHostedContentConformanceSeed().state, "the store holds exactly the seed");
  });
  await run("populated-reopen-and-restart", "a valid populated store reopens without any write, before and after a workerd restart", async (context) => {
    await initialize(await context.db(), createHostedContentConformanceSeed());
    const service = conformanceService(createD1HostedStorage(await context.db()), "init");
    await service.execute(actor, edit(await service.readState(actor), "init-save", "Populated"));
    await createD1ProposalStore(await context.db(), { owner: "init-owner" }).create({ schemaVersion: 1, owner: "init-owner", actorId: actor.id, proposal: { id: "init-proposal", createdAt: "2026-01-01T00:00:00.000Z" } });
    const populated = await snapshotD1Database(await context.db());
    check((await initialize(await context.db(), createHostedContentConformanceSeed())).seeded, false, "a repeated start does not seed");
    check(await snapshotD1Database(await context.db()), populated, "a repeated start changes no schema object and no row");
    await context.restart();
    check((await initialize(await context.db(), conformanceSeedWithTitle("Different seed"))).seeded, false, "a restart does not seed, even with another seed");
    check(await snapshotD1Database(await context.db()), populated, "after a workerd restart every row, receipt and proposal is unchanged");
    return { rows: Object.fromEntries(Object.entries(populated.tables).map(([name, list]) => [name, list.length])) };
  });
  await run("older-marker-only", "an older marker table with no other tables is refused; no table is created", async ({ db }) => {
    await exec(await db(), definitions.hosted_schema, "INSERT INTO hosted_schema (id, version) VALUES (1, 'hosted-d1-v0')");
    return refusedUnchanged(await db(), "older marker only");
  });
  await run("older-marker-with-data", "an older store with its own tables and records is refused; nothing is added or rewritten", async ({ db }) => {
    await exec(await db(), definitions.hosted_schema, "INSERT INTO hosted_schema (id, version) VALUES (1, 'hosted-d1-v0')",
      "CREATE TABLE hosted_head (id INTEGER PRIMARY KEY, version TEXT, state TEXT)", "INSERT INTO hosted_head VALUES (1, 'old', '{\"title\":\"old\"}')",
      "CREATE TABLE hosted_receipt (actor_id TEXT, operation_key TEXT, result TEXT)", "INSERT INTO hosted_receipt VALUES ('editor', 'old-key', '{}')");
    return refusedUnchanged(await db(), "older marker with data");
  });
  await run("unrelated-user-tables", "unrelated tables, an index and records without any marker are refused; no marker is stamped", async ({ db }) => {
    await exec(await db(), "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)", "CREATE INDEX notes_body ON notes (body)",
      "INSERT INTO notes (body) VALUES ('keep me'), ('and me')");
    return refusedUnchanged(await db(), "unrelated user tables");
  });
  await run("malformed-marker", "a marker table with the current version string but the wrong structure is refused", async ({ db }) => {
    await exec(await db(), "CREATE TABLE hosted_schema (version TEXT)", `INSERT INTO hosted_schema (version) VALUES ('${D1_SCHEMA_VERSION}')`);
    return refusedUnchanged(await db(), "malformed marker");
  });
  await run("current-marker-incompatible-constraints", "every table and the current marker, but hosted_revision without its unique sequence constraint, is refused", async ({ db }) => {
    const weakened = definitions.hosted_revision.replace(",\n    UNIQUE (provider_id, model_id, record_id, sequence)", "");
    assert.notEqual(weakened, definitions.hosted_revision, "the fixture really drops the constraint");
    await exec(await db(), ...Object.entries(definitions).map(([name, sql]) => name === "hosted_revision" ? weakened : sql),
      `INSERT INTO hosted_schema (id, version) VALUES (1, '${D1_SCHEMA_VERSION}')`,
      "INSERT INTO hosted_head (id, version, state, baseline_providers) VALUES (1, 'seed', '{}', '[]')");
    return refusedUnchanged(await db(), "current marker with incompatible constraints");
  });
  await run("current-structure-without-head", "a complete current structure whose head row is missing (an incomplete store) is refused, never reset or completed", async ({ db }) => {
    await exec(await db(), ...Object.values(definitions), `INSERT INTO hosted_schema (id, version) VALUES (1, '${D1_SCHEMA_VERSION}')`,
      "INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES ('editor', 'left-behind', 'f', '{}')");
    return refusedUnchanged(await db(), "current structure without a head");
  });
  await run("host-table-required", "a core-only store is refused by a host that declares its own table; nothing is added", async ({ db }) => {
    await initialize(await db(), createHostedContentConformanceSeed());
    return refusedUnchanged(await db(), "core store opened by the Article host", { hostTables: ARTICLE_HOST_TABLES });
  });
  await run("host-table-preserved", "a current Article store with an artifact row reopens with the artifact preserved", async ({ db }) => {
    check((await initialize(await db(), createHostedContentConformanceSeed(), { hostTables: ARTICLE_HOST_TABLES })).seeded, true, "the Article store is created with its host table");
    await (await db()).prepare("INSERT INTO article_artifact VALUES ('p1', 's1', 'd1', 'h1', '<p>kept</p>')").run();
    const before = await snapshotD1Database(await db());
    check((await initializeArticleD1(await db(), createHostedContentConformanceSeed())).seeded, false, "the Article host reopens it without seeding");
    check(await snapshotD1Database(await db()), before, "the artifact row and every other row are unchanged");
  });
  await run("concurrent-first-start", "two initializers racing on one empty database: one seeds, the other reopens; the store holds exactly one seed", async ({ db }) => {
    const observed = [];
    for (let round = 0; round < 5; round++) {
      const [left, right] = [await db(), await db()];
      if (round > 0) await exec(left, ...[...Object.keys(definitions)].map(name => `DROP TABLE IF EXISTS ${name}`));
      const seeds = [conformanceSeedWithTitle(`Seed L${round}`), conformanceSeedWithTitle(`Seed R${round}`)];
      const outcomes = await Promise.all([initialize(left, seeds[0]), initialize(right, seeds[1])]);
      check(outcomes.filter(item => item.seeded).length, 1, `round ${round}: exactly one initializer seeds`);
      const winner = outcomes.findIndex(item => item.seeded);
      check((await dumpD1Database(left)).state, seeds[winner].state, `round ${round}: the store holds the winner's complete seed, nothing of the other`);
      check((await classifyD1Database(left)).kind, "current", `round ${round}: the result is a complete current store`);
      observed.push(winner === 0 ? "left seeded" : "right seeded");
    }
    // Deterministic interleaving: the second initializer classifies the database as empty, then its creation batch
    // is held until the other initializer has finished; the held batch must fail whole and reopen the winner's store.
    const held = (db, until) => { let first = true; return { prepare: (...args) => db.prepare(...args),
      batch: async statements => { if (first) { first = false; await until; } return db.batch(statements); } }; };
    await exec(await db(), ...[...Object.keys(definitions)].map(name => `DROP TABLE IF EXISTS ${name}`));
    let finishWinner; const winnerDone = new Promise(done => { finishWinner = done; });
    const late = initialize(held(await db(), winnerDone), conformanceSeedWithTitle("Late seed"));
    const early = await initialize(await db(), conformanceSeedWithTitle("Early seed"));
    finishWinner();
    check([early.seeded, (await late).seeded], [true, false], "held initializer: the early one seeds and the late one, which saw an empty database, reopens");
    check((await dumpD1Database(await db())).state, conformanceSeedWithTitle("Early seed").state, "held initializer: no row of the late seed was written");
    // An unrelated table created between classification and the creation batch makes the in-batch emptiness guard abort it.
    await exec(await db(), ...[...Object.keys(definitions)].map(name => `DROP TABLE IF EXISTS ${name}`));
    let createdForeign; const foreignDone = new Promise(done => { createdForeign = done; });
    const intruded = initialize(held(await db(), foreignDone), createHostedContentConformanceSeed()).then(result => result, error => error);
    await new Promise(done => setTimeout(done, 50));
    await exec(await db(), "CREATE TABLE intruder (id INTEGER PRIMARY KEY, note TEXT)", "INSERT INTO intruder (note) VALUES ('arrived first')");
    const intrudedBefore = await snapshotD1Database(await db());
    createdForeign();
    const intrusion = await intruded;
    check(intrusion instanceof HostedD1Error && intrusion.outcome === "incompatible", true, `an object that appears after classification aborts creation (${intrusion?.message ?? JSON.stringify(intrusion)})`);
    check(await snapshotD1Database(await db()), intrudedBefore, "the aborted creation batch left the intruding table and its row exactly as they were");
    return { rounds: observed, heldInterleaving: "late initializer reopened the early one's store", intrusion: intrusion.message };
  });
  await rm(root, { recursive: true, force: true });
  return { cases, assertions, passed: cases.every(item => item.passed) };
}

/** The same shipped runner inside workerd: adapter and runner both execute in the Worker isolate (no process restart). */
export async function runInWorkerConformance({ directory }) {
  const bundled = await build({ stdin: { contents: `
import { runHostedContentConformance } from "zudo-composer/hosted-content/testing";
import { createD1HostedStorage, dumpD1Database, initializeD1Database } from "./d1-storage.mjs";
const DROP = ["hosted_schema", "hosted_head", "hosted_receipt", "hosted_snapshot", "hosted_publication", "hosted_revision", "hosted_commit_guard", "content_ai_proposal"];
export default { async fetch(_request, env) {
  const factory = { async create(seed) {
    await env.DB.batch(DROP.map(table => env.DB.prepare("DROP TABLE IF EXISTS " + table)));
    await initializeD1Database(env.DB, seed);
    let generation = 0;
    return { async open() {
      const at = generation; let fault, held;
      const proof = { takeFault() { const v = fault; fault = undefined; return v; }, takeGate() { const v = held; held = undefined; return v; } };
      const storage = createD1HostedStorage(env.DB, { proof });
      const check = () => { if (at !== generation) throw new Error("closed handle"); };
      return { storage: Object.fromEntries(Object.entries(storage).map(([k, f]) => [k, async (...a) => { check(); return f(...a); }])),
        faultNextCommit(next) { fault = next; },
        holdNextCommit() { let entered, release; const e = new Promise(r => { entered = r; }); const wait = new Promise(r => { release = r; }); held = { entered, wait }; return { entered: e, release }; },
        dump: () => dumpD1Database(env.DB) };
    }, async restart() { generation++; }, async close() { generation++; } };
  } };
  const report = await runHostedContentConformance(factory);
  return Response.json(report);
} };
`, resolveDir: resolve(import.meta.dirname), sourcefile: "d1-conformance-worker.js" }, bundle: true, platform: "neutral", format: "esm", target: "es2022", write: false, metafile: true });
  for (const input of Object.keys(bundled.metafile.inputs)) assert.ok(!/^node:|node:sqlite|sqlite-storage|hosted-content\/node|child_process|preact|codemirror/.test(input), `D1 Worker graph leak ${input}`);
  const runtime = await startD1Runtime({ persist: await mkdtemp(join(directory, "composer-d1-in-worker-")), script: bundled.outputFiles[0].text, name: "d1-in-worker-conformance" });
  try {
    const response = await runtime.fetch("http://d1.local/");
    const text = await response.text();
    assert.equal(response.status, 200, text);
    return JSON.parse(text);
  } finally { await runtime.dispose(); await rm(runtime.persist, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const directory = resolve(process.argv[2] ?? await mkdtemp(join(tmpdir(), "composer-d1-proof-")));
  await mkdir(directory, { recursive: true });
  const restarts = [];
  const shared = await runHostedContentConformance(createLocalD1ConformanceFactory({ directory, log: restarts }));
  assert.equal(shared.scenarios.length, 16, "every shared conformance scenario ran against D1");
  const inWorker = await runInWorkerConformance({ directory });
  assert.equal(inWorker.scenarios.length, 16, "every shared conformance scenario ran inside workerd");
  const specific = await runD1SpecificProof({ directory });
  const initialization = await runD1InitializationProof({ directory });
  const report = {
    label: "Local Worker/D1 binding behavior (not memory conformance, not Node/SQLite, not remote production)",
    runtime: await localRuntimeVersions(),
    sharedConformance: { runner: "runHostedContentConformance from zudo-composer/hosted-content/testing", driver: "Node process; every storage call through Miniflare's D1 binding proxy into workerd's local D1", scenarios: shared.scenarios, assertions: shared.assertions, runtimeRestarts: restarts },
    inWorkerConformance: { driver: "runner and adapter bundled into one Worker, executing inside workerd against env.DB; restart reopens handles only", scenarios: inWorker.scenarios, assertions: inWorker.assertions },
    d1Specific: specific,
    initialization: { driver: "one real local D1 database per case; refusals compare complete before/after snapshots of schema objects, definitions and table rows", ...initialization },
    injectedFaults: {
      "receipt-persistence": "a real D1 CHECK failure statement inserted directly after the head UPDATE in the same batch",
      "before-commit": "the same failing statement appended as the last statement of the batch",
      "lost-acknowledgement": "the batch completes durably, then the adapter discards the response and reports an unknown outcome",
      hold: "a commit is prepared and held before submission while another handle commits (interleaving)",
      "uncertain-timeout": "the real batch is held in flight while the adapter's own timeout expires; it is then released and commits",
      "runtime-stop": "workerd is disposed while a batch is in flight",
    },
    notReproduced: "Production network partitions, D1 primary failover, replica lag and Cloudflare-side resets are not reproducible in local workerd.",
    remote: "not performed",
  };
  await writeFile(join(directory, "d1-proof-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ label: report.label, runtime: report.runtime, shared: shared.scenarios.length, sharedAssertions: shared.assertions, inWorker: inWorker.scenarios.length,
    specific: specific.results.map(item => item.case), specificAssertions: specific.assertions,
    initialization: initialization.cases.map(item => `${item.case}: ${item.passed ? "passed" : `FAILED ${item.failure}`}`), initializationAssertions: initialization.assertions, report: join(directory, "d1-proof-report.json") }, null, 2));
  assert.ok(initialization.passed, "every initialization case passed");
}
