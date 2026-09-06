// The browser provider driven against the real dev endpoint over a real
// filesystem store. Nothing is stubbed between the two halves, so a mismatch in
// the operation table, the payload shape or the error round trip fails here
// rather than only in a running dev server.

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDomainFileProviderMiddleware, serializeDomainError } from "../../../../../plugins/domain-file-provider.mjs";
import { MAPPING_PROVIDER_OPERATIONS } from "../../../../../plugins/mapping-domain-provider.mjs";
import { MAPPING_PROVIDERS, MappingPersistenceError, createMappingRecord } from "../../../model";
import {
  FILE_PROVIDER_CAPABILITY_HEADER,
  FILE_PROVIDER_MAX_BODY_BYTES,
  FILE_PROVIDER_OPERATION_HEADER,
  domainFileProviderEndpoint,
} from "../../../../shared/file-provider";
import { createFilesystemMappingStore } from "../../filesystem";
import { mappingFileProviderErrorAdapter } from "../error-adapter";
import { FileProviderMappingStore, createFileProviderMappingProvider } from "../store";
import { MAPPING_FILE_PROVIDER_DOMAIN, MAPPING_FILE_PROVIDER_OPERATIONS } from "../types";

const CAPABILITY = "test-capability";
const ENDPOINT = domainFileProviderEndpoint(MAPPING_FILE_PROVIDER_DOMAIN);
const ORIGIN = "http://localhost:5173";
const stamp = "2026-01-01T00:00:00.000Z";
const providerId = MAPPING_PROVIDERS.filesystem.id;

function mapping(id: string, name = id) {
  return createMappingRecord({
    id,
    name,
    contentModel: { providerId: "content", recordId: "articles" },
    composition: { providerId: "indexeddb", recordId: "landing" },
    createdAt: stamp,
  });
}

const config = {
  endpoint: ENDPOINT,
  capability: CAPABILITY,
  capabilityHeader: FILE_PROVIDER_CAPABILITY_HEADER,
  operationHeader: FILE_PROVIDER_OPERATION_HEADER,
  maxBodyBytes: FILE_PROVIDER_MAX_BODY_BYTES,
};

const sandboxes: string[] = [];

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function connected(): Promise<{ store: FileProviderMappingStore; requests: string[]; fetchImpl: typeof fetch }> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-mapping-wire-")));
  sandboxes.push(root);
  const handler = createDomainFileProviderMiddleware({
    domain: MAPPING_FILE_PROVIDER_DOMAIN,
    capability: CAPABILITY,
    isDomainError: (value: unknown) => value instanceof MappingPersistenceError,
    operations: MAPPING_PROVIDER_OPERATIONS,
    createStore: () => createFilesystemMappingStore({ mappingsRoot: root }),
    applyTransaction: (store: { applyTransaction(request: unknown): Promise<unknown> }, request: unknown) => store.applyTransaction(request),
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
  return { store: new FileProviderMappingStore({ config, fetchImpl }), requests, fetchImpl };
}

/** Sends the shared `transaction` wire operation directly: Mapping has no batch method on its store surface, so only the raw wire shape exercises it. */
async function sendTransaction(fetchImpl: typeof fetch, payload: unknown): Promise<{ mutationToken: string; records: readonly { id: string }[] }> {
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", [config.capabilityHeader]: config.capability, [config.operationHeader]: "transaction" },
    body: JSON.stringify(payload),
  });
  const body = await response.json() as { ok: boolean; result?: { mutationToken: string; records: readonly { id: string }[] }; error?: { code: string } };
  if (!body.ok) throw body.error;
  return body.result!;
}

