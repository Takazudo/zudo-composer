import { createHostedContentService } from "./service";
import type {
  ContentEntryRef, HostedActor, HostedCommand, HostedDatabase, HostedIdentities,
  HostedPolicy, HostedProvider, HostedResult, HostedService, HostedState, HostedStorage, JsonValue,
} from "./types";

/** These faults occur at the storage boundary, never by forging a service receipt. */
export type HostedConformanceFault = "before-commit" | "receipt-persistence" | "lost-acknowledgement";
export interface HostedConformanceGate {
  /** Resolves while the actual database transaction is held, before its callback runs. */
  entered: Promise<void>;
  release(): void;
}
export interface HostedConformanceHandle {
  storage: HostedStorage;
  faultNextTransaction(fault: HostedConformanceFault): void;
  holdNextTransaction(): HostedConformanceGate;
}
export interface HostedConformanceBackend {
  /** Every call must open an independent storage handle. */
  open(): Promise<HostedConformanceHandle>;
  /** Close all handles; reopen the same durable state without reseeding. */
  restart(): Promise<void>;
  close(): Promise<void>;
}
export interface HostedConformanceFactory {
  /** Each scenario receives its own fresh database. Seed only an absent database. */
  create(seed: HostedDatabase, scenario: string): Promise<HostedConformanceBackend>;
}
export interface HostedConformanceReport {
  scenarios: string[];
  assertions: number;
}

/**
 * Deterministic fault/interleaving reference only. This fake does not demonstrate
 * disk durability, process isolation, SQLite or D1 behavior.
 */
export function createMemoryHostedConformanceFactory(): HostedConformanceFactory {
  return { async create(seed) {
    let database = clone(seed);
    let tail: Promise<void> = Promise.resolve();
    let generation = 0;
    let disposed = false;
    return {
      async open() {
        const openedAt = generation;
        let fault: HostedConformanceFault | undefined;
        let held: { entered(): void; wait: Promise<void> } | undefined;
        const check = (): void => {
          if (disposed || openedAt !== generation) throw new Error("Conformance handle is closed");
        };
        return {
          storage: {
            async read() { check(); await tail; check(); return clone(database); },
            transaction<T>(work: (database: HostedDatabase) => Promise<T>): Promise<T> {
              const selectedFault = fault; fault = undefined;
              const selectedGate = held; held = undefined;
              const pending = tail.then(async () => {
                check();
                if (selectedGate) { selectedGate.entered(); await selectedGate.wait; }
                const detached = clone(database);
                const result = await work(detached);
                if (selectedFault === "before-commit" || selectedFault === "receipt-persistence")
                  throw new Error(`Injected ${selectedFault}`);
                database = clone(detached);
                if (selectedFault === "lost-acknowledgement") throw new Error("Injected lost acknowledgement after commit");
                return clone(result);
              });
              tail = pending.then(() => undefined, () => undefined);
              return pending;
            },
          },
          faultNextTransaction(next) { check(); fault = next; },
          holdNextTransaction() {
            check();
            let release!: () => void; let entered!: () => void;
            const gate = { entered: new Promise<void>((resolve) => { entered = resolve; }),
              release: () => release() };
            held = { entered, wait: new Promise<void>((resolve) => { release = resolve; }) };
            return gate;
          },
        };
      },
      async restart() { await tail; generation++; },
      async close() { await tail; disposed = true; generation++; },
    };
  } };
}

const actor: HostedActor = { id: "allowed-editor" };
const lesson: ContentEntryRef = { providerId: "content", modelId: "lesson", recordId: "lesson-entry" };
const faq: ContentEntryRef = { providerId: "content", modelId: "faq", recordId: "faq-initial" };
const timestamp = "2026-01-01T00:00:00.000Z";
const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;

