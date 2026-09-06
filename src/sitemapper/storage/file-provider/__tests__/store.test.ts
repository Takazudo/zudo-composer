// The browser provider driven against the real dev endpoint over a real
// filesystem store. Nothing is stubbed between the two halves, so a mismatch in
// the operation table, the payload shape or the error round trip fails here
// rather than only in a running dev server.

import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDomainFileProviderMiddleware, serializeDomainError } from "../../../../../plugins/domain-file-provider.mjs";
import { SITEMAPPER_PROVIDER_OPERATIONS } from "../../../../../plugins/sitemapper-domain-provider.mjs";
import { SITEMAP_PROVIDERS, SitemapPersistenceError } from "../../../library";
import type { SitemapRecord } from "../../../library";
import { SITEMAP_SCHEMA_VERSION } from "../../../model";
import {
  FILE_PROVIDER_CAPABILITY_HEADER,
  FILE_PROVIDER_MAX_BODY_BYTES,
  FILE_PROVIDER_OPERATION_HEADER,
  domainFileProviderEndpoint,
} from "../../../../shared/file-provider";
import { createFilesystemSitemapStore } from "../../filesystem";
import { sitemapFileProviderErrorAdapter } from "../wire-error";
import { FileProviderSitemapStore, createFileProviderSitemapProvider } from "../store";
import { SITEMAP_FILE_PROVIDER_DOMAIN, SITEMAP_FILE_PROVIDER_OPERATIONS } from "../types";

const CAPABILITY = "test-capability";
const ENDPOINT = domainFileProviderEndpoint(SITEMAP_FILE_PROVIDER_DOMAIN);
const ORIGIN = "http://localhost:5173";
const stamp = "2026-01-01T00:00:00.000Z";
const providerId = SITEMAP_PROVIDERS.filesystem.id;

function record(id: string): SitemapRecord {
  return {
    id,
    createdAt: stamp,
    updatedAt: stamp,
    document: {
      schemaVersion: SITEMAP_SCHEMA_VERSION,
      navigation: { primary: [], footer: [] },
      id,
      name: id,
      root: [{ id: `${id}-home`, title: "Home", source: { kind: "unassigned" }, children: [] }],
    },
  };
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

async function connected(): Promise<{ store: FileProviderSitemapStore; requests: string[]; fetchImpl: typeof fetch }> {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "zudo-sitemap-wire-")));
  sandboxes.push(root);
  const handler = createDomainFileProviderMiddleware({
    domain: SITEMAP_FILE_PROVIDER_DOMAIN,
    capability: CAPABILITY,
    isDomainError: (value: unknown) => value instanceof SitemapPersistenceError,
    operations: SITEMAPPER_PROVIDER_OPERATIONS,
    createStore: () => createFilesystemSitemapStore({ sitemapsRoot: root }),
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
  return { store: new FileProviderSitemapStore({ config, fetchImpl }), requests, fetchImpl };
}

/** Sends the shared `transaction` wire operation directly: Sitemapper has no batch method on its store surface, so only the raw wire shape exercises it. */
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

describe("Sitemapper file provider over the dev endpoint", () => {
  it("round trips every wire operation against a real filesystem store", async () => {
    const { store, requests } = await connected();

    expect(await store.initialize()).toEqual({ status: "ready", summaries: [] });
    await store.put(record("a"));
    expect(await store.list()).toMatchObject([{ id: "a" }]);
    expect(await store.get("a")).toMatchObject({ status: "loaded", record: { id: "a" } });
    expect(await store.get("missing")).toEqual({ status: "not-found", id: "missing" });

    const snapshot = await store.readAll();
    expect(snapshot.map((entry) => entry.id)).toEqual(["a"]);

    expect(await store.delete("missing")).toBe(false);
    expect(await store.delete("a")).toBe(true);

    await store.seed([record("seeded")]);
    expect((await store.readAll()).map((entry) => entry.id)).toEqual(["seeded"]);
    await store.clear();
    expect(await store.list()).toEqual([]);

    await store.put(record("fresh"));
    expect(await store.startFresh()).toEqual({ status: "ready", summaries: [] });

    // Every declared operation was actually exercised.
    expect(new Set(requests)).toEqual(new Set(SITEMAP_FILE_PROVIDER_OPERATIONS));
  });

  it("round trips a whole-batch transaction and rejects a stale mutation token", async () => {
    const { store, fetchImpl } = await connected();
    await store.put(record("a"));

    const applied = await sendTransaction(fetchImpl, {
      steps: [{ operation: "put", payload: { record: record("b") } }, { operation: "delete", payload: { id: "a" } }],
    });
    expect(applied.records.map((entry) => entry.id)).toEqual(["b"]);

    const conflict = await sendTransaction(fetchImpl, {
      expectedMutationToken: "stale",
      steps: [{ operation: "delete", payload: { id: "b" } }],
    }).then(() => undefined, (error: { code: string }) => error);
    expect(conflict).toMatchObject({ code: "conflict" });
    expect((await store.list()).map((summary) => summary.id)).toEqual(["b"]);
  });

  it("rebuilds the exact domain error, not a flattened message", async () => {
    const { store } = await connected();
    const invalid = await store.put({ ...record("a"), id: "meta" }).then(() => undefined, (error: unknown) => error);
    expect(invalid).toBeInstanceOf(SitemapPersistenceError);
    expect(invalid).toMatchObject({ operation: "put", code: "validation", retryable: false });
  });

  it("reports an unreachable dev server as an unavailable Sitemapper error", async () => {
    const store = new FileProviderSitemapStore({
      config,
      fetchImpl: (() => Promise.reject(new TypeError("Failed to fetch"))) satisfies typeof fetch,
    });
    await expect(store.list()).rejects.toMatchObject({ operation: "list", code: "unavailable", retryable: true });
  });

  it("refuses a request body larger than the endpoint accepts before sending it", async () => {
    const store = new FileProviderSitemapStore({ config: { ...config, maxBodyBytes: 64 }, fetchImpl: (() => { throw new Error("must not send"); }) satisfies typeof fetch });
    await expect(store.seed([record("a")])).rejects.toMatchObject({ operation: "put", code: "unavailable" });
  });

  it("serializes a domain error identically on both halves of the transport", () => {
    const error = new SitemapPersistenceError("put", "validation", "Sitemap record is invalid.", false);
    const wire = serializeDomainError(SITEMAP_FILE_PROVIDER_DOMAIN, error, "put", (value: unknown) => value instanceof SitemapPersistenceError);
    expect(wire.error).toEqual(sitemapFileProviderErrorAdapter.toWire(error));
    expect(sitemapFileProviderErrorAdapter.fromWire(sitemapFileProviderErrorAdapter.toWire(error), "put"))
      .toMatchObject({ operation: "put", code: "validation", retryable: false });
  });

  it("exposes the initialization surface as a Sitemap provider", async () => {
    const { fetchImpl } = await connected();
    const provider = createFileProviderSitemapProvider({ config, fetchImpl });
    expect(provider.descriptor).toBe(SITEMAP_PROVIDERS.filesystem);
    expect(provider.store.provider.id).toBe(providerId);
    expect(await provider.initialization.initialize()).toEqual({ status: "ready", summaries: [] });
    expect(await provider.initialization.retry()).toEqual({ status: "ready", summaries: [] });
    expect(await provider.initialization.startFresh()).toEqual({ status: "ready", summaries: [] });
  });
});
