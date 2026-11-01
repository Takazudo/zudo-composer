/* global TextEncoder */
// Host-owned Cloudflare D1 adapters for the public Hosted Content and Content-AI contracts.
// Runtime-neutral: it only talks to a D1Database binding, so the same module runs inside workerd (the Worker
// Article host) and through Miniflare's binding proxy from the Node proofs. It never enters a Composer graph.
import { EditorialError } from "zudo-composer/hosted-content";

/**
 * Documented D1 limits (developers.cloudflare.com/d1/platform/limits, checked 2026-11-01). A commit that would
 * exceed one is refused before anything is sent, so atomicity is never weakened by splitting one command.
 * `maxBoundBytes` is the row/string limit applied conservatively to the sum of one statement's bound text.
 */
export const D1_LIMITS = Object.freeze({ maxBoundBytes: 2_000_000, maxBoundParameters: 100, maxSqlBytes: 100_000, maxBatchMilliseconds: 30_000 });
export const D1_SCHEMA_VERSION = "hosted-d1-v1";

/**
 * `failed`: D1 reported a statement error, so the batch rolled back and nothing was written.
 * `unknown`: the outcome is not known (timeout, lost response, transport error); the write may have committed.
 * `limit`: refused locally before anything was sent.
 * `incompatible`: initialization refused a database it does not own; nothing was created or changed.
 */
export class HostedD1Error extends Error {
  constructor(outcome, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "HostedD1Error"; this.outcome = outcome;
    this.code = { limit: "storage-limit", failed: "storage-failed", incompatible: "storage-incompatible" }[outcome] ?? "storage-outcome-unknown";
  }
}

// The exact table definitions; sqlite_schema stores this text verbatim, so initialization compares it character for character.
const CORE_TABLES = [
  ["hosted_schema", `CREATE TABLE hosted_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version TEXT NOT NULL)`],
  ["hosted_head", `CREATE TABLE hosted_head (
    id INTEGER PRIMARY KEY CHECK (id = 1), version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (json_valid(state)),
    baseline_providers TEXT NOT NULL CHECK (json_valid(baseline_providers)),
    active_publication_id TEXT)`],
  ["hosted_receipt", `CREATE TABLE hosted_receipt (
    actor_id TEXT NOT NULL, operation_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL, result TEXT NOT NULL CHECK (json_valid(result)),
    PRIMARY KEY (actor_id, operation_key))`],
  ["hosted_snapshot", `CREATE TABLE hosted_snapshot (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK (json_valid(body)))`],
  ["hosted_publication", `CREATE TABLE hosted_publication (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK (json_valid(body)))`],
  // Insert-only Entry history; the unique sequence refuses a racing append even without the head guard.
  ["hosted_revision", `CREATE TABLE hosted_revision (
    id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, record_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0), body TEXT NOT NULL CHECK (json_valid(body)),
    UNIQUE (provider_id, model_id, record_id, sequence))`],
  // Never holds a row: inserting NULL aborts the whole batch when the version precondition or the head UPDATE fails.
  ["hosted_commit_guard", `CREATE TABLE hosted_commit_guard (ok INTEGER NOT NULL)`],
  // Create-only Content-AI proposals, scoped by owner and actor; never Content.
  ["content_ai_proposal", `CREATE TABLE content_ai_proposal (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, actor_id TEXT, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK (json_valid(body)))`],
];
// Local D1 creates this metadata table itself on the first write (observed with workerd 1.20261006.1). It is the only
// object initialization ignores, by exact name; every other table, index, view or trigger must be one this store owns.
export const D1_INTERNAL_TABLES = Object.freeze(["_cf_METADATA"]);
/** The store's exact table definitions, for documentation and refusal proofs. */
export const D1_TABLE_DEFINITIONS = Object.freeze(Object.fromEntries(CORE_TABLES));

