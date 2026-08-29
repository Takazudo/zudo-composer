import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtureDocument } from "../../../__tests__/fixtures";
import { COMPOSITION_SCHEMA_VERSION } from "../../../model/types";
import type { CompositionRecord } from "../../../library";
import {
  createFilesystemCompositionStore,
  type FilesystemCompositionStore,
  type FilesystemCompositionStoreOptions,
} from "../index";

const T1 = "2026-01-02T03:04:05.000Z";
const T2 = "2026-01-02T04:04:05.000Z";

let sandbox: string;
let root: string;

function record(id = "a", timestamp = T1): CompositionRecord {
  const document = createFixtureDocument();
  document.id = id;
  return { id, createdAt: T1, updatedAt: timestamp, document };
}

function jsonPath(id: string): string {
  return join(root, `composition-${id}.composition.json`);
}

function jsxPath(id: string): string {
  return join(root, `composition-${id}.tsx`);
}

async function createStore(
  options: Partial<FilesystemCompositionStoreOptions> = {},
): Promise<FilesystemCompositionStore> {
  return createFilesystemCompositionStore({
    compositionsRoot: root,
    provideJsx: (value) => `jsx:${value.id}:${value.updatedAt}`,
    ...options,
  });
}

async function names(): Promise<string[]> {
  return (await readdir(root)).sort();
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "zudo-composer-files-"));
  root = join(sandbox, "compositions");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("filesystem composition store safety", () => {
  it.each(["../escape", "encoded%2fslash", "with/slash", ".hidden", "CAPS"])(
    "rejects traversal-like or encoded id %s before touching files",
    async (id) => {
      const store = await createStore();
      const unsafe = record("safe") as CompositionRecord;
      unsafe.id = id;
      unsafe.document.id = id;

      await expect(store.put(unsafe, "never")).rejects.toMatchObject({
        operation: "put",
        code: "validation",
      });
      await expect(store.get(id)).rejects.toMatchObject({ operation: "get", code: "validation" });
      expect(await names()).toEqual([]);
    },
  );

  it("rejects a mismatched record/document id", async () => {
    const store = await createStore();
    const value = record("a");
    value.document.id = "b";
    await expect(store.put(value, "never")).rejects.toMatchObject({
      operation: "put",
      code: "validation",
    });
  });

  it("validates every new binding inside the write queue even with pre-generated JSX", async () => {
    const store = await createStore();
    const source = record("source");
    source.document.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "split-1", slotId: "left" } },
    };
    await store.put(source, "source jsx");
    await store.put(record("ordinary"), "ordinary jsx");

    for (const [id, sourceRecordId, outletId] of [
      ["self", "self", "outlet-main"],
      ["missing", "gone", "outlet-main"],
      ["non-global", "ordinary", "outlet-main"],
      ["wrong-outlet", "source", "gone"],
    ] as const) {
      const candidate = record(id);
      candidate.document.binding = { sourceRecordId, outletId };
      await expect(store.put(candidate, "pre-generated jsx")).rejects.toMatchObject({
        operation: "put",
        code: "conflict",
      });
      await expect(readFile(jsonPath(id), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("serializes final dependency checks for Global-template source mutations", async () => {
    const store = await createStore({ now: () => T2 });
    const source = record("source");
    source.document.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "split-1", slotId: "left" } },
    };
    const consumer = record("consumer");
    consumer.document.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    await store.put(source, "source jsx");
    await store.put(consumer, "consumer jsx");

    await expect(store.deleteWithDependencyCheck("source")).resolves.toMatchObject({
      status: "blocked",
      dependents: [{ summary: { id: "consumer" }, binding: consumer.document.binding }],
    });
    await expect(store.unpublishWithDependencyCheck("source")).resolves.toMatchObject({
      status: "blocked",
      dependents: [{ summary: { name: "Product overview" } }],
    });
    await expect(store.clear()).rejects.toMatchObject({ operation: "clear", code: "blocked" });
    expect(JSON.parse(await readFile(jsonPath("source"), "utf8"))).toMatchObject({
      document: { publication: { kind: "global-template" } },
    });

    await store.delete("consumer");
    await expect(store.unpublishWithDependencyCheck("source")).resolves.toEqual({ status: "unpublished" });
    const unpublished = JSON.parse(await readFile(jsonPath("source"), "utf8"));
    expect(unpublished).toMatchObject({ updatedAt: T2 });
    expect(unpublished.document).not.toHaveProperty("publication");
  });

  it("keeps canonical binding intact when a lifecycle save cannot replace derived output", async () => {
    const initial = await createStore();
    const source = record("source");
    source.document.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "split-1", slotId: "left" } },
    };
    const bound = record("consumer", T1);
    bound.document.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    await initial.put(source, "source jsx");
    await initial.put(bound, "bound jsx");

    const failing = await createStore({
      operations: {
        rename: async (from, to) => {
          if (to.endsWith(".tsx")) throw Object.assign(new Error("injected JSX rename failure"), { code: "EIO" });
          await rename(from, to);
        },
      },
    });
    const detached = structuredClone(bound);
    detached.updatedAt = T2;
    delete detached.document.binding;
    await expect(failing.saveLifecycleRecord(detached)).rejects.toMatchObject({
      operation: "put",
      code: "write-failed",
    });
    expect(JSON.parse(await readFile(jsonPath("consumer"), "utf8"))).toMatchObject({
      updatedAt: T1,
      document: { binding: { sourceRecordId: "source", outletId: "outlet-main" } },
    });
  });

  it("rejects a new binding after its Global-template source has been deleted", async () => {
    const store = await createStore({
      provideJsx: (value) => `jsx:${value.id}`,
    });
    const source = record("source");
    source.document.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "split-1", slotId: "left" } },
    };
    await store.put(source, "source jsx");
    await expect(store.deleteWithDependencyCheck("source")).resolves.toEqual({ status: "deleted" });

    const lateConsumer = record("late-consumer");
    lateConsumer.document.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    await expect(store.put(lateConsumer)).rejects.toMatchObject({ operation: "put", code: "conflict" });
    await expect(readFile(jsonPath("late-consumer"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a symlink root and a symlink file that resolves outside the root", async () => {
    const outside = join(sandbox, "outside");
    await mkdir(outside);
    await symlink(outside, root, "dir");
    await expect(createStore()).rejects.toMatchObject({ operation: "initialize", code: "blocked" });

    await unlink(root);
    const store = await createStore();
    const externalJson = join(outside, "external.json");
    await writeFile(externalJson, JSON.stringify(record("a")));
    await symlink(externalJson, jsonPath("a"));
    await expect(store.get("a")).rejects.toMatchObject({ operation: "get", code: "blocked" });
    expect(await readFile(externalJson, "utf8")).toBe(JSON.stringify(record("a")));
  });

  it("detects root replacement before a mutation and never writes through it", async () => {
    const store = await createStore();
    const outside = join(sandbox, "replacement");
    await mkdir(outside);
    await rm(root, { recursive: true });
    await symlink(outside, root, "dir");

    await expect(store.put(record(), "never")).rejects.toMatchObject({
      operation: "put",
      code: "blocked",
    });
    expect(await readdir(outside)).toEqual([]);
  });

  it("uses exclusive random temporary files and survives a name collision", async () => {
    await mkdir(root);
    const collision = ".composition-a.composition.json.collision1.tmp";
    await writeFile(join(root, collision), "manual");
    const tokens = ["collision1", "canonical2", "derived03"];
    const store = await createStore({ randomToken: () => tokens.shift()! });

    await store.put(record(), "exact jsx");

    expect(await readFile(join(root, collision), "utf8")).toBe("manual");
    expect(await readFile(jsxPath("a"), "utf8")).toBe("exact jsx");
    expect((await names()).filter((name) => name.endsWith(".tmp"))).toEqual([collision]);
  });

  it("refuses to replace symlink final paths", async () => {
    const store = await createStore();
    const outside = join(sandbox, "outside.tsx");
    await writeFile(outside, "outside");
    await symlink(outside, jsxPath("a"));

    await expect(store.put(record(), "new jsx")).resolves.toMatchObject({
      canonical: { status: "saved" },
      derived: {
        status: "blocked",
        records: [{
          recordId: "a",
          status: "blocked",
          staleArtifact: expect.stringContaining("not a regular file"),
        }],
      },
    });
    expect(await readFile(outside, "utf8")).toBe("outside");
    expect(JSON.parse(await readFile(jsonPath("a"), "utf8"))).toMatchObject({ id: "a" });
  });
});

