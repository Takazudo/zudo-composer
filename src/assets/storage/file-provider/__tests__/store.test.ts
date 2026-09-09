import { beforeEach, describe, expect, it, vi } from "vitest";

const { DEV_CONFIG } = vi.hoisted(() => ({ DEV_CONFIG: {
  assetEndpoint: "/assets-dev", capability: "secret", capabilityHeader: "x-cap",
  assetMaxBodyBytes: 25, assetOperationHeader: "x-operation",
  assetFileNameHeader: "x-file-name", assetRecordIdHeader: "x-record-id", assetMetadataHeader: "x-metadata",
} }));
vi.mock("virtual:composer-file-provider-config", () => ({ fileProviderConfig: DEV_CONFIG }));

import { createFileProviderAssetProvider } from "../store";
import { createAssetRecord } from "../../../library";
import { assetVersionUrl } from "../../../model";
import { subscribePersistenceChanges } from "../../../../shared/persistence-generation";

const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
});
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => { fetchMock = vi.fn<typeof fetch>(); });

describe("browser assets file provider", () => {
  it("notifies successful delete only after its response, never on a failed delete", async () => {
    const changed = vi.fn(); const stop = subscribePersistenceChanges(changed);
    const store = createFileProviderAssetProvider({ fetch: fetchMock })!.store;
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => { finish = resolve; }));
    try {
      const pending = store.delete("hero", { expectedRevision: 1 });
      expect(changed).not.toHaveBeenCalled();
      finish(response({ ok: true, result: true }));
      await expect(pending).resolves.toBe(true);
      expect(changed).toHaveBeenCalledExactlyOnceWith("assets");
      changed.mockClear();
      fetchMock.mockResolvedValueOnce(response({ ok: false, error: { code: "conflict", message: "stale revision" } }, 409));
      await expect(store.delete("hero", { expectedRevision: 1 })).rejects.toThrow("stale revision");
      expect(changed).not.toHaveBeenCalled();
    } finally { stop(); }
  });
  const ref = { providerId: "asset-files", assetId: "hero", versionId: "a".repeat(64) };
  const pin = { ...ref, checksum: ref.versionId, byteLength: 8, mimeType: "image/png", url: assetVersionUrl(ref.versionId, "image/png") };
  it.each([
    { extra: true }, { providerId: "other" }, { assetId: "other" }, { versionId: "b".repeat(64) },
    { checksum: "A".repeat(64) }, { byteLength: 0 }, { byteLength: 25 * 1024 * 1024 + 1 },
    { mimeType: "text/html" }, { url: "https://other.invalid/file.png" }, { url: "/uploaded-assets/other.png" },
  ])("rejects malformed or mismatched exact pins: %s", async (patch) => {
    fetchMock.mockResolvedValue(response({ ok: true, result: { ...pin, ...patch } }));
    await expect(createFileProviderAssetProvider({ fetch: fetchMock })!.store.resolveVersion(ref)).rejects.toMatchObject({ code: "validation", operation: "pin", retryable: false });
  });
  it("requires exact deterministic deduplicated manifest coverage", async () => {
    const otherRef = { ...ref, assetId: "zebra" }; const otherPin = { ...pin, ...otherRef };
    const store = createFileProviderAssetProvider({ fetch: fetchMock })!.store;
    for (const result of [
      { schemaVersion: 2, pins: [pin, otherPin] }, { schemaVersion: 1, pins: [pin, otherPin], extra: true },
      { schemaVersion: 1, pins: [pin] }, { schemaVersion: 1, pins: [otherPin, pin] },
      { schemaVersion: 1, pins: [pin, pin, otherPin] }, { schemaVersion: 1, pins: [pin, { ...otherPin, byteLength: -1 }] },
    ]) {
      fetchMock.mockResolvedValue(response({ ok: true, result }));
      await expect(store.pinManifest([otherRef, ref, ref])).rejects.toMatchObject({ code: "validation" });
    }
    const valid = { schemaVersion: 1, pins: [pin, otherPin] };
    fetchMock.mockResolvedValue(response({ ok: true, result: valid }));
    await expect(store.pinManifest([otherRef, ref, ref])).resolves.toEqual(valid);
    fetchMock.mockResolvedValue(response({ ok: true, result: pin }));
    await expect(store.resolveVersion(ref)).resolves.toEqual(pin);
  });
  it("preserves uncertain-commit errors as non-retryable", async () => {
    fetchMock.mockResolvedValue(response({ ok: false, error: { code: "commit-uncertain", message: "Inspect exact token" } }, 409));
    await expect(createFileProviderAssetProvider({ fetch: fetchMock })!.store.trash("hero", { expectedRevision: 1 })).rejects.toMatchObject({ code: "commit-uncertain", retryable: false });
  });
  it("rejects missing or foreign requested identities before transport", async () => {
    const store = createFileProviderAssetProvider({ fetch: fetchMock })!.store;
    await expect(store.resolveVersion(undefined as never)).rejects.toMatchObject({ code: "validation" });
    await expect(store.resolveVersion({ ...ref, providerId: "foreign" })).rejects.toMatchObject({ code: "validation" });
    await expect(store.pinManifest(undefined as never)).rejects.toMatchObject({ code: "validation" });
    await expect(store.pinManifest([{ ...ref, providerId: "foreign" }])).rejects.toMatchObject({ code: "validation" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses the shared capability and bounded header metadata for raw uploads", async () => {
    const record = createAssetRecord({ fileName: "hero image.png", mimeType: "image/png", byteLength: 8, checksum: "a".repeat(64) }, { id: "asset-1", timestamp: "2026-01-01T00:00:00.000Z" });
    fetchMock.mockResolvedValue(response({ ok: true, result: record }));
    const provider = createFileProviderAssetProvider({ fetch: fetchMock })!;
    const file = new File([new Uint8Array(8)], "hero image.png", { type: "image/png" });
    await expect(provider.store.upload(file)).resolves.toEqual(record);
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(url).toBe(DEV_CONFIG.assetEndpoint);
    expect(init).toMatchObject({ method: "POST", body: file, cache: "no-store", credentials: "same-origin" });
    expect(headers.get("x-cap")).toBe(DEV_CONFIG.capability);
    expect(headers.get("x-operation")).toBe("upload");
    expect(headers.get("x-file-name")).toBe("hero%20image.png");
    expect(headers.get("content-type")).toBe("image/png");
  });

  it("rejects an oversized upload locally as actionable and non-retryable", async () => {
    const provider = createFileProviderAssetProvider({ fetch: fetchMock })!;
    await expect(provider.store.upload(new File([new Uint8Array(26)], "large.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "validation", operation: "put", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a server body-too-large response to the same non-retryable contract", async () => {
    fetchMock.mockResolvedValue(response({ ok: false, error: { code: "body-too-large", message: "Choose a smaller file." } }, 413));
    const provider = createFileProviderAssetProvider({ fetch: fetchMock })!;
    await expect(provider.store.upload(new File([new Uint8Array(8)], "large.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "validation", operation: "put", retryable: false, message: "Choose a smaller file." });
  });

  it("rejects a malformed successful upload record at the browser boundary", async () => {
    fetchMock.mockResolvedValue(response({ ok: true, result: { id: "../unsafe" } }));
    const provider = createFileProviderAssetProvider({ fetch: fetchMock })!;
    await expect(provider.store.upload(new File([new Uint8Array(8)], "hero.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "validation", operation: "put", retryable: false });
  });

  it("streams explicit replacement with metadata CAS and validates its response", async () => {
    const record = createAssetRecord({ fileName: "hero.png", mimeType: "image/png", byteLength: 8, checksum: "a".repeat(64) }, { id: "hero" });
    fetchMock.mockResolvedValue(response({ ok: true, result: record }));
    const store = createFileProviderAssetProvider({ fetch: fetchMock })!.store;
    const file = new Blob([new Uint8Array(8)], { type: "image/png" });
    await expect(store.replace("hero", file, { expectedRevision: 1 })).resolves.toEqual(record);
    const init = fetchMock.mock.calls[0]![1]!; const headers = new Headers(init.headers);
    expect(init.body).toBe(file); expect(headers.get("x-operation")).toBe("replace");
    expect(headers.get("x-record-id")).toBe("hero");
    expect(JSON.parse(decodeURIComponent(headers.get("x-metadata")!))).toEqual({ precondition: { expectedRevision: 1 } });
    fetchMock.mockResolvedValue(response({ ok: false, error: { code: "conflict", message: "Reload" } }, 409));
    await expect(store.replace("hero", file, { expectedRevision: 1 })).rejects.toMatchObject({ code: "conflict", retryable: false });
    fetchMock.mockResolvedValue(response({ ok: true, result: { id: "hero" } }));
    await expect(store.replace("hero", file, { expectedRevision: 1 })).rejects.toMatchObject({ code: "validation" });
  });

  it("reads persisted tokens, exposes unavailable purge, and rejects oversized header metadata", async () => {
    const store = createFileProviderAssetProvider({ fetch: fetchMock })!.store;
    const snapshot = { schemaVersion: 1, mutationToken: "a".repeat(64), records: [], folders: [] };
    fetchMock.mockResolvedValue(response({ ok: true, result: snapshot }));
    expect(await store.mutationToken()).toBe(snapshot.mutationToken);
    expect(store.capabilities.permanentDelete).toBe(false);
    fetchMock.mockClear();
    await expect(store.upload(new File([new Uint8Array(8)], "hero.png"), { note: "あ".repeat(2000) })).rejects.toMatchObject({ code: "validation" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adapts initialization and truthfully refuses destructive startFresh", async () => {
    const summary = { id: "hero", fileName: "hero.png", mimeType: "image/png", byteLength: 8, checksum: "a".repeat(64), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    fetchMock.mockResolvedValue(response({ ok: true, result: { status: "ready", summaries: [summary] } }));
    const provider = createFileProviderAssetProvider({ fetch: fetchMock })!;
    await expect(provider.initialization.initialize()).resolves.toEqual({ status: "ready", summaries: [summary] });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("x-operation")).toBe("initialize");
    fetchMock.mockReset();
    await expect(provider.initialization.startFresh()).resolves.toMatchObject({ status: "error", error: { code: "blocked" } });
    await expect(provider.store.clear()).rejects.toMatchObject({ code: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
