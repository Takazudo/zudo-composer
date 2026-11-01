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
 */
export class HostedD1Error extends Error {
  constructor(outcome, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "HostedD1Error"; this.outcome = outcome;
    this.code = outcome === "limit" ? "storage-limit" : outcome === "failed" ? "storage-failed" : "storage-outcome-unknown";
  }
}

const TABLES = [
  `CREATE TABLE IF NOT EXISTS hosted_schema (id INTEGER PRIMARY KEY CHECK (id = 1), version TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS hosted_head (
    id INTEGER PRIMARY KEY CHECK (id = 1), version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (json_valid(state)),
    baseline_providers TEXT NOT NULL CHECK (json_valid(baseline_providers)),
    active_publication_id TEXT)`,
  `CREATE TABLE IF NOT EXISTS hosted_receipt (
    actor_id TEXT NOT NULL, operation_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL, result TEXT NOT NULL CHECK (json_valid(result)),
    PRIMARY KEY (actor_id, operation_key))`,
  `CREATE TABLE IF NOT EXISTS hosted_snapshot (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK (json_valid(body)))`,
  `CREATE TABLE IF NOT EXISTS hosted_publication (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK (json_valid(body)))`,
  // Insert-only Entry history; the unique sequence refuses a racing append even without the head guard.
  `CREATE TABLE IF NOT EXISTS hosted_revision (
    id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, model_id TEXT NOT NULL, record_id TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence > 0), body TEXT NOT NULL CHECK (json_valid(body)),
    UNIQUE (provider_id, model_id, record_id, sequence))`,
  // Never holds a row: inserting NULL aborts the whole batch when the head CAS did not apply.
  `CREATE TABLE IF NOT EXISTS hosted_commit_guard (ok INTEGER NOT NULL)`,
  // Create-only Content-AI proposals, scoped by owner and actor; never Content.
  `CREATE TABLE IF NOT EXISTS content_ai_proposal (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, actor_id TEXT, created_at TEXT NOT NULL, body TEXT NOT NULL CHECK (json_valid(body)))`,
];

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

/** The complete static statement list of one accepted command; sent as exactly one D1 batch(). */
export function d1CommitStatements(change) {
  const statements = [
    statement("UPDATE hosted_head SET version = ?, state = ?, baseline_providers = ?, active_publication_id = ? WHERE id = 1 AND version = ?",
      change.head.version, JSON.stringify(change.head.state), JSON.stringify(change.head.baselineProviders),
      change.head.activePublicationId ?? null, change.expectedVersion),
    statement("INSERT INTO hosted_commit_guard (ok) SELECT NULL WHERE (SELECT version FROM hosted_head WHERE id = 1) IS NOT ?", change.head.version),
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

/**
 * Explicit local initialization: creates the current schema and seeds only an absent site. Every seed row is
 * conditional on the head being absent, in one batch, so a repeated or racing start never resets or reseeds.
 * A database written under another schema version is refused (no migrations for provisional fixtures).
 */
export async function initializeD1Database(db, seed) {
  await db.batch(TABLES.map(sql => db.prepare(sql)));
  // Seed rows also require the current schema row, so a database written under another version is never seeded.
  const absent = `WHERE NOT EXISTS (SELECT 1 FROM hosted_head WHERE id = 1) AND EXISTS (SELECT 1 FROM hosted_schema WHERE id = 1 AND version = '${D1_SCHEMA_VERSION}')`;
  const statements = [statement(`INSERT INTO hosted_schema (id, version) SELECT 1, ? WHERE NOT EXISTS (SELECT 1 FROM hosted_schema WHERE id = 1)`, D1_SCHEMA_VERSION)];
  for (const receipt of seed.receipts) statements.push(statement(`INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) SELECT ?, ?, ?, ? ${absent}`,
    receipt.actorId, receipt.operationKey, receipt.fingerprint, JSON.stringify(receipt.result)));
  for (const snapshot of seed.snapshots) statements.push(statement(`INSERT INTO hosted_snapshot (id, body) SELECT ?, ? ${absent}`, snapshot.id, JSON.stringify(snapshot)));
  for (const publication of seed.publications) statements.push(statement(`INSERT INTO hosted_publication (id, body) SELECT ?, ? ${absent}`, publication.id, JSON.stringify(publication)));
  for (const revision of seed.revisions ?? []) {
    const { values } = revisionInsert(revision);
    statements.push(statement(`INSERT INTO hosted_revision (id, provider_id, model_id, record_id, sequence, body) SELECT ?, ?, ?, ?, ?, ? ${absent}`, ...values));
  }
  statements.push(statement(`INSERT INTO hosted_head (id, version, state, baseline_providers, active_publication_id) SELECT 1, 'seed', ?, ?, ? ${absent}`,
    JSON.stringify(seed.state), JSON.stringify(seed.baselineProviders), seed.activePublicationId ?? null));
  assertD1Limits(statements);
  const results = await db.batch(prepare(db, statements));
  const schema = await db.prepare("SELECT version FROM hosted_schema WHERE id = 1").first();
  if (schema?.version !== D1_SCHEMA_VERSION) throw new HostedD1Error("failed", `This D1 database uses schema ${schema?.version ?? "unknown"}, not ${D1_SCHEMA_VERSION}; it was left unchanged.`);
  return { seeded: (results.at(-1)?.meta?.changes ?? 0) === 1 };
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
 * `batch()`: the head compare-and-swap, its guard, insert-only receipt/snapshot/revisions and the publication
 * upsert commit together or not at all. No JavaScript lock and no transaction spans an await.
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
      if (fault === "receipt-persistence") statements.splice(1, 0, FAILING_STATEMENT);
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
      if (results?.[0]?.meta?.changes !== 1) throw new HostedD1Error("unknown", "D1 accepted a commit without updating the head; refusing to report success.");
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