// Only these definite constraint refusals mean "nothing written, re-read and retry". Anything else is not a conflict.
const REFUSALS = [
  /NOT NULL constraint failed: hosted_commit_guard\.ok\b/,
  /UNIQUE constraint failed: hosted_receipt\.actor_id, hosted_receipt\.operation_key\b/,
  /UNIQUE constraint failed: hosted_snapshot\.id\b/,
  /UNIQUE constraint failed: hosted_revision\.id\b/,
  /UNIQUE constraint failed: hosted_revision\.provider_id, hosted_revision\.model_id, hosted_revision\.record_id, hosted_revision\.sequence\b/,
];
const messages = error => [error?.message, error?.cause?.message].filter(value => typeof value === "string");
export const isD1Refusal = error => messages(error).some(message => REFUSALS.some(pattern => pattern.test(message)));
// D1 reports engine statement errors with an SQLITE_ code; the batch was rolled back.
const isD1StatementError = error => messages(error).some(message => /^D1_(?:ERROR|EXEC_ERROR|TYPE_ERROR|COLUMN_NOTFOUND)\b/.test(message) && /SQLITE_[A-Z_]+/.test(message));

const encoder = new TextEncoder();
const statement = (sql, ...values) => ({ sql, values });
const revisionInsert = revision => statement("INSERT INTO hosted_revision (id, provider_id, model_id, record_id, sequence, body) VALUES (?, ?, ?, ?, ?, ?)",
  revision.id, revision.entry.providerId, revision.entry.modelId, revision.entry.recordId, revision.sequence, JSON.stringify(revision));
// An actual SQL statement that fails D1's CHECK; only proof hooks insert it.
const FAILING_STATEMENT = statement("INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES ('fault', 'fault', 'fault', 'not json')");

const HEAD_UPDATE = 1;
/** The complete static statement list of one accepted command; sent as exactly one D1 batch(). */
export function d1CommitStatements(change) {
  const statements = [
    // Decisive precondition, evaluated inside the batch before any write: the stored head exists, its version is
    // `expectedVersion`, and the proposed version differs from it. Inserting NULL aborts the whole batch otherwise.
    statement("INSERT INTO hosted_commit_guard (ok) SELECT NULL WHERE ? IS ? OR NOT EXISTS (SELECT 1 FROM hosted_head WHERE id = 1 AND version = ?)",
      change.head.version, change.expectedVersion, change.expectedVersion),
    statement("UPDATE hosted_head SET version = ?, state = ?, baseline_providers = ?, active_publication_id = ? WHERE id = 1 AND version = ?",
      change.head.version, JSON.stringify(change.head.state), JSON.stringify(change.head.baselineProviders),
      change.head.activePublicationId ?? null, change.expectedVersion),
    // Postcondition: the UPDATE itself changed exactly one row. changes() is the row count of the statement just completed.
    statement("INSERT INTO hosted_commit_guard (ok) SELECT NULL WHERE changes() <> 1"),
  ];
  if (change.receipt) statements.push(statement("INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES (?, ?, ?, ?)",
    change.receipt.actorId, change.receipt.operationKey, change.receipt.fingerprint, JSON.stringify(change.receipt.result)));
  if (change.snapshot) statements.push(statement("INSERT INTO hosted_snapshot (id, body) VALUES (?, ?)", change.snapshot.id, JSON.stringify(change.snapshot)));
  if (change.publication) statements.push(statement("INSERT INTO hosted_publication (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body",
    change.publication.id, JSON.stringify(change.publication)));
  for (const revision of change.revisions ?? []) statements.push(revisionInsert(revision));
  return statements;
}

/** Refuse, before sending anything, a statement D1 would reject for size. */
export function assertD1Limits(statements) {
  for (const { sql, values } of statements) {
    if (encoder.encode(sql).length > D1_LIMITS.maxSqlBytes) throw new HostedD1Error("limit", "A statement exceeds D1's SQL length limit; nothing was written.");
    if (values.length > D1_LIMITS.maxBoundParameters) throw new HostedD1Error("limit", "A statement exceeds D1's bound parameter limit; nothing was written.");
    const bytes = values.reduce((total, value) => total + (typeof value === "string" ? encoder.encode(value).length : 8), 0);
    if (bytes > D1_LIMITS.maxBoundBytes) throw new HostedD1Error("limit", `One stored row would be ${bytes} bytes, above D1's ${D1_LIMITS.maxBoundBytes}-byte limit; nothing was written.`);
  }
}

