// The browser provider driven against the real dev endpoint over a real
// filesystem store. Nothing is stubbed between the two halves, so a mismatch in
// the operation table, the payload shape or the error round trip fails here
// rather than only in a running dev server.

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDomainFileProviderMiddleware, serializeDomainError } from "../../../../../plugins/domain-file-provider.mjs";
import { CONTENT_PROVIDER_OPERATIONS } from "../../../../../plugins/content-domain-provider.mjs";
import {
  CONTENT_PROVIDERS,
  ContentPersistenceError,
  contentEntryDigest,
  createContentEntryRecord,
  createContentModelRecord,
} from "../../../library";
import type { ContentFieldDefinition } from "../../../model";
import {
  FILE_PROVIDER_CAPABILITY_HEADER,
  FILE_PROVIDER_MAX_BODY_BYTES,
  FILE_PROVIDER_OPERATION_HEADER,
  FILE_PROVIDER_WORKSPACE_HEADER,
  domainFileProviderEndpoint,
} from "../../../../shared/file-provider";
import { createWorkspaceScopedContentStore } from "../dev-server-entry";
import { contentFileProviderErrorAdapter } from "../error-adapter";
import { FileProviderContentStore, createFileProviderContentProvider } from "../store";
import { CONTENT_FILE_PROVIDER_DOMAIN, CONTENT_FILE_PROVIDER_OPERATIONS } from "../types";

const CAPABILITY = "test-capability";
const ENDPOINT = domainFileProviderEndpoint(CONTENT_FILE_PROVIDER_DOMAIN);
const ORIGIN = "http://localhost:5173";
const timestamp = "2026-01-01T00:00:00.000Z";
const providerId = CONTENT_PROVIDERS.filesystem.id;
const title: ContentFieldDefinition = { id: "title", key: "title", label: "Title", required: true, kind: "text" };
const note: ContentFieldDefinition = { id: "note", key: "note", label: "Note", required: false, kind: "text" };
const model = () => createContentModelRecord({ name: "Items", kind: "collection", fields: [title, note] }, { id: "items", timestamp });
const entry = (id: string) => createContentEntryRecord("items", { title: id }, { id, timestamp });

const config = {
  endpoint: ENDPOINT,
  capability: CAPABILITY,
  capabilityHeader: FILE_PROVIDER_CAPABILITY_HEADER,
  operationHeader: FILE_PROVIDER_OPERATION_HEADER,
  workspaceHeader: FILE_PROVIDER_WORKSPACE_HEADER,
  maxBodyBytes: FILE_PROVIDER_MAX_BODY_BYTES,
};

/** The endpoint scopes every request to a workspace directory below the root. */
const WORKSPACE = "wire-workspace";
const workspace = () => WORKSPACE;

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function connected(): Promise<{ store: FileProviderContentStore; requests: string[]; fetchImpl: typeof fetch }> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-content-wire-")));
  sandboxes.push(root);
  const handler = createDomainFileProviderMiddleware({
    domain: CONTENT_FILE_PROVIDER_DOMAIN,
    capability: CAPABILITY,
    isDomainError: (value: unknown) => value instanceof ContentPersistenceError,
    operations: CONTENT_PROVIDER_OPERATIONS,
    createStore: (workspaceId: string | undefined) => createWorkspaceScopedContentStore(root, workspaceId!),
  });
  const requests: string[] = [];
  const fetchImpl = (async (_input, init) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([name, value]) => [name.toLowerCase(), value]),
    );
    requests.push(headers[FILE_PROVIDER_OPERATION_HEADER]!);
    const response = await handler({
      url: ENDPOINT,
      method: "POST",
      protocol: "http",
      headers: { host: "localhost:5173", origin: ORIGIN, "sec-fetch-site": "same-origin", ...headers },
      body: init?.body as string,
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  }) satisfies typeof fetch;
  return { store: new FileProviderContentStore({ config, fetchImpl, workspace }), requests, fetchImpl };
}

