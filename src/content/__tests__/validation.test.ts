import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord, contentEntryDigest } from "../library";
import { createFilesystemContentStore } from "../storage/filesystem/store";
import { createNativeContentEditorial } from "../editorial/native";
import { validateContentPolicy, type ContentValidationPolicy } from "../validation";
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const timestamp = "2026-01-01T00:00:00.000Z";
const model = createContentModelRecord({ name: "Notes", kind: "collection", fields: [{ id: "body", key: "body", label: "Body", kind: "markdown", required: false }, { id: "title", key: "title", label: "Title", kind: "text", required: false }] }, { id: "notes", timestamp });
const entry = createContentEntryRecord("notes", { body: "# Historical", title: "Old" }, { id: "note", timestamp });
const policy: ContentValidationPolicy = { validateContentField: ({ field, value }) => field.id === "body" && typeof value === "string" && value.startsWith("# ") ? [{ code: "heading", message: "Use a level two heading." }] : [] };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "content-policy-")); roots.push(root);
  const original = await createFilesystemContentStore({ contentRoot: root });
  await original.seed({ models: [model], entries: [entry] });
  const store = await createFilesystemContentStore({ contentRoot: root, validationPolicy: policy });
  return { root, store, before: await store.readAll() };
}
it("preserves imported invalid values/read history and permits unrelated changed fields", async () => {
  const { store, before } = await fixture();
  await store.putEntry({ ...before.entries[0]!, values: { ...entry.values, title: "New" } });
  expect((await store.readAll()).entries[0]!.values).toEqual({ body: "# Historical", title: "New" });
});
it("human put, transaction and AI preflight refuse the same value without writes", async () => {
  const { store, before } = await fixture();
  const candidate = { ...before.entries[0]!, values: { body: "# New invalid" } };
  await expect(store.putEntry(candidate)).rejects.toThrow("Use a level two heading");
  await expect(store.transact({ expectedMutationToken: before.mutationToken, operations: [{ kind: "put-entry", record: candidate }] })).rejects.toThrow("Use a level two heading");
  const editorial = createNativeContentEditorial({ store, readPublished: async () => null, provenance: { actor: null, source: "test" } });
  await expect(editorial.validateFields({ entry: { providerId: store.provider.id, modelId: "notes", recordId: "note" }, expected: String(before.mutationToken), values: candidate.values, clear: [] })).rejects.toThrow("host Content policy");
  expect(await store.readAll()).toEqual(before);
});
it("publication checks even unchanged historical values before its fence is installed", async () => {
  const { store, before } = await fixture(); const current = before.entries[0]!;
  await expect(store.reconcilePublication([{ ref: { providerId: store.provider.id, modelId: current.modelId, recordId: current.id }, expectedGeneration: current.generation, expectedDigest: contentEntryDigest(current), lifecycle: "published" }], 1)).rejects.toThrow("Use a level two heading");
  expect(await store.readAll()).toEqual(before); expect(await store.activationFence()).toBe(0);
});
it("commits supported values, recovers receipt after policy change, refuses new invalid restore", async () => {
  const { root, store, before } = await fixture();
  const request = { entry: { providerId: store.provider.id, modelId: "notes", recordId: "note" }, expectedMutationToken: before.mutationToken, operation: { kind: "set-fields" as const, key: "once" }, provenance: { actor: null, source: "test" }, fingerprint: "proof", values: () => ({ body: "## Allowed" }) };
  const result = await store.editEntry(request);
  const current = await store.readAll();
  const changed = await createFilesystemContentStore({ contentRoot: root, validationPolicy: { ...policy, assertCurrent: async () => { throw new Error("changed source"); } } });
  expect((await changed.editEntry(request)).receipt).toEqual(result.receipt);
  await expect(store.editEntry({ ...request, operation: { kind: "restore-revision", key: "restore" }, fingerprint: "restore", expectedMutationToken: current.mutationToken, values: () => ({ body: "# Historical" }) })).rejects.toThrow("Use a level two heading");
  expect(await store.readAll()).toEqual(current);
});
it("passes optional clears, freezes cloned context and rejects async/malformed policy outputs", async () => {
  const input = { providerId: "content-filesystem", model, entry: { ...entry, values: {} }, previous: entry, purpose: "write" as const };
  const seen: unknown[] = [];
  await validateContentPolicy({ validateContentField: value => { seen.push(value.value); expect(Object.isFrozen(value.entry.values)).toBe(true); expect(() => { value.entry.values.body = "mutation"; }).toThrow(); return []; } }, input);
  expect(seen).toEqual([undefined, undefined]); expect(entry.values.body).toBe("# Historical");
  for (const bad of [Promise.resolve([]), Promise.reject(new Error("async rejection")), null, [{ code: "x", message: "" }]]) await expect(validateContentPolicy({ validateContentField: () => bad } as never, input)).rejects.toThrow("invalid diagnostics");
});
it("checks the loaded epoch around the touched-value batch and refuses a mid-validation change", async () => {
  const { root, before } = await fixture(); let epochs = 0, callbacks = 0;
  const store = await createFilesystemContentStore({ contentRoot: root, validationPolicy: {
    assertCurrent: async () => { if (++epochs === 2) throw Error("Policy changed during write"); },
    validateContentField: () => { callbacks++; return []; },
  } });
  await expect(store.putEntry({ ...before.entries[0]!, values: { ...before.entries[0]!.values, title: "Changed" } })).rejects.toThrow("Policy changed during write");
  expect(epochs).toBe(2); expect(callbacks).toBe(1); expect(await store.readAll()).toEqual(before);
});