const prepare = (db, statements) => statements.map(({ sql, values }) => db.prepare(sql).bind(...values));
const rows = result => result?.results ?? [];
const readHeadRow = row => {
  if (!row) throw new HostedD1Error("failed", "The D1 site store is not initialized; run the host's explicit initialization first.");
  return { version: row.version, state: JSON.parse(row.state), baselineProviders: JSON.parse(row.baseline_providers), activePublicationId: row.active_publication_id ?? null };
};
const readReceiptRow = row => row ? { actorId: row.actor_id, operationKey: row.operation_key, fingerprint: row.fingerprint, result: JSON.parse(row.result) } : null;

const quoteName = name => `"${String(name).replaceAll('"', '""')}"`;
const isInternal = object => object.type === "table" && D1_INTERNAL_TABLES.includes(object.name);
const readSchema = async db => rows(await db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name").all());

/**
 * Read-only classification of an existing database; it never creates, alters or writes anything.
 * - `empty`: no schema objects apart from D1's own metadata, so explicit initialization may create the store.
 * - `current`: exactly the tables of this store (plus the host's declared tables) with identical definitions, their
 *   implicit unique indexes and nothing else; one marker row naming the current schema; one head row.
 * - `foreign`: anything else (unknown objects, a missing or altered table, an older or malformed marker, a missing
 *   head). `problems` says why. A foreign database is never initialized, stamped, repaired or reset.
 */
export async function classifyD1Database(db, { hostTables = [] } = {}) {
  const expected = new Map([...CORE_TABLES, ...hostTables]);
  const objects = (await readSchema(db)).filter(object => !isInternal(object));
  if (objects.length === 0) return { kind: "empty", problems: [] };
  const problems = [];
  for (const object of objects) {
    if (object.type === "table") {
      if (!expected.has(object.name)) problems.push(`unknown table ${object.name}`);
      else if (object.sql !== expected.get(object.name)) problems.push(`table ${object.name} has a different definition`);
    } else if (!(object.type === "index" && object.sql === null && expected.has(object.tbl_name) && object.name.startsWith(`sqlite_autoindex_${object.tbl_name}_`))) {
      problems.push(`unexpected ${object.type} ${object.name}`);
    }
  }
  for (const name of expected.keys()) if (!objects.some(object => object.type === "table" && object.name === name)) problems.push(`missing table ${name}`);
  if (problems.length) return { kind: "foreign", problems };
  const [markers, heads] = await db.batch([db.prepare("SELECT id, version FROM hosted_schema ORDER BY id"), db.prepare("SELECT count(*) AS n FROM hosted_head WHERE id = 1")]);
  const marker = rows(markers);
  if (marker.length !== 1 || marker[0].id !== 1 || marker[0].version !== D1_SCHEMA_VERSION) problems.push(`schema marker is ${JSON.stringify(marker.map(row => row.version))}, not ["${D1_SCHEMA_VERSION}"]`);
  if (rows(heads)[0]?.n !== 1) problems.push("the head row is missing");
  return problems.length ? { kind: "foreign", problems } : { kind: "current", problems: [] };
}

function assertSeed(seed) {
  const list = value => Array.isArray(value);
  if (!seed || typeof seed.state !== "object" || seed.state === null || !list(seed.baselineProviders) || !list(seed.receipts) || !list(seed.snapshots)
    || !list(seed.publications) || (seed.revisions !== undefined && !list(seed.revisions))) {
    throw new HostedD1Error("failed", "The initialization seed is not a complete HostedDatabase; nothing was written.");
  }
}

const refuse = classification => new HostedD1Error("incompatible",
  `This D1 database is not an empty database or a current ${D1_SCHEMA_VERSION} store (${classification.problems.join("; ")}); it was left unchanged.`);

/**
 * Explicit local initialization. The database is classified read-only first: a `current` store reopens without any
 * write, a `foreign` one is refused unchanged, and only an `empty` one is created. Creation is one batch (one
 * transaction): the tables, the host's declared tables, the marker and the complete seed, behind a guard that aborts
 * it if any other object appeared since the classification. Plain CREATE TABLE makes a racing initializer's batch fail
 * whole; the loser then reclassifies and reopens the winner's complete store, so two seeds never mix.
 * `hostTables` are `[name, exact CREATE TABLE text]` pairs owned by the host (for example the Article artifact table).
 */
export async function initializeD1Database(db, seed, { hostTables = [] } = {}) {
  assertSeed(seed);
  const tables = [...CORE_TABLES, ...hostTables];
  const internal = [...D1_INTERNAL_TABLES, "hosted_commit_guard"].map(name => `'${name.replaceAll("'", "''")}'`).join(", ");
  const statements = [
    statement(CORE_TABLES.find(([name]) => name === "hosted_commit_guard")[1]),
    statement(`INSERT INTO hosted_commit_guard (ok) SELECT NULL WHERE EXISTS (SELECT 1 FROM sqlite_schema WHERE name NOT IN (${internal}))`),
    ...tables.filter(([name]) => name !== "hosted_commit_guard").map(([, sql]) => statement(sql)),
    statement("INSERT INTO hosted_schema (id, version) VALUES (1, ?)", D1_SCHEMA_VERSION),
  ];
  for (const receipt of seed.receipts) statements.push(statement("INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES (?, ?, ?, ?)",
    receipt.actorId, receipt.operationKey, receipt.fingerprint, JSON.stringify(receipt.result)));
  for (const snapshot of seed.snapshots) statements.push(statement("INSERT INTO hosted_snapshot (id, body) VALUES (?, ?)", snapshot.id, JSON.stringify(snapshot)));
  for (const publication of seed.publications) statements.push(statement("INSERT INTO hosted_publication (id, body) VALUES (?, ?)", publication.id, JSON.stringify(publication)));
  for (const revision of seed.revisions ?? []) statements.push(revisionInsert(revision));
  statements.push(statement("INSERT INTO hosted_head (id, version, state, baseline_providers, active_publication_id) VALUES (1, 'seed', ?, ?, ?)",
    JSON.stringify(seed.state), JSON.stringify(seed.baselineProviders), seed.activePublicationId ?? null));
  assertD1Limits(statements);

  const before = await classifyD1Database(db, { hostTables });
  if (before.kind === "current") return { seeded: false, classification: "current" };
  if (before.kind === "foreign") throw refuse(before);
  try {
    await db.batch(prepare(db, statements));
  } catch (error) {
    // The batch rolled back. A racing initializer that completed first leaves a current store to reopen.
    const after = await classifyD1Database(db, { hostTables });
    if (after.kind === "current") return { seeded: false, classification: "current" };
    if (after.kind === "foreign") throw refuse(after);
    throw new HostedD1Error(isD1StatementError(error) ? "failed" : "unknown", `D1 initialization did not complete: ${error?.message ?? error}`, error);
  }
  const after = await classifyD1Database(db, { hostTables });
  if (after.kind !== "current") throw new HostedD1Error("failed", `D1 initialization did not produce a complete store (${after.problems.join("; ")}).`);
  return { seeded: true, classification: "empty" };
}

/**
 * Evidence capture for refusal proofs: every schema object (including D1's metadata table) and the full contents
 * of every other table, read in one batch so all of it comes from one state.
 */
export async function snapshotD1Database(db) {
  const tables = (await readSchema(db)).filter(object => object.type === "table" && !isInternal(object)).map(object => object.name);
  const [schema, ...contents] = await db.batch([db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name"),
    ...tables.map(name => db.prepare(`SELECT * FROM ${quoteName(name)} ORDER BY rowid`))]);
  return { schema: rows(schema), tables: Object.fromEntries(tables.map((name, index) => [name, rows(contents[index])])) };
}

/** Coherent capture: one batch of reads is one D1 transaction, so every table comes from the same state. */
export async function dumpD1Database(db) {
  const [head, receipts, snapshots, publications, revisions] = await db.batch([
    db.prepare("SELECT version, state, baseline_providers, active_publication_id FROM hosted_head WHERE id = 1"),
    db.prepare("SELECT actor_id, operation_key, fingerprint, result FROM hosted_receipt ORDER BY actor_id, operation_key"),
    db.prepare("SELECT body FROM hosted_snapshot ORDER BY id"),
    db.prepare("SELECT body FROM hosted_publication ORDER BY id"),
    db.prepare("SELECT body FROM hosted_revision ORDER BY provider_id, model_id, record_id, sequence"),
  ]);
  const value = readHeadRow(rows(head)[0]);
  return { state: value.state, baselineProviders: value.baselineProviders, activePublicationId: value.activePublicationId,
    receipts: rows(receipts).map(readReceiptRow), snapshots: rows(snapshots).map(row => JSON.parse(row.body)),
    publications: rows(publications).map(row => JSON.parse(row.body)), revisions: rows(revisions).map(row => JSON.parse(row.body)) };
}

const timeout = (promise, milliseconds) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new HostedD1Error("unknown",
    `D1 did not answer within ${milliseconds} ms. The write may still commit; read the operation's receipt before retrying.`)), milliseconds); })])
    .finally(() => clearTimeout(timer));
};