/** Public deterministic data shared by adapter and independent-process proofs. */
export function createHostedContentConformanceSeed(): HostedDatabase {
  const models = [
    { id: "lesson", createdAt: timestamp, updatedAt: timestamp, document: {
      schemaVersion: 1 as const, id: "lesson", name: "Lesson", description: "", kind: "single" as const,
      fields: [
        { id: "title", key: "title", label: "Title", required: true, kind: "text" as const },
        { id: "price", key: "price", label: "Price", required: true, kind: "number" as const },
        { id: "enabled", key: "enabled", label: "Enabled", required: false, kind: "boolean" as const },
        { id: "faqs", key: "faqs", label: "FAQ", required: false, kind: "reference-list" as const,
          target: { providerId: "content", recordId: "faq" }, ordered: true },
      ],
    } },
    { id: "faq", createdAt: timestamp, updatedAt: timestamp, document: {
      schemaVersion: 1 as const, id: "faq", name: "FAQ", description: "", kind: "collection" as const,
      fields: [
        { id: "question", key: "question", label: "Question", required: true, kind: "text" as const },
        { id: "answer", key: "answer", label: "Answer", required: true, kind: "text" as const },
      ],
    } },
  ];
  const providers: HostedProvider[] = [{ providerId: "content", models, entries: [
    { schemaVersion: 1 as const, id: lesson.recordId, modelId: lesson.modelId,
      createdAt: timestamp, updatedAt: timestamp, generation: 1, lifecycle: "published" as const,
      values: { title: "日本語の講座", price: 100, enabled: true, faqs: [faq] as unknown as JsonValue } },
    { schemaVersion: 1 as const, id: faq.recordId, modelId: faq.modelId,
      createdAt: timestamp, updatedAt: timestamp, generation: 1, lifecycle: "published" as const,
      values: { question: "初回の質問", answer: "初回の回答" } },
  ] }];
  return { state: { draftRevision: "r0", baseline: { gitSha: "0".repeat(40), contentDigest: "content-0" },
    definition: "definition-v1", integrationFence: 0, providers: clone(providers) },
    baselineProviders: clone(providers), receipts: [], snapshots: [], publications: [] };
}

export function createHostedContentConformancePolicy(): HostedPolicy {
  return {
    models: [
      { providerId: "content", modelId: "lesson", entryIds: [lesson.recordId], fields: [
        { fieldId: "title", replace: true, clear: true },
        { fieldId: "price", replace: true }, { fieldId: "enabled", replace: true },
      ] },
      { providerId: "content", modelId: "faq", entryIds: [faq.recordId], fields: [
        { fieldId: "question", replace: true }, { fieldId: "answer", replace: true },
      ] },
    ],
    collections: [{ id: "lesson-faqs", owner: lesson, fieldId: "faqs",
      target: { providerId: "content", modelId: "faq" }, create: true, add: true, reorder: true,
      maxItems: 8, initialValues: { question: "新しい質問", answer: "新しい回答" } }],
    assets: [],
  };
}

/** A deterministic test digest; production hosts must supply a cryptographic digest. */
export async function hostedConformanceDigest(value: string): Promise<string> {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `fixture-${(hash >>> 0).toString(16).padStart(8, "0")}-${value.length}`;
}

export function createHostedConformanceService(storage: HostedStorage, handleId: string): HostedService {
  let nextId = 0;
  return createHostedContentService({ siteId: "conformance", definition: "definition-v1",
    policy: createHostedContentConformancePolicy(), storage,
    authorize(who) { if (who.id !== actor.id) throw new Error("Unauthorized fixture actor"); },
    digest: hostedConformanceDigest, createId: () => `${handleId}-${++nextId}`, now: () => timestamp,
    project: (providers, assets) => clone({ providers, assets }) as unknown as JsonValue, validateSubmission: () => undefined });
}

function identities(state: HostedState): HostedIdentities {
  return { draftRevision: state.draftRevision, baseline: clone(state.baseline), definition: state.definition };
}
function edit(state: HostedState, operationKey: string, title: string, target = lesson): HostedCommand {
  return { kind: "set-fields", operationKey, expected: identities(state), entry: target,
    values: target.modelId === "faq" ? { question: title } : { title }, clear: [] };
}
function value(state: HostedState, target: ContentEntryRef, field: string): unknown {
  return state.providers.find((p) => p.providerId === target.providerId)?.entries
    .find((entry) => entry.id === target.recordId && entry.modelId === target.modelId)?.values[field];
}

/**
 * Portable, framework-independent service conformance. It imports no Node/DOM APIs.
 * Run it against a deterministic fault backend and the actual downstream adapter.
 * A pass identifies only the tested backend; it is never evidence for another database.
 */
