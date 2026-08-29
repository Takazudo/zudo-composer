import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureManifest, makeAbcDocument } from "../../../__tests__/fixtures";
import { isCompositionLifecycleStore, type CompositionRecord } from "../../../library";

const { DEV_CONFIG } = vi.hoisted(() => ({
  DEV_CONFIG: {
    endpoint: "/dev-only-endpoint",
    capability: "dev-secret",
    capabilityHeader: "x-test-capability",
    maxBodyBytes: 2_097_152,
  },
}));

vi.mock("virtual:composer-file-provider-config", () => ({
  fileProviderConfig: DEV_CONFIG,
}));

import { createFileProviderCompositionStore } from "../store";

const T1 = "2026-01-02T03:04:05.000Z";

function record(id = "alpha"): CompositionRecord {
  const document = makeAbcDocument();
  document.id = id;
  return { id, createdAt: T1, updatedAt: T1, document };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function outputRequest(records: readonly CompositionRecord[], targetIds = records.map((value) => value.id)) {
  return {
    records,
    sourceOutcomes: records.map((value) => ({ id: value.id, outcome: { status: "loaded", record: value } })),
    targetIds,
  };
}

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>();
});

describe("browser file-provider adapter", () => {
  it("plans put output from the server-supplied closure without exposing paths", async () => {
    const value = record();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        error: { code: "output-required", operation: "put", message: "plan" },
        request: outputRequest([value]),
      }, 409))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: {
        canonical: { status: "saved" }, derived: { status: "repaired", records: [{ recordId: value.id, status: "repaired" }] },
      } }));
    const store = createFileProviderCompositionStore({ catalog: fixtureManifest, fetch: fetchMock });

    await expect(store!.put(value)).resolves.toMatchObject({ canonical: { status: "saved" }, derived: { status: "repaired" } });

    const [endpoint, init] = fetchMock.mock.calls[1]!;
    expect(endpoint).toBe(DEV_CONFIG.endpoint);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
    expect(new Headers(init?.headers).get(DEV_CONFIG.capabilityHeader)).toBe(DEV_CONFIG.capability);
    const body = JSON.parse(String(init?.body));
    expect(body.operation).toBe("put");
    expect(body).not.toHaveProperty("path");
    expect(body).not.toHaveProperty("filename");
    expect(body.outputsById.alpha).toMatchObject({ status: "generated" });
    expect(body.outputsById.alpha.code).toContain("export default function Composition");
  });

  it("generates requested list/get repair bytes then waits for repaired success", async () => {
    const value = record();
    const summary = {
      id: value.id, name: value.document.name,
      createdAt: value.createdAt, updatedAt: value.updatedAt, nodeCount: 4,
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        error: { code: "output-required", operation: "list", message: "repair" },
        request: outputRequest([value]),
      }, 409))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: [summary] }));
    const store = createFileProviderCompositionStore({ catalog: fixtureManifest, fetch: fetchMock });

    await expect(store!.list()).resolves.toEqual([summary]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(first.outputsById).toEqual({});
    expect(second.outputsById.alpha).toMatchObject({ status: "generated" });
  });

  it("reports blocked generated output separately from a successful canonical save", async () => {
    const value = record();
    value.document.root[0]!.componentId = "unknown.component";
    const store = createFileProviderCompositionStore({ catalog: fixtureManifest, fetch: fetchMock });

    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        error: { code: "output-required", operation: "put", message: "plan" },
        request: outputRequest([value]),
      }, 409))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: {
        canonical: { status: "saved" },
        derived: { status: "blocked", records: [{ recordId: value.id, status: "blocked", reason: "unsupported node" }] },
      } }));
    await expect(store!.put(value)).resolves.toMatchObject({
      canonical: { status: "saved" }, derived: { status: "blocked" },
    });

  });

  it("maps transport and sanitized server failures to the shared error contract", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    const store = createFileProviderCompositionStore({ catalog: fixtureManifest, fetch: fetchMock });
    await expect(store!.clear()).rejects.toMatchObject({
      operation: "clear", code: "unavailable", retryable: true,
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({
      ok: false,
      error: { code: "blocked", operation: "delete", message: "Inspect the compositions directory." },
    }, 409));
    await expect(store!.delete("alpha")).rejects.toMatchObject({
      operation: "delete", code: "blocked", retryable: false,
    });
  });

  it("rejects malformed JSON protocol errors through the shared error contract", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ok: false }));
    const store = createFileProviderCompositionStore({ catalog: fixtureManifest, fetch: fetchMock });

    await expect(store!.clear()).rejects.toMatchObject({
      name: "CompositionPersistenceError",
      operation: "clear",
      code: "unknown",
    });
  });

  it("returns the shared get/delete/clear result shapes", async () => {
    const value = record();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { status: "loaded", record: value } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: null }));
    const store = createFileProviderCompositionStore({ catalog: fixtureManifest, fetch: fetchMock });

    await expect(store!.get("alpha")).resolves.toEqual({ status: "loaded", record: value });
    await expect(store!.delete("alpha")).resolves.toBe(true);
    await expect(store!.clear()).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).operation))
      .toEqual(["get", "delete", "clear"]);
  });

  it("preserves lifecycle capabilities and completes unpublish after output planning", async () => {
    const value = record("source");
    value.document.publication = {
      kind: "global-template",
      outlet: { id: "main", label: "Main", target: { parentId: "split", slotId: "left" } },
    };
    const unpublished = structuredClone(value);
    delete unpublished.document.publication;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { status: "blocked", dependents: [] } }))
      .mockResolvedValueOnce(jsonResponse({
        ok: false,
        error: { code: "output-required", operation: "unpublish-with-dependency-check", message: "plan" },
        request: outputRequest([unpublished]),
      }, 409))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { status: "unpublished" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: null }));
    const store = createFileProviderCompositionStore({ catalog: fixtureManifest, fetch: fetchMock });
    expect(isCompositionLifecycleStore(store!)).toBe(true);
    if (!store || !isCompositionLifecycleStore(store)) throw new Error("missing lifecycle capability");

    await expect(store.deleteWithDependencyCheck("source")).resolves.toMatchObject({ status: "blocked" });
    await expect(store.unpublishWithDependencyCheck("source")).resolves.toEqual({ status: "unpublished" });
    await expect(store.saveLifecycleRecord(value)).resolves.toBeUndefined();

    const bodies = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies.map(({ operation }) => operation)).toEqual([
      "delete-with-dependency-check",
      "unpublish-with-dependency-check",
      "unpublish-with-dependency-check",
      "save-lifecycle-record",
    ]);
    expect(bodies[2].outputsById.source).toMatchObject({ status: "generated" });
  });

});
