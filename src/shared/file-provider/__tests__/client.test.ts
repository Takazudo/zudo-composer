import { describe, expect, it, vi } from "vitest";
import { subscribePersistenceChanges } from "../../persistence-generation";
import { DomainFileProviderClient, readDomainFileProviderConfig } from "../client";
import {
  domainFileProviderEndpoint,
  type FileProviderConfig,
  type FileProviderErrorAdapter,
  type FileProviderWireError,
} from "../protocol";

type ContentOperation = "snapshot" | "put" | "transaction";

class ContentPersistenceError extends Error {
  readonly name = "ContentPersistenceError";
  constructor(
    readonly operation: ContentOperation,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

const adapter: FileProviderErrorAdapter<ContentOperation, ContentPersistenceError> = {
  domain: "content",
  persistenceChannel: "content",
  isDomainError: (value): value is ContentPersistenceError => value instanceof ContentPersistenceError,
  toWire: (error) => ({
    domain: "content",
    operation: error.operation,
    code: error.code,
    message: error.message,
    details: error.details,
  }),
  fromWire: (error, fallbackOperation) =>
    new ContentPersistenceError(
      (error.operation as ContentOperation) || fallbackOperation,
      error.code,
      error.message,
      error.details,
    ),
  transportError: (operation, message, cause) =>
    new ContentPersistenceError(operation, "unavailable", message, undefined, { cause }),
};

const config: FileProviderConfig = {
  endpoint: domainFileProviderEndpoint("content"),
  capability: "dev-capability",
  capabilityHeader: "x-zudo-composer-capability",
  operationHeader: "x-zudo-composer-operation",
  maxBodyBytes: 512,
};

function client(fetchImpl: typeof fetch) {
  return new DomainFileProviderClient<ContentOperation, ContentPersistenceError>(config, adapter, fetchImpl);
}

function respond(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("domain file provider client", () => {
  it("sends the operation header and capability with a same-origin no-store POST", async () => {
    const fetchImpl = vi.fn(async () => respond(200, { ok: true, result: { records: [] } }));
    const result = await client(fetchImpl as unknown as typeof fetch).call("snapshot");
    expect(result).toEqual({ records: [] });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/__zudo_composer_content_provider");
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toMatchObject({
      "x-zudo-composer-capability": "dev-capability",
      "x-zudo-composer-operation": "snapshot",
    });
  });

  it("rebuilds the domain error with its operation, code and details intact", async () => {
    const wire: FileProviderWireError = {
      domain: "content",
      operation: "put",
      code: "conflict",
      message: "Content changed; reload before retrying.",
      details: { expectedRevision: 3 },
    };
    const failing = client((async () => respond(409, { ok: false, error: wire })) as unknown as typeof fetch);
    const error = await failing.call("put", { id: "alpha" }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ContentPersistenceError);
    expect(error).toMatchObject({ operation: "put", code: "conflict", details: { expectedRevision: 3 } });
  });

  it("reports transport, envelope and status faults as unavailable rather than domain outcomes", async () => {
    const unreachable = client((() => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch);
    await expect(unreachable.call("snapshot")).rejects.toMatchObject({ code: "unavailable" });

    const malformed = client((async () => new Response("not json", { status: 200 })) as unknown as typeof fetch);
    await expect(malformed.call("snapshot")).rejects.toMatchObject({ code: "unavailable" });

    const shapeless = client((async () => respond(200, { result: 1 })) as unknown as typeof fetch);
    await expect(shapeless.call("snapshot")).rejects.toMatchObject({ code: "unavailable" });

    // A success envelope behind a failure status is a contract violation, not data.
    const mismatched = client((async () => respond(500, { ok: true, result: null })) as unknown as typeof fetch);
    await expect(mismatched.call("snapshot")).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses an oversized body before it reaches the network", async () => {
    const fetchImpl = vi.fn(async () => respond(200, { ok: true, result: null }));
    await expect(client(fetchImpl as unknown as typeof fetch).call("put", { note: "x".repeat(600) }))
      .rejects.toMatchObject({ code: "unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("emits a refresh hint only for mutations, and never for a failure", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribePersistenceChanges((database) => seen.push(database));
    try {
      const ok = client((async () => respond(200, { ok: true, result: null })) as unknown as typeof fetch);
      await ok.call("snapshot");
      expect(seen).toEqual([]);
      await ok.call("put", { id: "alpha" }, { mutates: true });
      expect(seen).toEqual(["content"]);

      const failing = client((async () =>
        respond(409, { ok: false, error: { domain: "content", operation: "put", code: "conflict", message: "no" } })
      ) as unknown as typeof fetch);
      await expect(failing.call("put", { id: "alpha" }, { mutates: true })).rejects.toBeInstanceOf(ContentPersistenceError);
      expect(seen).toEqual(["content"]);
    } finally {
      unsubscribe();
    }
  });

  it("sends a whole transaction as one request with one outcome", async () => {
    const fetchImpl = vi.fn(async () => respond(200, { ok: true, result: { mutationToken: "next" } }));
    const steps = [
      { operation: "put", payload: { id: "alpha" } },
      { operation: "put", payload: { id: "beta" } },
    ];
    const result = await client(fetchImpl as unknown as typeof fetch)
      .transaction(steps, { expectedMutationToken: "before" });
    expect(result).toEqual({ mutationToken: "next" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["x-zudo-composer-operation"]).toBe("transaction");
    expect(JSON.parse(init.body as string)).toEqual({ expectedMutationToken: "before", steps });
  });

  it("reads one domain's configuration and yields undefined when the build emits none", () => {
    const emitted = { domains: { content: config, mapping: { endpoint: "/x" } } };
    expect(readDomainFileProviderConfig(emitted, "content")).toEqual(config);
    expect(readDomainFileProviderConfig(emitted, "mapping")).toBeUndefined();
    expect(readDomainFileProviderConfig(emitted, "sitemapper")).toBeUndefined();
    expect(readDomainFileProviderConfig(undefined, "content")).toBeUndefined();
  });
});
