// Native project-file Content history: atomic with the change it records,
// carried through every generation, and begun lazily on existing workspaces.
import { cp, mkdtemp, readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTENT_PROVIDERS, ContentPersistenceError } from "../../../src/content";
import { createNativeContentEditorial, EditorialError } from "../../../src/content/editorial";
import { createFilesystemContentStore } from "../../../src/content/storage/filesystem";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function scratch(): Promise<string> {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "native-history-")));
  directories.push(directory);
  return directory;
}
const blogWorkspace = resolve(import.meta.dirname, "../../../packages/demo-blog/cms/content/workspace-v1-initial");
const providerId = CONTENT_PROVIDERS.filesystem.id;
const article = { providerId, modelId: "articles", recordId: "article-the-quiet-hour" };
const editor = { actor: { id: "local-owner" }, source: "content-editor" };
const noPublication = async () => null;

async function copyBlog(): Promise<string> {
  const root = join(await scratch(), "content");
  await cp(blogWorkspace, root, { recursive: true });
  return root;
}
async function liveFiles(root: string): Promise<string[]> {
  const pointer = JSON.parse(await readFile(join(root, "current.json"), "utf8")) as { generation: number };
  return (await readdir(join(root, "generations", String(pointer.generation)))).sort();
}

describe("native Content history", () => {
  it("opens the committed Blog workspace as it is and records its existing values when history begins", async () => {
    const root = await copyBlog();
    const before = await liveFiles(root);
    const store = await createFilesystemContentStore({ contentRoot: root });
    expect(await liveFiles(root), "opening never rewrites an existing workspace").toEqual(before);
    const original = (await store.readAll()).entries.find((entry) => entry.id === article.recordId)!;
    expect(await store.listRevisions(article.recordId, { limit: 10 })).toEqual([]);

    const boundary = createNativeContentEditorial({ store, readPublished: noPublication, provenance: editor });
    const view = await boundary.readEntry({ entry: article, perspective: "working" });
    const receipt = await boundary.saveFields({ entry: article, expected: view.expected, values: { "articles-title": "The quiet hour, revised" }, clear: [], operationKey: "first-edit" });
    const history = await store.listRevisions(article.recordId, { limit: 10 });
    expect(history.map((revision) => [revision.sequence, revision.operation.kind, revision.source, revision.actor])).toEqual([
      [2, "set-fields", "content-editor", { id: "local-owner" }],
      [1, "initial", "existing-content", null],
    ]);
    expect(history[1]!.values).toEqual(original.values);
    expect(receipt.revisionId).toBe(history[0]!.id);
    const after = await store.readAll();
    expect(after.models).toEqual((await (await createFilesystemContentStore({ contentRoot: await copyBlog() })).readAll()).models);
    expect(after.entries.filter((entry) => entry.id !== article.recordId)).toEqual((await (await createFilesystemContentStore({ contentRoot: await copyBlog() })).readAll()).entries.filter((entry) => entry.id !== article.recordId));
    expect(after.entries.find((entry) => entry.id === article.recordId)!.lifecycle, "publication intent is kept").toBe(original.lifecycle);
  });

  it("commits the change, its revision and its receipt together or not at all", async () => {
    const root = await copyBlog();
    let failPointer = false;
    const store = await createFilesystemContentStore({ contentRoot: root, operations: {
      rename: async (from, to) => {
        if (failPointer && String(to).endsWith("current.json")) { failPointer = false; throw Object.assign(new Error("injected pointer failure"), { code: "EIO" }); }
        return rename(from, to);
      },
    } });
    const boundary = createNativeContentEditorial({ store, readPublished: noPublication, provenance: editor });
    const view = await boundary.readEntry({ entry: article, perspective: "working" });
    const request = { entry: article, expected: view.expected, values: { "articles-title": "Interrupted" }, clear: [], operationKey: "interrupted" };
    failPointer = true;
    await expect(boundary.saveFields(request)).rejects.toBeInstanceOf(Error);
    expect((await boundary.readEntry({ entry: article, perspective: "working" })).values["articles-title"]).toBe(view.values["articles-title"]);
    expect(await store.listRevisions(article.recordId, { limit: 10 }), "no revision without its change").toEqual([]);
    expect(await store.readReceipt("local-owner", "interrupted"), "no receipt without its change").toBeNull();

    const committed = await boundary.saveFields(request);
    expect(await boundary.saveFields(request), "the retry is answered from the receipt").toEqual(committed);
    expect((await store.listRevisions(article.recordId, { limit: 10 })).length).toBe(2);
  });

  it("carries history through every later generation and only a fresh start discards it", async () => {
    const root = await copyBlog();
    const store = await createFilesystemContentStore({ contentRoot: root });
    const original = (await store.readAll()).entries.find((entry) => entry.id === article.recordId)!.values["articles-title"];
    const boundary = createNativeContentEditorial({ store, readPublished: noPublication, provenance: editor });
    for (const title of ["One", "Two", "Three"]) {
      const view = await boundary.readEntry({ entry: article, perspective: "working" });
      await boundary.saveFields({ entry: article, expected: view.expected, values: { "articles-title": title }, clear: [], operationKey: title });
    }
    // An ordinary save through the store keeps history and records itself.
    const current = (await store.readAll()).entries.find((entry) => entry.id === article.recordId)!;
    await store.putEntry({ ...current, values: { ...current.values, "articles-title": "Plain save" } });
    const reopened = await createFilesystemContentStore({ contentRoot: root });
    const history = await reopened.listRevisions(article.recordId, { limit: 10 });
    expect(history.map((revision) => [revision.sequence, revision.values["articles-title"], revision.operation.kind])).toEqual([
      [5, "Plain save", "save"], [4, "Three", "set-fields"], [3, "Two", "set-fields"], [2, "One", "set-fields"], [1, original, "initial"],
    ]);
    expect((await liveFiles(root)).filter((name) => name.startsWith("revision-")).length).toBe(5);
    expect((await liveFiles(root)).filter((name) => name.startsWith("receipt-")).length).toBe(3);

    await reopened.forceClear();
    expect(await reopened.listRevisions(article.recordId, { limit: 10 })).toEqual([]);
    expect((await liveFiles(root)).filter((name) => name.startsWith("revision-") || name.startsWith("receipt-"))).toEqual([]);
  });

  it("refuses a reused key, a stale precondition and an invalid value without writing", async () => {
    const store = await createFilesystemContentStore({ contentRoot: await copyBlog() });
    const boundary = createNativeContentEditorial({ store, readPublished: noPublication, provenance: editor });
    const view = await boundary.readEntry({ entry: article, perspective: "working" });
    await boundary.saveFields({ entry: article, expected: view.expected, values: { "articles-title": "Kept" }, clear: [], operationKey: "k" });
    const code = async (work: () => Promise<unknown>) => { try { await work(); } catch (error) { return error instanceof EditorialError ? [error.code, error.diagnostics.map((item) => [item.fieldId, item.code])] : error; } return "accepted"; };
    expect(await code(() => boundary.saveFields({ entry: article, expected: view.expected, values: { "articles-title": "Other" }, clear: [], operationKey: "k" }))).toEqual(["operation-key-reuse", []]);
    expect(await code(() => boundary.saveFields({ entry: article, expected: view.expected, values: { "articles-title": "Stale" }, clear: [], operationKey: "stale" }))).toEqual(["revision-conflict", []]);
    const fresh = await boundary.readEntry({ entry: article, perspective: "working" });
    expect(await code(() => boundary.validateFields({ entry: article, expected: fresh.expected, values: { "articles-body-length": "not a number", nope: "x" }, clear: [] }))).toEqual(["invalid-value", [["articles-body-length", "invalid-value"], ["nope", "field-removed"]]]);
    expect(await code(() => boundary.saveFields({ entry: article, expected: fresh.expected, values: { "articles-body-length": "not a number" }, clear: [], operationKey: "bad" }))).toEqual(["invalid-value", [["articles-body-length", "invalid-value"]]]);
    expect((await store.listRevisions(article.recordId, { limit: 10 })).length).toBe(2);
    await expect(store.editEntry({ entry: article, expectedMutationToken: -1, operation: { kind: "set-fields", key: "x" }, provenance: editor, fingerprint: "f", values: (entry) => entry.values })).rejects.toBeInstanceOf(ContentPersistenceError);
  });
});
