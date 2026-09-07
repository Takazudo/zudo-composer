import { describe, expect, it } from "vitest";
import { createDomainFileProviderMiddleware, domainFileProviderEndpoint, serializeDomainError } from "../domain-file-provider.mjs";

const CAPABILITY = "test-capability";
const ENDPOINT = domainFileProviderEndpoint("content");
/** Every authoring domain is workspace scoped; the header names the workspace. */
const WORKSPACE = "test-workspace";

class ContentPersistenceError extends Error {
  readonly name = "ContentPersistenceError";
  constructor(
    readonly operation: string,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const isDomainError = (value: unknown): boolean => value instanceof ContentPersistenceError;

function request(operation: string, body?: unknown, overrides: Record<string, unknown> = {}) {
  return {
    url: ENDPOINT,
    method: "POST",
    protocol: "http",
    headers: {
      host: "localhost:5173",
      origin: "http://localhost:5173",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      "x-zudo-composer-capability": CAPABILITY,
      "x-zudo-composer-operation": operation,
      "x-zudo-composer-workspace": WORKSPACE,
    },
    body: body === undefined ? "" : JSON.stringify(body),
    ...overrides,
  };
}

interface TestStore {
  snapshot?(): unknown;
  put?(payload: unknown): unknown;
}

/** Which workspace each request resolved its store against. */
const seen: (string | undefined)[] = [];

function middleware(store: TestStore, extra: Record<string, unknown> = {}) {
  return createDomainFileProviderMiddleware<TestStore>({
    domain: "content",
    capability: CAPABILITY,
    isDomainError,
    createStore: (workspaceId) => { seen.push(workspaceId); return Promise.resolve(store); },
    operations: {
      snapshot: (target) => target.snapshot!(),
      put: (target, payload) => target.put!(payload),
    },
    ...extra,
  });
}

describe("domain file provider endpoint", () => {
  it("names one endpoint per domain and rejects unusable domain names", () => {
    expect(domainFileProviderEndpoint("content")).toBe("/__zudo_composer_content_provider");
    expect(domainFileProviderEndpoint("sitemapper")).toBe("/__zudo_composer_sitemapper_provider");
    expect(() => domainFileProviderEndpoint("../etc")).toThrow(RangeError);
  });

  it("admits only a same-origin POST carrying the dev capability", async () => {
    const handler = middleware({ snapshot: () => ({ records: [] }) });
    const cases: [Record<string, unknown>, number][] = [
      [{ url: "/__zudo_composer_content_provider?x=1" }, 404],
      [{ method: "GET" }, 405],
      [{ headers: { ...request("snapshot").headers, "sec-fetch-site": "cross-site" } }, 403],
      [{ headers: { ...request("snapshot").headers, "x-zudo-composer-capability": "wrong-capability" } }, 401],
      [{ headers: { ...request("snapshot").headers, "content-type": "text/plain" } }, 415],
    ];
    for (const [overrides, status] of cases) {
      expect((await handler(request("snapshot", undefined, overrides))).status).toBe(status);
    }
    expect((await handler(request("snapshot"))).status).toBe(200);
  });

  it("resolves the store against the named workspace and refuses a request without one", async () => {
    const handler = middleware({ snapshot: () => ({ records: [] }) });
    seen.length = 0;
    expect((await handler(request("snapshot"))).status).toBe(200);
    expect(seen).toEqual([WORKSPACE]);

    const headers = { ...request("snapshot").headers };
    delete (headers as Record<string, string>)["x-zudo-composer-workspace"];
    expect((await handler(request("snapshot", undefined, { headers }))).status).toBe(400);
    expect((await handler(request("snapshot", undefined, { headers: { ...request("snapshot").headers, "x-zudo-composer-workspace": "../escape" } }))).status).toBe(400);
    // The refusal happened before any store was built.
    expect(seen).toEqual([WORKSPACE]);

    // An unscoped endpoint — the workspace registry itself — answers without one.
    const unscoped = middleware({ snapshot: () => ({ records: [] }) }, { workspaceScoped: false });
    seen.length = 0;
    expect((await unscoped(request("snapshot", undefined, { headers }))).status).toBe(200);
    expect(seen).toEqual([undefined]);
  });

  it("rejects an unknown operation, a malformed body and an oversized body", async () => {
    const handler = middleware({ snapshot: () => ({ records: [] }) }, { maxBodyBytes: 64 });
    expect(JSON.parse((await handler(request("wipe-everything"))).body)).toMatchObject({
      ok: false,
      error: { code: "invalid-request" },
    });
    expect((await handler(request("snapshot", undefined, { body: "{" }))).status).toBe(400);
    expect((await handler(request("put", { note: "x".repeat(200) }))).status).toBe(413);
  });

  it("carries the domain operation, code and structured details across the wire", async () => {
    const handler = middleware({
      put: () => {
        throw new ContentPersistenceError("put", "conflict", "Content changed; reload before retrying.", {
          expectedRevision: 3,
          actualRevision: 4,
        });
      },
    });
    const response = await handler(request("put", { id: "alpha" }));
    expect(response.status).toBe(409);
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      error: {
        domain: "content",
        operation: "put",
        code: "conflict",
        message: "Content changed; reload before retrying.",
        details: { expectedRevision: 3, actualRevision: 4 },
      },
    });
  });

  it("never lets a foreign error masquerade as a domain outcome", async () => {
    const handler = middleware({ put: () => { throw Object.assign(new Error("EACCES"), { code: "conflict" }); } });
    const response = await handler(request("put", {}));
    expect(response.status).toBe(500);
    expect(JSON.parse(response.body).error).toMatchObject({ code: "unknown", operation: "put" });
  });

  it("maps every shared code to its documented status", () => {
    const status = (code: string) =>
      serializeDomainError("content", new ContentPersistenceError("put", code, "x"), "put", isDomainError).status;
    expect(status("validation")).toBe(422);
    expect(status("not-found")).toBe(404);
    expect(status("blocked")).toBe(409);
    expect(status("commit-uncertain")).toBe(409);
    expect(status("read-failed")).toBe(503);
    expect(status("write-failed")).toBe(500);
    expect(status("something-new")).toBe(500);
  });

  it("hands a whole transaction to the store as one request", async () => {
    const applied: unknown[] = [];
    const handler = middleware({}, {
      applyTransaction: (_store: unknown, payload: unknown) => {
        applied.push(payload);
        return Promise.resolve({ mutationToken: "next" });
      },
    });
    const steps = [{ operation: "put", payload: { id: "alpha" } }, { operation: "put", payload: { id: "beta" } }];
    const response = await handler(request("transaction", { expectedMutationToken: "before", steps }));
    expect(JSON.parse(response.body)).toEqual({ ok: true, result: { mutationToken: "next" } });
    expect(applied).toEqual([{ expectedMutationToken: "before", steps }]);
  });

  it("rejects a transaction naming an unsupported or nested step before reaching the store", async () => {
    let created = false;
    const handler = createDomainFileProviderMiddleware<TestStore>({
      domain: "content",
      capability: CAPABILITY,
      isDomainError,
      createStore: () => { created = true; return Promise.resolve({}); },
      operations: { put: () => null },
      applyTransaction: () => Promise.resolve(null),
    });
    for (const body of [
      { steps: [] },
      { steps: [{ operation: "wipe-everything" }] },
      { steps: [{ operation: "transaction" }] },
      { steps: [{ operation: "put", extra: 1 }] },
      { steps: [{ operation: "put" }], unknownField: 1 },
    ]) {
      expect((await handler(request("transaction", body))).status).toBe(400);
    }
    expect(created).toBe(false);
  });

  it("refuses transactions on a domain that did not opt in", async () => {
    const handler = middleware({});
    const response = await handler(request("transaction", { steps: [{ operation: "put" }] }));
    expect(response.status).toBe(400);
    expect(JSON.parse(response.body).error.message).toContain("does not accept transactions");
  });
});