/**
 * HostedStorage over one D1 binding. Reads are keyed and detached (parsed per call). Every commit is one
 * `batch()`: the version precondition guard, the head UPDATE and its row-count guard, insert-only
 * receipt/snapshot/revisions and the publication upsert commit together or not at all. No JavaScript lock and no transaction spans an await.
 *
 * Consistency: no Sessions API and no read replicas; every query goes to the primary, so reads after a
 * committed batch observe it.
 *
 * `proof` is for the conformance proofs only and is never passed by a host: `takeFault()` returns the next
 * fault, `takeGate()` a gate held before submission, `takeSubmitDelay()` a gate that holds the real batch while
 * the adapter's own timeout runs (the uncertain-outcome case), and `submitted(promise)` observes it.
 */
export function createD1HostedStorage(db, { timeoutMs = D1_LIMITS.maxBatchMilliseconds + 5_000, proof } = {}) {
  return {
    async readHead() { return readHeadRow(await db.prepare("SELECT version, state, baseline_providers, active_publication_id FROM hosted_head WHERE id = 1").first()); },
    async readReceipt(actorId, operationKey) {
      return readReceiptRow(await db.prepare("SELECT actor_id, operation_key, fingerprint, result FROM hosted_receipt WHERE actor_id = ? AND operation_key = ?").bind(actorId, operationKey).first());
    },
    async readSnapshot(snapshotId) { const row = await db.prepare("SELECT body FROM hosted_snapshot WHERE id = ?").bind(snapshotId).first(); return row ? JSON.parse(row.body) : null; },
    async readPublication(publicationId) { const row = await db.prepare("SELECT body FROM hosted_publication WHERE id = ?").bind(publicationId).first(); return row ? JSON.parse(row.body) : null; },
    async readRevision(revisionId) { const row = await db.prepare("SELECT body FROM hosted_revision WHERE id = ?").bind(revisionId).first(); return row ? JSON.parse(row.body) : null; },
    async listRevisions(entry, { beforeSequence, limit }) {
      const where = "provider_id = ? AND model_id = ? AND record_id = ?";
      const query = beforeSequence === undefined
        ? db.prepare(`SELECT body FROM hosted_revision WHERE ${where} ORDER BY sequence DESC LIMIT ?`).bind(entry.providerId, entry.modelId, entry.recordId, limit)
        : db.prepare(`SELECT body FROM hosted_revision WHERE ${where} AND sequence < ? ORDER BY sequence DESC LIMIT ?`).bind(entry.providerId, entry.modelId, entry.recordId, beforeSequence, limit);
      return rows(await query.all()).map(row => JSON.parse(row.body));
    },
    async commit(change) {
      const statements = d1CommitStatements(change);
      assertD1Limits(statements);
      const fault = proof?.takeFault?.(), gate = proof?.takeGate?.(), submitDelay = proof?.takeSubmitDelay?.();
      if (fault === "receipt-persistence") statements.splice(HEAD_UPDATE + 1, 0, FAILING_STATEMENT);
      if (fault === "before-commit") statements.push(FAILING_STATEMENT);
      if (gate) { gate.entered(); await gate.wait; }
      const prepared = prepare(db, statements);
      const submission = submitDelay ? (submitDelay.entered(), submitDelay.wait.then(() => db.batch(prepared))) : db.batch(prepared);
      proof?.submitted?.(submission);
      let results;
      try { results = await timeout(submission, timeoutMs); }
      catch (error) {
        if (error instanceof HostedD1Error) throw error;
        if (isD1Refusal(error)) return false;
        if (isD1StatementError(error)) throw new HostedD1Error("failed", `D1 rolled back the commit: ${error.message}`, error);
        throw new HostedD1Error("unknown", `D1 commit outcome is unknown: ${error?.message ?? error}`, error);
      }
      // Defensive only: the in-batch guards already aborted any commit whose head UPDATE did not apply.
      if (results?.[HEAD_UPDATE]?.meta?.changes !== 1) throw new HostedD1Error("unknown", "D1 accepted a commit without updating the head; refusing to report success.");
      if (fault === "lost-acknowledgement") throw new HostedD1Error("unknown", "Injected response loss after the D1 batch completed.");
      return true;
    },
  };
}