describe("Mapping file provider over the dev endpoint", () => {
  it("round trips every wire operation against a real filesystem store", async () => {
    const { store, requests } = await connected();

    expect(await store.initialize()).toEqual({ status: "ready", summaries: [] });
    await store.put(mapping("a"));
    expect(await store.list()).toMatchObject([{ id: "a" }]);
    expect(await store.get("a")).toMatchObject({ status: "loaded", record: { id: "a" } });
    expect(await store.get("missing")).toEqual({ status: "not-found", id: "missing" });

    expect(await store.delete("missing")).toBe(false);
    expect(await store.delete("a")).toBe(true);

    await store.seed({ mappings: [mapping("seeded")] });
    expect(await store.list()).toMatchObject([{ id: "seeded" }]);
    await store.clear();
    expect(await store.list()).toEqual([]);

    await store.put(mapping("fresh"));
    expect(await store.startFresh()).toEqual({ status: "ready", summaries: [] });

    // Every declared operation was actually exercised.
    expect(new Set(requests)).toEqual(new Set(MAPPING_FILE_PROVIDER_OPERATIONS));
  });

  it("round trips a whole-batch transaction and rejects a stale mutation token", async () => {
    const { store, fetchImpl } = await connected();
    await store.put(mapping("a"));

    const applied = await sendTransaction(fetchImpl, {
      steps: [{ operation: "put", payload: { record: mapping("b") } }, { operation: "delete", payload: { id: "a" } }],
    });
    expect(applied.records.map((record) => record.id)).toEqual(["b"]);

    const conflict = await sendTransaction(fetchImpl, {
      expectedMutationToken: "stale",
      steps: [{ operation: "delete", payload: { id: "b" } }],
    }).then(() => undefined, (error: { code: string }) => error);
    expect(conflict).toMatchObject({ code: "conflict" });
    expect((await store.list()).map((summary) => summary.id)).toEqual(["b"]);
  });

  it("rebuilds the exact domain error, not a flattened message", async () => {
    const { store } = await connected();
    const invalid = await store.put({ ...mapping("a"), id: "meta" }).then(() => undefined, (error: unknown) => error);
    expect(invalid).toBeInstanceOf(MappingPersistenceError);
    expect(invalid).toMatchObject({ operation: "put", code: "validation", retryable: false });
  });

  it("reports an unreachable dev server as an unavailable Mapping error", async () => {
    const store = new FileProviderMappingStore({
      config,
      fetchImpl: (() => Promise.reject(new TypeError("Failed to fetch"))) satisfies typeof fetch,
    });
    await expect(store.list()).rejects.toMatchObject({ operation: "list", code: "unavailable", retryable: true });
  });

  it("refuses a request body larger than the endpoint accepts before sending it", async () => {
    const store = new FileProviderMappingStore({ config: { ...config, maxBodyBytes: 64 }, fetchImpl: (() => { throw new Error("must not send"); }) satisfies typeof fetch });
    await expect(store.seed({ mappings: [mapping("a")] })).rejects.toMatchObject({ operation: "seed", code: "unavailable" });
  });

  it("serializes a domain error identically on both halves of the transport", () => {
    const error = new MappingPersistenceError("put", "validation", "Mapping createdAt is immutable after persistence.", false);
    const wire = serializeDomainError(MAPPING_FILE_PROVIDER_DOMAIN, error, "put", (value: unknown) => value instanceof MappingPersistenceError);
    expect(wire.error).toEqual(mappingFileProviderErrorAdapter.toWire(error));
    expect(mappingFileProviderErrorAdapter.fromWire(mappingFileProviderErrorAdapter.toWire(error), "put"))
      .toMatchObject({ operation: "put", code: "validation", retryable: false });
  });

  it("exposes the initialization surface as a Mapping provider", async () => {
    const { fetchImpl } = await connected();
    const provider = createFileProviderMappingProvider({ config, fetchImpl });
    expect(provider.descriptor).toBe(MAPPING_PROVIDERS.filesystem);
    expect(provider.store.provider.id).toBe(providerId);
    expect(await provider.initialization.initialize()).toEqual({ status: "ready", summaries: [] });
    expect(await provider.initialization.retry()).toEqual({ status: "ready", summaries: [] });
    expect(await provider.initialization.startFresh()).toEqual({ status: "ready", summaries: [] });
  });
});
