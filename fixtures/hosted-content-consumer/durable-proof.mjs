import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHostedContentConformanceSeed, createMemoryHostedConformanceFactory,
  runHostedContentConformance,
} from "zudo-composer/hosted-content/testing";
import { createSqliteConformanceFactory, initializeSqliteDatabase } from "./sqlite-storage.mjs";

const lesson = { providerId: "content", modelId: "lesson", recordId: "lesson-entry" };
const faq = { providerId: "content", modelId: "faq", recordId: "faq-initial" };
const actor = "allowed-editor";
const identity = state => ({ draftRevision: state.draftRevision, baseline: state.baseline, definition: state.definition });
const edit = (state, operationKey, title) => ({ kind: "set-fields", operationKey,
  expected: identity(state), entry: lesson, values: { title }, clear: [] });
const title = state => state.providers[0].entries.find(entry => entry.id === lesson.recordId).values.title;

async function child(filename, name) {
  const processHandle = fork(fileURLToPath(new URL("./sqlite-worker.mjs", import.meta.url)), [filename, name],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const pending = new Map(); const events = new Map(); const seen = new Map();
  let sequence = 0; let stderr = "";
  processHandle.stderr.on("data", chunk => { stderr += chunk; });
  processHandle.on("message", message => {
    if (message.event) {
      const waiter = events.get(message.event);
      if (waiter) { events.delete(message.event); clearTimeout(waiter.timeout); waiter.resolve(message); }
      else seen.set(message.event, message);
      return;
    }
    const request = pending.get(message.id); if (!request) return;
    pending.delete(message.id); clearTimeout(request.timeout);
    if (message.error) request.reject(Object.assign(new Error(message.error.message), message.error));
    else request.resolve(message.result);
  });
  processHandle.on("exit", (code, signal) => {
    const error = new Error(`SQLite worker ${name} exited ${code ?? signal}: ${stderr}`);
    for (const request of pending.values()) { clearTimeout(request.timeout); request.reject(error); }
    for (const waiter of events.values()) { clearTimeout(waiter.timeout); waiter.reject(error); }
    pending.clear(); events.clear();
  });
  const event = name => {
    if (seen.has(name)) { const result = seen.get(name); seen.delete(name); return Promise.resolve(result); }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { events.delete(name); reject(new Error(`Worker event ${name} timed out`)); }, 12_000);
      events.set(name, { resolve, reject, timeout });
    });
  };
  const request = (action, data = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Worker ${action} timed out`)); }, 12_000);
    pending.set(id, { resolve, reject, timeout });
    processHandle.send({ id, action, ...data });
  });
  await event("ready");
  return { process: processHandle, request, event,
    async stop() {
      if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
      const exited = once(processHandle, "exit");
      await request("close"); await exited;
    },
    async kill() {
      if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
      const exited = once(processHandle, "exit"); processHandle.kill("SIGKILL"); await exited;
    } };
}

/** Real process crash/reopen and races, in addition to the same shipped runner. */
export async function runSqliteProcessProof() {
  const directory = await mkdtemp(join(tmpdir(), "composer-hosted-process-"));
  const filename = join(directory, "durable.sqlite");
  const children = [];
  const open = async name => { const worker = await child(filename, name); children.push(worker); return worker; };
  let assertions = 0;
  const check = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
  try {
    await initializeSqliteDatabase(filename, createHostedContentConformanceSeed());
    const a = await open("process-a"); const b = await open("process-b");
    check(a.process.pid !== b.process.pid, true, "separate OS processes");
    let initial = await a.request("read");
    await a.request("hold");
    const first = a.request("execute", { request: edit(initial, "process-cas-a", "A") });
    await a.event("transaction-held");
    const second = b.request("execute", { request: edit(initial, "process-cas-b", "B") });
    await a.request("release");
    const outcomes = await Promise.allSettled([first, second]);
    check(outcomes[0].status, "fulfilled", "held writer commits");
    check(outcomes[1].status, "rejected", "other process sees CAS conflict");
    check(outcomes[1].reason.code, "revision-conflict", "cross-process typed conflict");
    check(title(await b.request("read")), "A", "cross-process CAS retains winner");

    initial = await b.request("read");
    const create = { kind: "create-entry", operationKey: "process-duplicate-create", expected: identity(initial),
      collectionId: "lesson-faqs", values: { question: "新しい質問", answer: "新しい回答" }, before: null };
    await a.request("hold"); const createOne = a.request("execute", { request: create });
    await a.event("transaction-held"); const createTwo = b.request("execute", { request: create });
    await a.request("release"); const [createdA, createdB] = await Promise.all([createOne, createTwo]);
    check(createdA, createdB, "two processes recover exact created identity");
    let database = await b.request("database");
    check(database.state.providers[0].entries.length, 3, "cross-process duplicate creates once");
    check(database.receipts.filter(receipt => receipt.operationKey === create.operationKey).length, 1, "one create receipt");

    // Receipt INSERT fails after the aggregate UPDATE, and SQLite rolls both back.
    const beforeFailure = await a.request("database");
    await a.request("fault", { fault: "receipt-persistence" });
    const failedWrite = await Promise.allSettled([a.request("execute", { request: edit(beforeFailure.state, "receipt-failed", "bad") })]);
    check(failedWrite[0].status, "rejected", "receipt constraint failure reaches caller");
    check(await b.request("database"), beforeFailure, "aggregate update rolled back with actual receipt SQL failure");

    // Kill after both aggregate UPDATE and receipt INSERT, before the real COMMIT.
    await a.request("hold-commit");
    const aborted = a.request("execute", { request: edit(beforeFailure.state, "crash-before-commit", "bad") });
    const abortedOutcome = Promise.allSettled([aborted]);
    await a.event("commit-held"); await a.kill(); await abortedOutcome;
    check(await b.request("database"), beforeFailure, "process death before COMMIT leaves no mutation or receipt");

    // Response lost after COMMIT, followed by killing and replacing the complete backend process.
    const c = await open("process-c"); const beforeLost = await c.request("read");
    const lost = { kind: "create-entry", operationKey: "process-lost-create", expected: identity(beforeLost),
      collectionId: "lesson-faqs", values: { question: "応答が失われた質問", answer: "保存済み" }, before: null };
    await c.request("fault", { fault: "lost-acknowledgement" });
    const lostOutcome = await Promise.allSettled([c.request("execute", { request: lost })]);
    check(lostOutcome[0].status, "rejected", "client receives uncertain acknowledgement");
    await c.kill(); await b.stop();
    const d = await open("process-d-restarted");
    const recovered = await d.request("receipt", { operationKey: lost.operationKey });
    check(recovered.actorId, actor, "receipt actor survives process restart");
    const retried = await d.request("execute", { request: lost });
    check(retried, recovered.result, "new backend process returns original receipt");
    database = await d.request("database");
    check(database.state.providers[0].entries.length, 4, "lost ack creation not duplicated after restart");

    // Multi-record creation races a capture from the prior revision in two processes.
    const e = await open("process-e"); const current = await d.request("read");
    await d.request("hold");
    const writing = d.request("execute", { request: { kind: "create-entry", operationKey: "process-capture-write",
      expected: identity(current), collectionId: "lesson-faqs", values: {}, before: null } });
    await d.event("transaction-held");
    const capture = e.request("execute", { request: { kind: "capture-snapshot", operationKey: "process-race-capture",
      expected: identity(current) } });
    const captureOutcome = Promise.allSettled([capture]); await d.request("release"); await writing;
    check((await captureOutcome)[0].reason.code, "revision-conflict", "cross-process capture refuses mixed prior revision");
    const latest = await e.request("read");
    const captured = await e.request("execute", { request: { kind: "capture-snapshot", operationKey: "process-coherent-capture",
      expected: identity(latest) } });
    check(captured.snapshot.providers[0].entries.length, 5, "coherent snapshot includes all created records");
    check(captured.snapshot.providers[0].entries.find(entry => entry.id === lesson.recordId).values.faqs,
      [faq, createdA.createdEntry, retried.createdEntry, latest.providers[0].entries[4] &&
        { providerId: "content", modelId: "faq", recordId: latest.providers[0].entries[4].id }],
      "coherent snapshot membership and record IDs agree");

    // Two complete publications of a newly created Entry, with B racing integration A.
    const publicationA = (await d.request("execute", { request: { kind: "begin-publication",
      operationKey: "process-publication-a", expected: identity(latest), snapshotId: captured.snapshot.id } })).publication;
    await e.request("hold");
    const savingB = e.request("execute", { request: { kind: "set-fields", operationKey: "process-new-entry-b",
      expected: identity(latest), entry: createdA.createdEntry, values: { question: "新しいB" }, clear: [] } });
    await e.event("transaction-held");
    const evidenceA = { publicationId: publicationA.id, snapshotId: captured.snapshot.id,
      expectedBaseline: publicationA.expectedBaseline, gitSha: "1".repeat(40), contentDigest: captured.snapshot.digest };
    const integrationA = d.request("integration", { evidence: evidenceA });
    await e.request("release"); await savingB;
    const afterA = await integrationA;
    check(afterA.providers[0].entries.find(entry => entry.id === createdA.createdEntry.recordId).values.question,
      "新しいB", "cross-process integration A preserves racing newer Entry B");
    check(afterA.baseline.gitSha, "1".repeat(40), "cross-process baseline advances to A");
    await d.stop(); await e.stop();
    const f = await open("process-f-integration-recovery");
    const restored = await f.request("read");
    const snapshotB = (await f.request("execute", { request: { kind: "capture-snapshot", operationKey: "process-snapshot-b",
      expected: identity(restored) } })).snapshot;
    check(snapshotB.providers[0].entries.find(entry => entry.id === createdA.createdEntry.recordId).values.question,
      "新しいB", "second snapshot after process restart contains new Entry B");
    const publicationB = (await f.request("execute", { request: { kind: "begin-publication", operationKey: "process-publication-b",
      expected: identity(restored), snapshotId: snapshotB.id } })).publication;
    const evidenceB = { publicationId: publicationB.id, snapshotId: snapshotB.id,
      expectedBaseline: publicationB.expectedBaseline, gitSha: "2".repeat(40), contentDigest: snapshotB.digest };
    const afterB = await f.request("integration", { evidence: evidenceB });
    check(afterB.baseline.gitSha, "2".repeat(40), "second publication advances durable baseline to B");
    await f.request("integration", { evidence: evidenceA });
    await f.request("status", { evidence: { publicationId: publicationA.id, snapshotId: captured.snapshot.id,
      statusVersion: 1, status: "building" } });
    check(await f.request("read"), afterB, "late A callback/status cannot regress B after process restart");
    check((await f.request("publication", { publicationId: publicationA.id })).status, "integrated", "late status keeps integrated truth");
    return { processes: children.map(worker => worker.process.pid), assertions,
      scenarios: ["process-cas", "process-duplicate-create", "actual-receipt-sql-rollback", "process-crash-before-commit",
        "lost-ack-process-restart", "process-coherent-capture", "process-two-integrations-new-entry"] };
  } finally {
    for (const worker of children) await worker.kill();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runDurableProof() {
  const fake = await runHostedContentConformance(createMemoryHostedConformanceFactory());
  const sqlite = await runHostedContentConformance(createSqliteConformanceFactory());
  const processes = await runSqliteProcessProof();
  return { node: process.version, backend: "Node node:sqlite, file-backed SQLite WAL, FULL synchronous", fake, sqlite, processes,
    downstreamD1: "not tested" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(await runDurableProof(), null, 2));
}