describe("Content file provider over the dev endpoint", () => {
  it("round trips every wire operation against a real filesystem store", async () => {
    const { store, requests } = await connected();

    expect(await store.initialize()).toEqual({ status: "ready", models: [] });
    await store.putModel(model());
    expect(await store.listModels()).toEqual([{ id: "items", name: "Items", kind: "collection", fieldCount: 2, createdAt: timestamp, updatedAt: timestamp }]);
    expect(await store.getModel("items")).toMatchObject({ status: "loaded", record: { id: "items" } });
    expect(await store.getModel("missing")).toEqual({ status: "not-found", id: "missing" });

    await store.putEntry(entry("a"));
    await store.putEntry(entry("b"));
    expect(await store.countEntries("items")).toBe(2);
    expect(await store.getEntry("a")).toMatchObject({ status: "loaded", record: { id: "a" } });

    const first = await store.pageEntries("items", { limit: 1 });
    expect(first.entries.map((item) => item.id)).toEqual(["b"]);
    expect(typeof first.nextCursor).toBe("string");
    expect((await store.pageEntries("items", { limit: 1, cursor: first.nextCursor! })).entries.map((item) => item.id)).toEqual(["a"]);

    const scan = await store.scanEntries("items");
    expect(scan.count).toBe(2);
    expect(scan.model.id).toBe("items");

    const snapshot = await store.readAll();
    expect(snapshot.providerId).toBe(providerId);
    expect(snapshot.entries).toHaveLength(2);

    const transacted = await store.transact({
      expectedMutationToken: snapshot.mutationToken,
      operations: [{ kind: "put-entry", record: { ...snapshot.entries[0]!, values: { title: "a", note: "kept" } } }],
    });
    expect(transacted.entries[0]!.values).toEqual({ title: "a", note: "kept" });

    const reviewed = transacted.entries[0]!;
    const reconciled = await store.reconcilePublication(
      [{ ref: { providerId, modelId: "items", recordId: "a" }, expectedGeneration: reviewed.generation, expectedDigest: contentEntryDigest(reviewed), lifecycle: "published" }],
      1,
    );
    expect(reconciled.activationGeneration).toBe(1);
    expect(reconciled.entries.find((item) => item.id === "a")!.lifecycle).toBe("published");

    await store.removeField("items", "note");
    expect((await store.getEntry("a")).status).toBe("loaded");
    expect(await store.deleteEntry("b")).toBe(true);
    expect(await store.deleteEntry("b")).toBe(false);
    expect(await store.deleteModel("items")).toBe(true);

    await store.seed({ models: [model()], entries: [entry("seeded")] });
    expect((await store.readAll()).entries.map((item) => item.id)).toEqual(["seeded"]);
    await store.clear();
    expect((await store.readAll()).models).toEqual([]);

    await store.putModel(model());
    expect(await store.startFresh()).toEqual({ status: "ready", models: [] });

    // Every declared operation was actually exercised.
    expect(new Set(requests)).toEqual(new Set(CONTENT_FILE_PROVIDER_OPERATIONS));
  });

  it("rebuilds the exact domain error, not a flattened message", async () => {
    const { store } = await connected();
    await store.putModel(model());
    const snapshot = await store.readAll();

    const conflict = await store.transact({ expectedMutationToken: snapshot.mutationToken + 5, operations: [{ kind: "delete-model", id: "items" }] })
      .then(() => undefined, (error: unknown) => error);
    expect(conflict).toBeInstanceOf(ContentPersistenceError);
    expect(conflict).toMatchObject({ operation: "transact", code: "conflict", retryable: true });

    const notFound = await store.removeField("items", "absent").then(() => undefined, (error: unknown) => error);
    expect(notFound).toMatchObject({ operation: "remove-field", code: "not-found", retryable: false });
  });

  it("reports an unreachable dev server as an unavailable Content error", async () => {
    const store = new FileProviderContentStore({
      workspace,
      config,
      fetchImpl: (() => Promise.reject(new TypeError("Failed to fetch"))) satisfies typeof fetch,
    });
    await expect(store.readAll()).rejects.toMatchObject({ operation: "read-all", code: "unavailable", retryable: true });
  });

  it("refuses a request body larger than the endpoint accepts before sending it", async () => {
    const store = new FileProviderContentStore({ config: { ...config, maxBodyBytes: 64 }, workspace, fetchImpl: (() => { throw new Error("must not send"); }) satisfies typeof fetch });
    await expect(store.seed({ models: [model()], entries: [] })).rejects.toMatchObject({ operation: "seed", code: "unavailable" });
  });

  it("serializes a domain error identically on both halves of the transport", () => {
    const error = new ContentPersistenceError("put-entry", "single-cardinality", "A Single model permits at most one Entry.", false);
    const wire = serializeDomainError(CONTENT_FILE_PROVIDER_DOMAIN, error, "put-entry", (value: unknown) => value instanceof ContentPersistenceError);
    // The plugin serializer is plain JS and cannot import the adapter; this
    // pins the two spellings of the same payload together.
    expect(wire.error).toEqual(contentFileProviderErrorAdapter.toWire(error));
    expect(contentFileProviderErrorAdapter.fromWire(contentFileProviderErrorAdapter.toWire(error), "put-entry"))
      .toMatchObject({ operation: "put-entry", code: "single-cardinality", retryable: false });
  });

  it("exposes the initialization surface as a Content provider", async () => {
    const { fetchImpl } = await connected();
    const provider = createFileProviderContentProvider({ config, fetchImpl, workspace });
    expect(provider.descriptor).toBe(CONTENT_PROVIDERS.filesystem);
    expect(provider.store.provider.id).toBe(providerId);
    expect(await provider.initialization.initialize()).toEqual({ status: "ready", models: [] });
    expect(await provider.initialization.retry()).toEqual({ status: "ready", models: [] });
    expect(await provider.initialization.startFresh()).toEqual({ status: "ready", models: [] });
  });
});