describe("filesystem composition store recovery", () => {
  it("keeps a valid consumer listable, readable, and saveable when its source JSON is invalid", async () => {
    const initial = await createStore();
    const source = record("source");
    source.document.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "split-1", slotId: "left" } },
    };
    const consumer = record("consumer", T1);
    consumer.document.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    await initial.put(source, "source output");
    await initial.put(consumer, "stale consumer output");
    await writeFile(jsonPath("source"), "{ invalid source JSON");

    const diagnostic = "The linked Global template is unavailable, so its consumer module cannot be generated.";
    const store = await createStore({
      provideJsx: (value, request) => {
        const sourceOutcome = request.sourceOutcomes.find((entry) => entry.id === value.document.binding?.sourceRecordId);
        return sourceOutcome?.outcome.status === "invalid"
          ? { status: "blocked", reason: diagnostic }
          : `jsx:${value.id}`;
      },
    });

    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({
        id: "consumer",
        derivedOutput: { recordId: "consumer", status: "blocked", reason: diagnostic },
      }),
    ]);
    await expect(store.get("consumer")).resolves.toMatchObject({
      status: "loaded",
      record: { id: "consumer" },
      derivedOutput: { recordId: "consumer", status: "blocked", reason: diagnostic },
    });

    const edited = structuredClone(consumer);
    edited.updatedAt = T2;
    edited.document.name = "Still canonical";
    await expect(store.put(edited)).resolves.toMatchObject({
      canonical: { status: "saved" },
      derived: { status: "blocked", records: [{ recordId: "consumer", status: "blocked", reason: diagnostic }] },
    });
    expect(JSON.parse(await readFile(jsonPath("consumer"), "utf8"))).toMatchObject({
      updatedAt: T2,
      document: { name: "Still canonical", binding: consumer.document.binding },
    });
  });

  it("keeps a linked consumer canonical when its source disappears and removes stale generated output", async () => {
    const initial = await createStore();
    const source = record("source");
    source.document.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "split-1", slotId: "left" } },
    };
    const consumer = record("consumer", T1);
    consumer.document.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    await initial.put(source, "source output");
    await initial.put(consumer, "old consumer output");
    await unlink(jsonPath("source"));
    await unlink(jsxPath("source"));

    const diagnostic = "The linked Global template is unavailable, so its consumer module cannot be generated.";
    const store = await createStore({
      provideJsx: (value, request) => {
        expect(request.records.map((candidate) => candidate.id)).toEqual(["consumer"]);
        expect(request.targetIds).toEqual(["consumer"]);
        return value.id === "consumer" ? { status: "blocked", reason: diagnostic } : "unexpected";
      },
    });
    const edited = structuredClone(consumer);
    edited.updatedAt = T2;
    edited.document.name = "Local edits survive";

    await expect(store.put(edited)).resolves.toMatchObject({
      canonical: { status: "saved" },
      derived: { status: "blocked", records: [{ recordId: "consumer", status: "blocked", reason: diagnostic }] },
    });
    await expect(readFile(jsxPath("consumer"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.get("consumer")).resolves.toMatchObject({
      status: "loaded",
      record: { document: { name: "Local edits survive", binding: consumer.document.binding } },
      derivedOutput: { status: "blocked", reason: diagnostic },
    });
  });

  it("leaves the old pair intact when canonical JSON rename fails", async () => {
    const initial = await createStore();
    await initial.put(record("a", T1), "old jsx");
    const oldJson = await readFile(jsonPath("a"), "utf8");

    const store = await createStore({
      operations: {
        rename: async (from, to) => {
          if (to.endsWith(".composition.json")) {
            const failure = Object.assign(new Error("injected JSON rename failure"), { code: "EIO" });
            throw failure;
          }
          await rename(from, to);
        },
      },
    });
    await expect(store.put(record("a", T2), "new jsx")).rejects.toMatchObject({
      operation: "put",
      code: "write-failed",
    });

    expect(await readFile(jsonPath("a"), "utf8")).toBe(oldJson);
    expect(await readFile(jsxPath("a"), "utf8")).toBe("old jsx");
    expect((await names()).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("keeps committed canonical JSON when JSX rename fails, then repairs it", async () => {
    const initial = await createStore();
    await initial.put(record("a", T1), "old jsx");
    let failDerived = true;
    const failing = await createStore({
      operations: {
        rename: async (from, to) => {
          if (failDerived && to.endsWith(".tsx")) {
            failDerived = false;
            throw Object.assign(new Error("injected JSX rename failure"), { code: "EIO" });
          }
          await rename(from, to);
        },
      },
    });

    await expect(failing.put(record("a", T2), "new jsx")).resolves.toMatchObject({
      canonical: { status: "saved" },
      derived: { status: "blocked", records: [{ recordId: "a", status: "blocked" }] },
    });
    expect(JSON.parse(await readFile(jsonPath("a"), "utf8"))).toMatchObject({ updatedAt: T2 });
    await expect(readFile(jsxPath("a"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const outcome = await failing.get("a");
    expect(outcome).toMatchObject({ status: "loaded", record: { updatedAt: T2 } });
    expect(await readFile(jsxPath("a"), "utf8")).toBe(`jsx:a:${T2}`);
  });

  it("repairs missing and stale JSX on get/list without changing canonical bytes", async () => {
    const store = await createStore();
    await store.put(record("a", T1), "initial");
    const canonical = await readFile(jsonPath("a"), "utf8");

    await unlink(jsxPath("a"));
    expect(await store.get("a")).toMatchObject({ status: "loaded" });
    expect(await readFile(jsxPath("a"), "utf8")).toBe(`jsx:a:${T1}`);

    await writeFile(jsxPath("a"), "stale");
    expect(await store.list()).toHaveLength(1);
    expect(await readFile(jsxPath("a"), "utf8")).toBe(`jsx:a:${T1}`);
    expect(await readFile(jsonPath("a"), "utf8")).toBe(canonical);
  });

  it("reports invalid JSON and filename/id mismatches without requesting or writing JSX", async () => {
    const provideJsx = vi.fn(() => "must not run");
    const store = await createStore({ provideJsx });
    await writeFile(jsonPath("a"), "{ broken");
    await writeFile(jsxPath("a"), "preserve");

    expect(await store.get("a")).toMatchObject({ status: "invalid" });
    expect(provideJsx).not.toHaveBeenCalled();
    expect(await readFile(jsxPath("a"), "utf8")).toBe("preserve");
    await expect(store.list()).resolves.toEqual([]);
    expect(provideJsx).not.toHaveBeenCalled();

    await writeFile(jsonPath("a"), JSON.stringify(record("b")));
    expect(await store.get("a")).toMatchObject({ status: "invalid" });
    expect(provideJsx).not.toHaveBeenCalled();

    const future = JSON.stringify({
      ...record("a"),
      document: {
        ...record("a").document,
        schemaVersion: COMPOSITION_SCHEMA_VERSION + 1,
      },
    });
    await writeFile(jsonPath("a"), future);
    expect(await store.get("a")).toMatchObject({
      status: "future-schema",
      foundSchemaVersion: COMPOSITION_SCHEMA_VERSION + 1,
    });
    expect(await readFile(jsonPath("a"), "utf8")).toBe(future);
    expect(provideJsx).not.toHaveBeenCalled();
  });
});

describe("filesystem composition store serialization and conservative CRUD", () => {
  it("serializes concurrent puts so canonical and derived artifacts cannot interleave", async () => {
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markFirstRename!: () => void;
    const firstRenameStarted = new Promise<void>((resolve) => {
      markFirstRename = resolve;
    });
    let firstCanonical = true;
    const store = await createStore({
      operations: {
        rename: async (from, to) => {
          if (firstCanonical && to.endsWith(".composition.json")) {
            firstCanonical = false;
            markFirstRename();
            await firstMayFinish;
          }
          await rename(from, to);
        },
      },
    });

    const first = store.put(record("a", T1), "first jsx");
    await firstRenameStarted;
    const second = store.put(record("a", T2), "second jsx");
    releaseFirst();
    await Promise.all([first, second]);

    expect(JSON.parse(await readFile(jsonPath("a"), "utf8"))).toMatchObject({ updatedAt: T2 });
    expect(await readFile(jsxPath("a"), "utf8")).toBe("second jsx");
  });

  it("snapshots a validated put record before queued work or JSX providers can mutate it", async () => {
    const provideJsx = vi.fn((value: CompositionRecord) => {
      value.id = "provider-mutated";
      value.document.id = "provider-mutated";
      return "snapshot jsx";
    });
    const store = await createStore({ provideJsx });
    const value = record("a");
    const pending = store.put(value);
    value.id = "../caller-mutated";
    value.document.id = "../caller-mutated";

    await pending;

    expect(JSON.parse(await readFile(jsonPath("a"), "utf8"))).toMatchObject({
      id: "a",
      document: { id: "a" },
    });
    expect(await readFile(jsxPath("a"), "utf8")).toBe("snapshot jsx");
    expect((await names()).some((name) => name.includes("mutated"))).toBe(false);
  });

  it("lists newest-first with a stable id tie-breaker and performs deterministic CRUD", async () => {
    const store = await createStore();
    await store.put(record("c", T2), "c");
    await store.put(record("a", T1), "a");
    await store.put(record("b", T2), "b");

    expect((await store.list()).map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(await store.delete("a")).toBe(true);
    expect(await store.delete("a")).toBe(false);
    expect(await store.get("a")).toEqual({ status: "not-found", id: "a" });
  });

  it("delete preserves symlink JSX and orphan JSX", async () => {
    const store = await createStore();
    await store.put(record("a"), "owned");
    const outside = join(sandbox, "outside.tsx");
    await writeFile(outside, "outside");
    await unlink(jsxPath("a"));
    await symlink(outside, jsxPath("a"));
    await writeFile(jsxPath("orphan"), "orphan");

    expect(await store.delete("a")).toBe(true);
    expect((await lstat(jsxPath("a"))).isSymbolicLink()).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("outside");
    expect(await store.delete("orphan")).toBe(false);
    expect(await readFile(jsxPath("orphan"), "utf8")).toBe("orphan");
  });

  it("clear removes only valid owned pairs and preserves unrelated, orphan, and symlink files", async () => {
    const store = await createStore();
    await store.put(record("a"), "a");
    await store.put(record("b", T2), "b");
    await writeFile(join(root, "notes.md"), "manual");
    await writeFile(jsxPath("orphan"), "orphan");
    const outside = join(sandbox, "outside.json");
    await writeFile(outside, "outside");
    await symlink(outside, jsonPath("link"));

    await store.clear();

    expect(await names()).toEqual([
      "composition-link.composition.json",
      "composition-orphan.tsx",
      "notes.md",
    ]);
    expect((await lstat(jsonPath("link"))).isSymbolicLink()).toBe(true);
    expect(await readFile(outside, "utf8")).toBe("outside");
  });

  it("clear reports invalid canonical JSON before deleting any valid pair", async () => {
    const store = await createStore();
    await store.put(record("a"), "a");
    await writeFile(jsonPath("bad"), "not json");

    await expect(store.clear()).rejects.toMatchObject({ operation: "clear", code: "validation" });
    expect(await readFile(jsonPath("a"), "utf8")).toContain('"id": "a"');
    expect(await readFile(jsxPath("a"), "utf8")).toBe("a");
    expect(await readFile(jsonPath("bad"), "utf8")).toBe("not json");
  });

  it("uses no-follow and exclusive flags for every opened temporary file", async () => {
    const seenFlags: number[] = [];
    const store = await createStore({
      operations: {
        open: async (path, flags, mode) => {
          if ((flags & constants.O_CREAT) !== 0) seenFlags.push(flags);
          const { open } = await import("node:fs/promises");
          return open(path, flags, mode);
        },
      },
    });
    await store.put(record(), "jsx");
    expect(seenFlags).toHaveLength(2);
    for (const flags of seenFlags) {
      expect(flags & constants.O_EXCL).not.toBe(0);
      if (constants.O_NOFOLLOW !== undefined) expect(flags & constants.O_NOFOLLOW).not.toBe(0);
    }
  });
});
