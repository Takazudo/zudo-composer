// Node 24 fixture only. This module never enters a Composer public runtime graph.
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const busy = error => error?.code === "ERR_SQLITE_ERROR" &&
  (error.errcode === 5 || error.errcode === 6 || /database (?:is )?(?:locked|busy)/i.test(error.message));
// SQLITE_CONSTRAINT and its extended codes: the conditional commit was refused.
const constraint = error => error?.code === "ERR_SQLITE_ERROR" && (error.errcode & 0xff) === 19;

/** Retry only lock acquisition. No host code runs while the write lock is held. */
async function acquire(connection, deadlineMilliseconds = 8_000) {
  const deadline = Date.now() + deadlineMilliseconds;
  let attempts = 0;
  for (;;) {
    try { connection.exec("BEGIN IMMEDIATE"); return; }
    catch (error) {
      if (!busy(error) || Date.now() >= deadline) throw error;
      await delay(Math.min(5 * 2 ** Math.min(attempts++, 4), Math.max(1, deadline - Date.now())));
    }
  }
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS hosted_head (
    id INTEGER PRIMARY KEY CHECK (id = 1), version TEXT NOT NULL,
    state TEXT NOT NULL CHECK (json_valid(state)),
    baseline_providers TEXT NOT NULL CHECK (json_valid(baseline_providers)),
    active_publication_id TEXT
  );
  CREATE TABLE IF NOT EXISTS hosted_receipt (
    actor_id TEXT NOT NULL, operation_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL, result TEXT NOT NULL CHECK (json_valid(result)),
    PRIMARY KEY (actor_id, operation_key)
  );
  CREATE TABLE IF NOT EXISTS hosted_snapshot (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK (json_valid(body)));
  CREATE TABLE IF NOT EXISTS hosted_publication (id TEXT PRIMARY KEY, body TEXT NOT NULL CHECK (json_valid(body)));
  -- Never holds a row: inserting NULL aborts the whole commit when the head CAS did not apply.
  CREATE TABLE IF NOT EXISTS hosted_commit_guard (ok INTEGER NOT NULL);
`;

/**
 * The exact statement list a host would send as one D1 batch(). Every statement is
 * static SQL with bound values, so no JavaScript decision happens between them.
 */
function commitStatements(change) {
  const statements = [
    ["UPDATE hosted_head SET version = ?, state = ?, baseline_providers = ?, active_publication_id = ? WHERE id = 1 AND version = ?",
      change.head.version, JSON.stringify(change.head.state), JSON.stringify(change.head.baselineProviders),
      change.head.activePublicationId, change.expectedVersion],
    ["INSERT INTO hosted_commit_guard (ok) SELECT NULL WHERE (SELECT version FROM hosted_head WHERE id = 1) IS NOT ?", change.head.version],
  ];
  if (change.receipt) statements.push(["INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES (?, ?, ?, ?)",
    change.receipt.actorId, change.receipt.operationKey, change.receipt.fingerprint, JSON.stringify(change.receipt.result)]);
  if (change.snapshot) statements.push(["INSERT INTO hosted_snapshot (id, body) VALUES (?, ?)", change.snapshot.id, JSON.stringify(change.snapshot)]);
  if (change.publication) statements.push(["INSERT INTO hosted_publication (id, body) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body",
    change.publication.id, JSON.stringify(change.publication)]);
  return statements;
}

const readHead = connection => {
  const row = connection.prepare("SELECT version, state, baseline_providers, active_publication_id FROM hosted_head WHERE id = 1").get();
  if (!row) throw new Error("Hosted SQLite fixture has not been seeded");
  return { version: row.version, state: JSON.parse(row.state), baselineProviders: JSON.parse(row.baseline_providers),
    activePublicationId: row.active_publication_id ?? null };
};
const readBody = (connection, table, id) => {
  const row = connection.prepare(`SELECT body FROM ${table} WHERE id = ?`).get(id);
  return row ? JSON.parse(row.body) : null;
};

function dumpDatabase(connection) {
  const head = readHead(connection);
  return {
    state: head.state, baselineProviders: head.baselineProviders, activePublicationId: head.activePublicationId,
    receipts: connection.prepare("SELECT actor_id, operation_key, fingerprint, result FROM hosted_receipt ORDER BY actor_id, operation_key").all()
      .map(receipt => ({ actorId: receipt.actor_id, operationKey: receipt.operation_key, fingerprint: receipt.fingerprint, result: JSON.parse(receipt.result) })),
    snapshots: connection.prepare("SELECT body FROM hosted_snapshot ORDER BY id").all().map(row => JSON.parse(row.body)),
    publications: connection.prepare("SELECT body FROM hosted_publication ORDER BY id").all().map(row => JSON.parse(row.body)),
  };
}

/** Initialize once. Subsequent processes must open this same file without a seed. */
export async function initializeSqliteDatabase(filename, seed) {
  await mkdir(dirname(filename), { recursive: true });
  const connection = new DatabaseSync(filename, { timeout: 0 });
  try {
    connection.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    await acquire(connection);
    try {
      connection.exec(SCHEMA);
      if (!connection.prepare("SELECT id FROM hosted_head WHERE id = 1").get()) {
        connection.prepare("INSERT INTO hosted_head (id, version, state, baseline_providers, active_publication_id) VALUES (1, 'seed', ?, ?, ?)")
          .run(JSON.stringify(seed.state), JSON.stringify(seed.baselineProviders), seed.activePublicationId ?? null);
        for (const receipt of seed.receipts) connection.prepare("INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES (?, ?, ?, ?)")
          .run(receipt.actorId, receipt.operationKey, receipt.fingerprint, JSON.stringify(receipt.result));
        for (const snapshot of seed.snapshots) connection.prepare("INSERT INTO hosted_snapshot (id, body) VALUES (?, ?)").run(snapshot.id, JSON.stringify(snapshot));
        for (const publication of seed.publications) connection.prepare("INSERT INTO hosted_publication (id, body) VALUES (?, ?)").run(publication.id, JSON.stringify(publication));
      }
      connection.exec("COMMIT");
    } catch (error) { connection.exec("ROLLBACK"); throw error; }
  } finally { connection.close(); }
}

const gate = () => {
  let entered; let release;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  return { held: { entered, wait }, public: { entered: enteredPromise, release } };
};

/**
 * A separate SQLite connection per handle. Each commit is one short write transaction
 * running the batch statements; database constraints, not JavaScript locks, refuse a stale commit.
 */
export function openSqliteHandle(filename, { busyDeadlineMilliseconds = 8_000 } = {}) {
  const connection = new DatabaseSync(filename, { timeout: 0 });
  connection.exec("PRAGMA synchronous = FULL;");
  let closed = false;
  let active = false;
  let fault;
  let held;
  let heldDurable;
  const check = () => { if (closed) throw new Error("SQLite handle is closed"); };
  const commit = async change => {
    check();
    if (active) throw new Error("Concurrent commits on one SQLite connection require separate handles");
    active = true;
    const selectedFault = fault; fault = undefined;
    const selectedGate = held; held = undefined;
    const selectedDurableGate = heldDurable; heldDurable = undefined;
    let started = false;
    let committed = false;
    try {
      // The conformance gate holds a prepared commit before it takes the write lock.
      if (selectedGate) { selectedGate.entered(); await selectedGate.wait; check(); }
      await acquire(connection, busyDeadlineMilliseconds); started = true;
      const statements = commitStatements(change);
      for (const [index, [sql, ...values]] of statements.entries()) {
        try { connection.prepare(sql).run(...values); }
        catch (error) { if (constraint(error)) { connection.exec("ROLLBACK"); started = false; return false; } throw error; }
        if (index === 0 && selectedFault === "receipt-persistence") {
          // An actual SQLite CHECK failure after the head UPDATE proves rollback covers both.
          try { connection.prepare("INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES ('fault', 'fault', 'fault', 'invalid-json')").run(); }
          catch (error) { throw new Error(`Injected receipt persistence failure: ${error.message}`, { cause: error }); }
        }
      }
      if (selectedDurableGate) { selectedDurableGate.entered(); await selectedDurableGate.wait; }
      if (selectedFault === "before-commit") throw new Error("Injected failure before COMMIT");
      connection.exec("COMMIT"); committed = true;
      if (selectedFault === "lost-acknowledgement") throw new Error("Injected response loss after durable COMMIT");
      return true;
    } catch (error) {
      if (started && !committed) connection.exec("ROLLBACK");
      throw error;
    } finally { active = false; }
  };
  const read = work => { check(); if (active) throw new Error("Read requires an independent handle while this connection is committing"); return work(); };
  return {
    storage: {
      async readHead() { return read(() => readHead(connection)); },
      async readReceipt(actorId, operationKey) {
        return read(() => {
          const row = connection.prepare("SELECT actor_id, operation_key, fingerprint, result FROM hosted_receipt WHERE actor_id = ? AND operation_key = ?").get(actorId, operationKey);
          return row ? { actorId: row.actor_id, operationKey: row.operation_key, fingerprint: row.fingerprint, result: JSON.parse(row.result) } : null;
        });
      },
      async readSnapshot(snapshotId) { return read(() => readBody(connection, "hosted_snapshot", snapshotId)); },
      async readPublication(publicationId) { return read(() => readBody(connection, "hosted_publication", publicationId)); },
      commit,
    },
    // A read transaction gives every table the same WAL snapshot.
    async dump() {
      return read(() => {
        connection.exec("BEGIN");
        try { const value = dumpDatabase(connection); connection.exec("COMMIT"); return value; }
        catch (error) { connection.exec("ROLLBACK"); throw error; }
      });
    },
    faultNextCommit(next) { check(); fault = next; },
    holdNextCommit() { check(); const created = gate(); held = created.held; return created.public; },
    /** Process-crash proof hook: every batch statement has run inside the open transaction, before COMMIT. */
    holdNextDurableCommit() { check(); const created = gate(); heldDurable = created.held; return created.public; },
    close() {
      if (active) throw new Error("Cannot close an in-flight SQLite commit");
      if (!closed) { connection.close(); closed = true; }
    },
  };
}

/** Fresh on-disk database per scenario; restart closes every connection. */
export function createSqliteConformanceFactory({ directory, keepFiles = false } = {}) {
  return {
    async create(seed, scenario) {
      const parent = directory ?? tmpdir();
      await mkdir(parent, { recursive: true });
      const root = await mkdtemp(join(parent, `composer-hosted-${scenario}-`));
      const filename = join(root, "database.sqlite");
      await initializeSqliteDatabase(filename, seed);
      const handles = new Set();
      let disposed = false;
      const closeHandles = () => { for (const handle of handles) handle.close(); handles.clear(); };
      return {
        filename,
        async open() {
          if (disposed) throw new Error("SQLite conformance backend is closed");
          const handle = openSqliteHandle(filename); handles.add(handle); return handle;
        },
        async restart() { closeHandles(); },
        async close() {
          closeHandles(); disposed = true;
          if (!keepFiles) await rm(root, { recursive: true, force: true });
        },
      };
    },
  };
}
