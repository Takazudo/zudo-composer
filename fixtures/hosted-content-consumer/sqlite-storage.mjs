// Node 24 fixture only. This module never enters a Composer public runtime graph.
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const copy = value => value === undefined ? value : structuredClone(value);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const busy = error => error?.code === "ERR_SQLITE_ERROR" &&
  (error.errcode === 5 || error.errcode === 6 || /database (?:is )?(?:locked|busy)/i.test(error.message));

/** Retry only lock acquisition. Never rerun an async callback with external effects. */
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

function readDatabase(connection) {
  const row = connection.prepare("SELECT aggregate FROM hosted_site WHERE id = 1").get();
  if (!row) throw new Error("Hosted SQLite fixture has not been seeded");
  const database = JSON.parse(row.aggregate);
  database.receipts = connection.prepare(
    "SELECT actor_id, operation_key, fingerprint, result FROM hosted_receipt ORDER BY sequence"
  ).all().map(receipt => ({ actorId: receipt.actor_id, operationKey: receipt.operation_key,
    fingerprint: receipt.fingerprint, result: JSON.parse(receipt.result) }));
  return database;
}

function encodeAggregate(database) {
  const aggregate = { ...database };
  delete aggregate.receipts;
  return JSON.stringify(aggregate);
}

/** Initialize once. Subsequent processes must open this same file without a seed. */
export async function initializeSqliteDatabase(filename, seed) {
  await mkdir(dirname(filename), { recursive: true });
  const connection = new DatabaseSync(filename, { timeout: 0 });
  try {
    connection.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
    await acquire(connection);
    try {
      connection.exec(`
        CREATE TABLE IF NOT EXISTS hosted_site (
          id INTEGER PRIMARY KEY CHECK (id = 1), aggregate TEXT NOT NULL CHECK (json_valid(aggregate))
        );
        CREATE TABLE IF NOT EXISTS hosted_receipt (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id TEXT NOT NULL, operation_key TEXT NOT NULL,
          fingerprint TEXT NOT NULL, result TEXT NOT NULL CHECK (json_valid(result)),
          UNIQUE (actor_id, operation_key)
        );
      `);
      const existing = connection.prepare("SELECT id FROM hosted_site WHERE id = 1").get();
      if (!existing) {
        connection.prepare("INSERT INTO hosted_site (id, aggregate) VALUES (1, ?)").run(encodeAggregate(seed));
        const insert = connection.prepare(
          "INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES (?, ?, ?, ?)"
        );
        for (const receipt of seed.receipts) insert.run(receipt.actorId, receipt.operationKey,
          receipt.fingerprint, JSON.stringify(receipt.result));
      }
      connection.exec("COMMIT");
    } catch (error) { connection.exec("ROLLBACK"); throw error; }
  } finally { connection.close(); }
}

/**
 * A separate SQLite connection per handle, with database-enforced serialization.
 * BEGIN IMMEDIATE remains open across the async callback and all receipt writes.
 * No JavaScript mutex supplies the cross-handle or cross-process guarantee.
 */
export function openSqliteHandle(filename, { busyDeadlineMilliseconds = 8_000 } = {}) {
  const connection = new DatabaseSync(filename, { timeout: 0 });
  connection.exec("PRAGMA synchronous = FULL;");
  let closed = false;
  let active = false;
  let fault;
  let held;
  let heldCommit;
  const check = () => { if (closed) throw new Error("SQLite handle is closed"); };
  // A handle represents one connection. A host needs a fresh handle per concurrent transaction.
  const transaction = async work => {
    check();
    if (active) throw new Error("Concurrent operations on one SQLite connection require separate handles");
    active = true;
    const selectedFault = fault; fault = undefined;
    const selectedGate = held; held = undefined;
    const selectedCommitGate = heldCommit; heldCommit = undefined;
    let started = false;
    let committed = false;
    try {
      await acquire(connection, busyDeadlineMilliseconds); started = true;
      if (selectedGate) { selectedGate.entered(); await selectedGate.wait; }
      const database = readDatabase(connection);
      const existingReceipts = new Map(database.receipts.map(receipt => [
        JSON.stringify([receipt.actorId, receipt.operationKey]), JSON.stringify(receipt)
      ]));
      const result = await work(database);
      connection.prepare("UPDATE hosted_site SET aggregate = ? WHERE id = 1").run(encodeAggregate(database));
      if (selectedFault === "receipt-persistence") {
        // An actual SQLite constraint error after aggregate UPDATE proves rollback covers both.
        connection.prepare(
          "INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES (?, ?, ?, ?)"
        ).run("fault", "fault", "fault", "invalid-json");
      }
      const insert = connection.prepare(
        "INSERT INTO hosted_receipt (actor_id, operation_key, fingerprint, result) VALUES (?, ?, ?, ?)"
      );
      const remaining = new Set(existingReceipts.keys());
      for (const receipt of database.receipts) {
        const key = JSON.stringify([receipt.actorId, receipt.operationKey]);
        if (existingReceipts.has(key)) {
          if (existingReceipts.get(key) !== JSON.stringify(receipt)) throw new Error("Committed receipts are immutable");
          remaining.delete(key);
        } else insert.run(receipt.actorId, receipt.operationKey, receipt.fingerprint, JSON.stringify(receipt.result));
      }
      if (remaining.size) throw new Error("This initial adapter does not prune or recycle committed operation keys");
      if (selectedCommitGate) { selectedCommitGate.entered(); await selectedCommitGate.wait; }
      if (selectedFault === "before-commit") throw new Error("Injected failure before COMMIT");
      connection.exec("COMMIT"); committed = true;
      if (selectedFault === "lost-acknowledgement") throw new Error("Injected response loss after durable COMMIT");
      return copy(result);
    } catch (error) {
      if (started && !committed) connection.exec("ROLLBACK");
      throw error;
    } finally { active = false; }
  };
  return {
    storage: {
      // A read transaction holds one coherent WAL snapshot for aggregate and receipt queries.
      async read() {
        check();
        if (active) throw new Error("Read requires an independent handle while this connection is in a transaction");
        connection.exec("BEGIN");
        try { const value = readDatabase(connection); connection.exec("COMMIT"); return value; }
        catch (error) { connection.exec("ROLLBACK"); throw error; }
      },
      transaction,
    },
    faultNextTransaction(next) { check(); fault = next; },
    holdNextTransaction() {
      check();
      let entered; let release;
      const enteredPromise = new Promise(resolve => { entered = resolve; });
      const wait = new Promise(resolve => { release = resolve; });
      held = { entered, wait };
      return { entered: enteredPromise, release };
    },
    /** Process-crash proof hook: aggregate UPDATE and receipt INSERT have already happened. */
    holdNextCommit() {
      check();
      let entered; let release;
      const enteredPromise = new Promise(resolve => { entered = resolve; });
      const wait = new Promise(resolve => { release = resolve; });
      heldCommit = { entered, wait };
      return { entered: enteredPromise, release };
    },
    close() {
      if (active) throw new Error("Cannot close an in-flight SQLite transaction");
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