/**
 * The Content-AI create/read contract on the same D1 database. Bound to one trusted owner: a record for another
 * owner is refused on create and not found on read. Proposal rows never touch Content, history or publication.
 */
export function createD1ProposalStore(db, { owner }) {
  if (typeof owner !== "string" || !owner) throw new Error("A D1 proposal store needs its trusted owner scope");
  return {
    async create(record) {
      if (record?.owner !== owner) throw new EditorialError("forbidden", "This proposal belongs to another owner.");
      const values = [record.proposal.id, record.owner, record.actorId ?? null, record.proposal.createdAt, JSON.stringify(record)];
      try { assertD1Limits([statement("", ...values)]); }
      catch (error) { throw new EditorialError("invalid-request", error.message); }
      try {
        await db.prepare("INSERT INTO content_ai_proposal (id, owner, actor_id, created_at, body) VALUES (?, ?, ?, ?, ?)").bind(...values).run();
      } catch (error) {
        if (messages(error).some(message => /UNIQUE constraint failed: content_ai_proposal\.id\b/.test(message))) throw new EditorialError("operation-key-reuse", "A proposal with this id already exists.");
        throw new EditorialError("unavailable", isD1StatementError(error) ? "The proposal could not be stored." : "Whether the proposal was stored is unknown; prepare again.");
      }
    },
    async read(id) {
      const row = await db.prepare("SELECT owner, actor_id, body FROM content_ai_proposal WHERE id = ?").bind(id).first();
      if (!row || row.owner !== owner) return null;
      const record = JSON.parse(row.body);
      // The indexed columns and the record must agree; a tampered row is preserved and refused.
      if (record?.schemaVersion !== 1 || record.proposal?.id !== id || record.owner !== row.owner || (record.actorId ?? null) !== row.actor_id) throw new EditorialError("unavailable", "A stored proposal has an unexpected shape; it was preserved.");
      return record;
    },
  };
}
