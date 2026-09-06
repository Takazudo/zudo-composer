import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MUTATION_LOCK_FILENAME } from "../mutation-lock";
import { createTransactionalRecordStore, type RecordEnvelope } from "../record-transaction";

type Operation = "initialize" | "snapshot" | "commit";

class TestPersistenceError extends Error {
  constructor(
    readonly operation: Operation,
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

const errors = {
  isError: (value: unknown): boolean => value instanceof TestPersistenceError,
  create: (operation: Operation, code: string, message: string, cause?: unknown) =>
    new TestPersistenceError(operation, code, message, cause === undefined ? undefined : { cause }),
  rethrow: (operation: Operation, code: "read-failed" | "write-failed", message: string, cause: unknown): never => {
    if (cause instanceof TestPersistenceError) throw cause;
    throw new TestPersistenceError(operation, code, message, { cause });
  },
};

const sandboxes: string[] = [];

async function sandbox(): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-record-txn-")));
  sandboxes.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function store(root: string, operations?: Record<string, unknown>) {
  return createTransactionalRecordStore<Operation>({
    root,
    schemaVersion: 1,
    errors,
    rootLabel: "Test records root",
    ownerLabel: "Test",
    recordLabel: "test record",
    now: () => "2026-09-01T00:00:00.000Z",
    phases: { initialize: "initialize", snapshot: "snapshot", commit: "commit" },
    ...(operations === undefined ? {} : { operations: operations as never }),
  });
}

const record = (id: string, body: string): RecordEnvelope => ({ id, json: JSON.stringify({ id, body }) });

async function liveRecordFiles(root: string): Promise<string[]> {
  const pointer = JSON.parse(await fs.readFile(join(root, "current.json"), "utf8")) as { generation: number };
  return (await fs.readdir(join(root, "generations", String(pointer.generation)))).sort();
}

describe("transactional record store", () => {
  it("commits a multi-record transaction as one visible step", async () => {
    const root = await sandbox();
    const written = await store(root);
    const empty = await written.snapshot();
    expect(empty.generation).toBe(0);
    expect(empty.records).toEqual([]);

    const token = await written.commit(() => ({
      records: [record("alpha", "one"), record("beta", "two"), record("gamma", "three")],
      result: "committed",
    }));
    expect(token).toBe("committed");

    const reopened = await store(root);
    const snapshot = await reopened.snapshot();
    expect(snapshot.records.map(({ id }) => id)).toEqual(["alpha", "beta", "gamma"]);
    expect(await liveRecordFiles(root)).toEqual(["alpha.json", "beta.json", "gamma.json"]);
    // Superseded generations are unreferenced, so only the live one is kept.
    expect(await fs.readdir(join(root, "generations"))).toEqual([String(snapshot.generation)]);
  });

  it("leaves no partial records when a multi-record transaction fails", async () => {
    const root = await sandbox();
    const initial = await store(root);
    await initial.commit(() => ({ records: [record("alpha", "one")], result: null }));
    const before = await initial.snapshot();

    // A plan that validates the whole graph and rejects it writes nothing.
    await expect(initial.commit(() => {
      throw new TestPersistenceError("commit", "validation", "Graph validation rejected the transaction.");
    })).rejects.toMatchObject({ code: "validation" });
    expect(await initial.snapshot()).toEqual(before);
    expect(await liveRecordFiles(root)).toEqual(["alpha.json"]);

    // A failure part-way through staging four records leaves none of them live.
    let written = 0;
    const failing = await store(root, {
      open: async (path: string, flags: number, mode?: number) => {
        if (path.endsWith(".json") && ++written === 3) {
          throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
        }
        return fs.open(path, flags, mode);
      },
    });
    await expect(failing.commit(() => ({
      records: [record("alpha", "changed"), record("beta", "two"), record("gamma", "three"), record("delta", "four")],
      result: null,
    }))).rejects.toMatchObject({ code: "write-failed" });

    const after = await (await store(root)).snapshot();
    expect(after).toEqual(before);
    expect(after.records.map(({ id }) => id)).toEqual(["alpha"]);
    expect(await liveRecordFiles(root)).toEqual(["alpha.json"]);
    // The partially staged generation is removed rather than left to be read.
    expect(await fs.readdir(join(root, "generations"))).toEqual([String(before.generation)]);
    expect(await fs.readdir(root)).not.toContain(MUTATION_LOCK_FILENAME);
  });

  it("reports an uncertain commit and retains the lock when durability is unproven", async () => {
    const root = await sandbox();
    const seeded = await store(root);
    await seeded.commit(() => ({ records: [record("alpha", "one")], result: null }));

    let renamed = false;
    const uncertain = await store(root, {
      rename: async (from: string, to: string) => {
        await fs.rename(from, to);
        if (to.endsWith("current.json")) renamed = true;
      },
      open: async (path: string, flags: number, mode?: number) => {
        const handle = await fs.open(path, flags, mode);
        if ((await handle.stat()).isDirectory()) {
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            if (renamed) throw Object.assign(new Error("directory fsync unavailable"), { code: "EINVAL" });
            await sync();
          };
        }
        return handle;
      },
    });
    await expect(uncertain.commit(() => ({ records: [record("alpha", "two")], result: null })))
      .rejects.toMatchObject({ code: "commit-uncertain" });
    // A retained lock is the fail-closed signal: the next writer must not guess.
    expect(await fs.readFile(join(root, MUTATION_LOCK_FILENAME), "utf8")).toContain('"pid"');
    await expect(seeded.commit(() => ({ records: [], result: null })))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects a stale snapshot token without touching the live generation", async () => {
    const root = await sandbox();
    const one = await store(root);
    await one.commit(() => ({ records: [record("alpha", "one")], result: null }));
    const stale = await one.mutationToken();
    await one.commit(() => ({ records: [record("alpha", "two")], result: null }));
    const current = await one.snapshot();
    await expect(one.commit(() => ({ records: [], result: null }), { expectedMutationToken: stale }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await one.snapshot()).toEqual(current);
  });

  it("refuses to read a record whose digest no longer matches the pointer", async () => {
    const root = await sandbox();
    const seeded = await store(root);
    await seeded.commit(() => ({ records: [record("alpha", "one")], result: null }));
    const { generation } = await seeded.snapshot();
    await fs.writeFile(join(root, "generations", String(generation), "alpha.json"), '{"id":"alpha","body":"tampered"}');
    await expect((await store(root)).snapshot()).rejects.toMatchObject({ code: "blocked" });
  });

  it("prevents two independent processes from interleaving a mutation on one root", async () => {
    const root = await sandbox();
    const seeded = await store(root);
    await seeded.commit(() => ({ records: [record("alpha", "0")], result: null }));

    // Each child reads the whole record set and appends its own marker while
    // holding the cross-process lock. Interleaving would let the later writer
    // observe the earlier state and drop its record.
    const source = `import {createTransactionalRecordStore} from './src/shared/node-fs/record-transaction.ts';
      class E extends Error { constructor(operation, code, message, options) { super(message, options); this.operation = operation; this.code = code; } }
      const errors = {
        isError: (value) => value instanceof E,
        create: (operation, code, message, cause) => new E(operation, code, message, cause === undefined ? undefined : { cause }),
        rethrow: (operation, code, message, cause) => { if (cause instanceof E) throw cause; throw new E(operation, code, message, { cause }); },
      };
      const store = await createTransactionalRecordStore({
        root: process.argv[1], schemaVersion: 1, errors,
        rootLabel: 'Test records root', ownerLabel: 'Test', recordLabel: 'test record',
        phases: { initialize: 'initialize', snapshot: 'snapshot', commit: 'commit' },
      });
      try {
        await store.commit(async (before) => {
          await new Promise((done) => setTimeout(done, 750));
          return { records: [...before.records, { id: process.argv[2], json: JSON.stringify({ id: process.argv[2] }) }], result: null };
        });
        process.stdout.write('ok');
      } catch (error) { process.stdout.write(error.code); }`;

    const run = (id: string) => new Promise<string>((resolveRun, rejectRun) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source, root, id], {
        cwd: process.cwd(),
        timeout: 20000,
      });
      let output = "";
      let errorOutput = "";
      child.stdout.on("data", (chunk) => { output += String(chunk); });
      child.stderr.on("data", (chunk) => { errorOutput += String(chunk); });
      child.on("error", rejectRun);
      child.on("close", (code) => { if (code === 0) resolveRun(output); else rejectRun(new Error(errorOutput)); });
    });

    // One writer wins; the other is refused rather than silently overwriting.
    expect((await Promise.all([run("beta"), run("gamma")])).sort()).toEqual(["conflict", "ok"]);
    const after = await (await store(root)).snapshot();
    expect(after.records).toHaveLength(2);
    expect(after.records.map(({ id }) => id)).toContain("alpha");
  }, 30000);
});