export async function runHostedContentConformance(factory: HostedConformanceFactory): Promise<HostedConformanceReport> {
  const report: HostedConformanceReport = { scenarios: [], assertions: 0 };
  const assert = (condition: unknown, message: string): void => {
    report.assertions++;
    if (!condition) throw new Error(`Hosted Content conformance: ${message}`);
  };
  const equal = (left: unknown, right: unknown, message: string): void =>
    assert(JSON.stringify(left) === JSON.stringify(right), message);
  const errorCode = async (work: () => Promise<unknown>, expected: string): Promise<void> => {
    let error: unknown;
    try { await work(); } catch (caught) { error = caught; }
    assert(typeof error === "object" && error !== null && "code" in error && error.code === expected,
      `expected ${expected}, received ${error instanceof Error ? error.message : String(error)}`);
  };
  const scenario = async (name: string, run: (backend: HostedConformanceBackend,
    a: HostedConformanceHandle, b: HostedConformanceHandle, one: HostedService, two: HostedService) => Promise<void>): Promise<void> => {
    const backend = await factory.create(createHostedContentConformanceSeed(), name);
    try {
      const a = await backend.open(); const b = await backend.open();
      assert(a.storage !== b.storage, `${name}: independent storage handles required`);
      await run(backend, a, b, createHostedConformanceService(a.storage, `${name}-a`),
        createHostedConformanceService(b.storage, `${name}-b`));
      report.scenarios.push(name);
    } finally { await backend.close(); }
  };

  await scenario("independent-cas", async (_backend, a, _b, one, two) => {
    const initial = await one.readState(actor);
    const gate = a.holdNextTransaction();
    const first = one.execute(actor, edit(initial, "cas-a", "A"));
    await gate.entered;
    const second = two.execute(actor, edit(initial, "cas-b", "B"));
    gate.release();
    const results = await Promise.allSettled([first, second]);
    assert(results.filter((result) => result.status === "fulfilled").length === 1, "one CAS write succeeds");
    const rejected = results.find((result) => result.status === "rejected");
    assert(rejected?.status === "rejected" && rejected.reason?.code === "revision-conflict", "other CAS write conflicts");
    const saved = await two.readState(actor);
    equal(value(saved, lesson, "title"), "A", "CAS winner retained");
    equal(value(saved, lesson, "faqs"), [faq], "CAS keeps membership");
  });

  await scenario("duplicate-create-and-key-reuse", async (_backend, a, _b, one, two) => {
    const initial = await one.readState(actor);
    const request: HostedCommand = { kind: "create-entry", operationKey: "create-same", expected: identities(initial),
      collectionId: "lesson-faqs", values: { question: "質問A", answer: "回答A" }, before: null };
    const gate = a.holdNextTransaction();
    const first = one.execute(actor, request); await gate.entered;
    const second = two.execute(actor, clone(request)); gate.release();
    const [left, right] = await Promise.all([first, second]);
    equal(left, right, "duplicate create returns original exact receipt");
    assert(Boolean(left.createdEntry), "create assigns an entry identity");
    const db = await a.storage.read();
    equal(db.receipts.length, 1, "duplicate has one receipt");
    equal(db.state.providers[0]?.entries.length, 3, "duplicate creates only one entry");
    equal(value(db.state, lesson, "faqs"), [faq, left.createdEntry], "create atomically appends membership");
    await errorCode(() => two.execute(actor, { ...request, values: { question: "別の質問", answer: "回答A" } }), "operation-key-reuse");
    await errorCode(() => two.execute(actor, { ...request, expected: identities(db.state) }), "operation-key-reuse");
    equal(await a.storage.read(), db, "key reuse cannot change database");
  });

  await scenario("competing-reorder", async (_backend, a, _b, one, two) => {
    const initial = await one.readState(actor);
    const created = await one.execute(actor, { kind: "create-entry", operationKey: "reorder-create", expected: identities(initial),
      collectionId: "lesson-faqs", values: {}, before: null });
    assert(created.createdEntry, "reorder fixture created");
    const request: HostedCommand = { kind: "reorder", operationKey: "reorder-a", expected: identities(created.state),
      collectionId: "lesson-faqs", entries: [created.createdEntry!, faq] };
    const gate = a.holdNextTransaction(); const first = one.execute(actor, request); await gate.entered;
    const second = two.execute(actor, { ...request, operationKey: "reorder-b", entries: [faq, created.createdEntry!] });
    gate.release();
    const results = await Promise.allSettled([first, second]);
    assert(results[0]?.status === "fulfilled", "first reorder succeeds");
    assert(results[1]?.status === "rejected" && results[1].reason?.code === "revision-conflict", "concurrent reorder conflicts");
    equal(value(await two.readState(actor), lesson, "faqs"), request.entries, "winning reorder exact IDs and order");
  });

  for (const fault of ["before-commit", "receipt-persistence"] as const) {
    await scenario(`rollback-${fault}`, async (_backend, a, _b, one, two) => {
      const before = await a.storage.read(); a.faultNextTransaction(fault);
      let failed = false;
      try { await one.execute(actor, edit(before.state, "rollback", "must-not-persist")); } catch { failed = true; }
      assert(failed, `${fault} reaches caller`);
      equal(await a.storage.read(), before, `${fault}: aggregate and receipts rollback together`);
      equal(await two.readReceipt(actor, "rollback"), null, `${fault}: no successful receipt`);
      const retried = await two.execute(actor, edit(before.state, "rollback", "must-not-persist"));
      equal(value(retried.state, lesson, "title"), "must-not-persist", `${fault}: exact retry can succeed`);
    });
  }

  await scenario("rollback-async-callback", async (_backend, a, b) => {
    const original = await a.storage.read();
    let failed = false;
    try {
      await a.storage.transaction(async (database) => {
        database.state.draftRevision = "uncommitted";
        database.state.providers[0]!.entries[0]!.values.title = "uncommitted";
        await Promise.resolve();
        throw new Error("Async callback failed after changing its detached aggregate");
      });
    } catch { failed = true; }
    assert(failed, "async callback failure reaches caller");
    equal(await b.storage.read(), original, "async callback failure rolls back every aggregate record");
  });

  await scenario("lost-create-ack-restart", async (backend, a, _b, one) => {
    const initial = await one.readState(actor);
    const request: HostedCommand = { kind: "create-entry", operationKey: "lost-create", expected: identities(initial),
      collectionId: "lesson-faqs", values: { question: "失われた応答", answer: "保存済み" }, before: null };
    a.faultNextTransaction("lost-acknowledgement");
    let failed = false; try { await one.execute(actor, request); } catch { failed = true; }
    assert(failed, "response loss surfaces uncertainty");
    await backend.restart();
    const reopened = await backend.open(); const recovered = createHostedConformanceService(reopened.storage, "restart");
    const receipt = await recovered.readReceipt(actor, request.operationKey);
    assert(receipt?.result.createdEntry, "original creation receipt survives restart");
    const replay = await recovered.execute(actor, clone(request));
    equal(replay, receipt?.result, "restart retry returns original receipt and IDs");
    const db = await reopened.storage.read();
    equal(db.state.providers[0]?.entries.length, 3, "lost create response never duplicates entry");
    equal(db.receipts.length, 1, "lost create response never duplicates receipt");
  });

  await scenario("coherent-immutable-capture", async (_backend, a, _b, one, two) => {
    const initial = await one.readState(actor);
    const gate = a.holdNextTransaction();
    const changing = one.execute(actor, { kind: "create-entry", operationKey: "capture-create", expected: identities(initial),
      collectionId: "lesson-faqs", values: { question: "coherent", answer: "coherent" }, before: null });
    await gate.entered;
    const capture = two.execute(actor, { kind: "capture-snapshot", operationKey: "capture-race", expected: identities(initial) });
    gate.release(); await changing;
    await errorCode(() => capture, "revision-conflict");
    const latest = await two.readState(actor);
    const captured = await two.execute(actor, { kind: "capture-snapshot", operationKey: "capture-coherent", expected: identities(latest) });
    assert(captured.snapshot, "coherent capture persisted");
    const frozen = clone(captured.snapshot!);
    equal(captured.snapshot?.providers[0]?.entries.length, 3, "capture includes whole multi-record create");
    equal(captured.snapshot?.providers[0]?.entries.find((entry) => entry.id === lesson.recordId)?.values.faqs,
      value(latest, lesson, "faqs"), "capture membership agrees with included records");
    captured.snapshot!.providers[0]!.entries[0]!.values.title = "caller-mutation";
    equal(await one.readSnapshot(actor, frozen.id), frozen, "snapshot reads are detached");
    const changed = await one.execute(actor, edit(latest, "after-capture", "later"));
    equal(await two.readSnapshot(actor, frozen.id), frozen, "later saves cannot mutate captured bytes");
    const published = await two.execute(actor, { kind: "capture-snapshot", operationKey: "current", expected: identities(changed.state) });
    const staleDb = await a.storage.read();
    await errorCode(() => two.execute(actor, { kind: "begin-publication", operationKey: "stale-submit",
      expected: identities(changed.state), snapshotId: frozen.id }), "revision-conflict");
    equal(await a.storage.read(), staleDb, "stale submit does not create operation or receipt");
    assert(published.snapshot?.id !== frozen.id, "new revision has independent snapshot identity");
  });

  for (const isNewEntry of [false, true]) {
    await scenario(isNewEntry ? "two-integrations-new-entry" : "two-integrations-existing-entry", async (backend, a, b, one, two) => {
      let current = await one.readState(actor); let target = lesson;
      let saved: HostedResult;
      if (isNewEntry) {
        saved = await one.execute(actor, { kind: "create-entry", operationKey: "save-a", expected: identities(current),
          collectionId: "lesson-faqs", values: { question: "A", answer: "回答" }, before: null });
        target = saved.createdEntry!;
      } else saved = await one.execute(actor, edit(current, "save-a", "A"));
      current = saved.state;
      const s1 = (await one.execute(actor, { kind: "capture-snapshot", operationKey: "snapshot-a", expected: identities(current) })).snapshot!;
      const p1 = (await one.execute(actor, { kind: "begin-publication", operationKey: "publication-a", expected: identities(current), snapshotId: s1.id })).publication!;
      assert(p1, "first publication intent durably created");
      await errorCode(() => two.execute(actor, { kind: "begin-publication", operationKey: "competing-publication",
        expected: identities(current), snapshotId: s1.id }), "publication-busy");
      equal((await a.storage.read()).publications.length, 1, "one active publication cannot be overwritten");
      const saveGate = b.holdNextTransaction();
      const pendingB = two.execute(actor, edit(current, "save-b", "B", target));
      await saveGate.entered;
      // Integration starts while the independent client holds its actual write transaction.
      const pendingIntegrationA = one.recordConfirmedIntegration({ publicationId: p1.id, snapshotId: s1.id,
        expectedBaseline: p1.expectedBaseline, gitSha: "1".repeat(40), contentDigest: s1.digest });
      saveGate.release();
      const savedB = await pendingB;
      const field = isNewEntry ? "question" : "title";
      equal(value(savedB.state, target, field), "B", "later B saved during publication A");
      const integratedA = await pendingIntegrationA;
      equal(value(integratedA, target, field), "B", "integration A preserves latest B");
      equal(integratedA.baseline, { gitSha: "1".repeat(40), contentDigest: s1.digest }, "baseline advances to A");
      assert(integratedA.draftRevision !== savedB.state.draftRevision, "integration advances CAS revision");
      equal(await two.execute(actor, edit(current, "save-b", "B", target)), savedB, "exact save replay survives baseline advancement");
      const recoveredP1 = await one.execute(actor, { kind: "begin-publication", operationKey: "publication-a",
        expected: identities(current), snapshotId: s1.id });
      equal(recoveredP1.snapshot, s1, "accepted publication replay retains original reviewed snapshot after B save and integration");
      equal(recoveredP1.publication, p1, "accepted publication replay retains original publication receipt");
      if (isNewEntry) equal(integratedA.providers[0]!.entries.find(entry => entry.id === target.recordId)?.lifecycle,
        "draft", "newer created Entry B remains working draft after A integration");
      const s2 = (await two.execute(actor, { kind: "capture-snapshot", operationKey: "snapshot-b", expected: identities(integratedA) })).snapshot!;
      equal(s2.providers.find((provider) => provider.providerId === target.providerId)?.entries
        .find((entry) => entry.id === target.recordId)?.values[field], "B", "second delivery candidate contains B including created entry");
      if (isNewEntry) equal(s2.providers[0]!.entries.find(entry => entry.id === target.recordId)?.lifecycle,
        "published", "second immutable delivery includes the still-draft created Entry B");
      const p2 = (await two.execute(actor, { kind: "begin-publication", operationKey: "publication-b", expected: identities(integratedA), snapshotId: s2.id })).publication!;
      await backend.restart();
      const reopened = await backend.open(); const recovery = createHostedConformanceService(reopened.storage, "integration-restart");
      equal((await recovery.getPublication(actor, p2.id)).snapshotId, s2.id, "pending operation survives provider crash/restart");
      const integratedB = await recovery.recordConfirmedIntegration({ publicationId: p2.id, snapshotId: s2.id,
        expectedBaseline: p2.expectedBaseline, gitSha: "2".repeat(40), contentDigest: s2.digest });
      equal(value(integratedB, target, field), "B", "second integration retains B");
      equal(integratedB.baseline, { gitSha: "2".repeat(40), contentDigest: s2.digest }, "baseline advances to B");
      if (isNewEntry) equal(integratedB.providers[0]!.entries.find(entry => entry.id === target.recordId)?.lifecycle,
        "published", "matching newly integrated Entry B may be marked clean");
      const beforeLate = await reopened.storage.read();
      await recovery.recordConfirmedIntegration({ publicationId: p1.id, snapshotId: s1.id,
        expectedBaseline: p1.expectedBaseline, gitSha: "1".repeat(40), contentDigest: s1.digest });
      equal((await recovery.readState(actor)).baseline, integratedB.baseline, "late P1 cannot regress B2 baseline");
      await recovery.recordStatus({ publicationId: p1.id, snapshotId: s1.id, statusVersion: 1, status: "building" });
      equal((await recovery.getPublication(actor, p1.id)).status, "integrated", "late P1 status cannot regress integrated truth");
      equal((await reopened.storage.read()).state, beforeLate.state, "late callback never marks newer state clean");
      if (isNewEntry) assert(Array.isArray(value(integratedB, lesson, "faqs")) &&
        (value(integratedB, lesson, "faqs") as ContentEntryRef[]).some((ref) => ref.recordId === target.recordId),
      "new entry membership remains after both integrations");
    });
  }

  await scenario("external-baseline-and-definition-conflict", async (_backend, a, _b, one, two) => {
    const initial = await one.readState(actor);
    const saved = await one.execute(actor, edit(initial, "external-save", "retained"));
    const captured = await one.execute(actor, { kind: "capture-snapshot", operationKey: "external-capture", expected: identities(saved.state) });
    await a.storage.transaction(async (db) => { db.state.baseline = { gitSha: "e".repeat(40), contentDigest: "external" }; });
    await errorCode(() => two.execute(actor, { kind: "begin-publication", operationKey: "external-submit",
      expected: identities(saved.state), snapshotId: captured.snapshot!.id }), "baseline-conflict");
    equal(value(await one.readState(actor), lesson, "title"), "retained", "external baseline conflict retains draft");
    equal(await one.readSnapshot(actor, captured.snapshot!.id), captured.snapshot, "external baseline conflict retains reviewed snapshot");
    const newBaseline = await one.readState(actor);
    await a.storage.transaction(async (db) => { db.state.definition = "definition-v2"; });
    await errorCode(() => two.execute(actor, edit(newBaseline, "definition-edit", "blocked")), "definition-conflict");
    equal(value((await a.storage.read()).state, lesson, "title"), "retained", "definition conflict never destroys draft");
  });

  await scenario("external-integration-conflict", async (_backend, a, _b, one, two) => {
    const saved = await one.execute(actor, edit(await one.readState(actor), "external-integration-save", "retained"));
    const snapshot = (await one.execute(actor, { kind: "capture-snapshot", operationKey: "external-integration-capture",
      expected: identities(saved.state) })).snapshot!;
    const publication = (await one.execute(actor, { kind: "begin-publication", operationKey: "external-integration-submit",
      expected: identities(saved.state), snapshotId: snapshot.id })).publication!;
    await a.storage.transaction(async (database) => {
      database.state.baseline = { gitSha: "f".repeat(40), contentDigest: "external-integrated-content" };
    });
    const before = await a.storage.read();
    await errorCode(() => two.recordConfirmedIntegration({ publicationId: publication.id, snapshotId: snapshot.id,
      expectedBaseline: publication.expectedBaseline, gitSha: "1".repeat(40), contentDigest: snapshot.digest }), "baseline-conflict");
    equal(await a.storage.read(), before, "external integration conflict retains exact operation, draft and snapshot");
  });

  return report;
}
