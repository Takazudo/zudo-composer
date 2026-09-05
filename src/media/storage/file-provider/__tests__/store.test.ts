import { beforeEach, describe, expect, it, vi } from "vitest";

const { DEV_CONFIG } = vi.hoisted(() => ({ DEV_CONFIG: {
  mediaEndpoint: "/media-dev", capability: "secret", capabilityHeader: "x-cap",
  mediaMaxBodyBytes: 25, mediaOperationHeader: "x-operation",
  mediaFileNameHeader: "x-file-name", mediaRecordIdHeader: "x-record-id", mediaMetadataHeader: "x-metadata",
} }));
vi.mock("virtual:composer-file-provider-config", () => ({ fileProviderConfig: DEV_CONFIG }));

import { createFileProviderMediaProvider } from "../store";
import { createMediaRecord } from "../../../library";

const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "content-type": "application/json" },
});
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => { fetchMock = vi.fn<typeof fetch>(); });

describe("browser media file provider", () => {
  it("uses the shared capability and bounded header metadata for raw uploads", async () => {
    const record = createMediaRecord({ fileName: "hero image.png", mediaType: "image/png", byteLength: 8, checksum: "a".repeat(64) }, { id: "media-1", timestamp: "2026-01-01T00:00:00.000Z" });
    fetchMock.mockResolvedValue(response({ ok: true, result: record }));
    const provider = createFileProviderMediaProvider({ fetch: fetchMock })!;
    const file = new File([new Uint8Array(8)], "hero image.png", { type: "image/png" });
    await expect(provider.store.upload(file)).resolves.toEqual(record);
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(url).toBe(DEV_CONFIG.mediaEndpoint);
    expect(init).toMatchObject({ method: "POST", body: file, cache: "no-store", credentials: "same-origin" });
    expect(headers.get("x-cap")).toBe(DEV_CONFIG.capability);
    expect(headers.get("x-operation")).toBe("upload");
    expect(headers.get("x-file-name")).toBe("hero%20image.png");
    expect(headers.get("content-type")).toBe("image/png");
  });

  it("rejects an oversized upload locally as actionable and non-retryable", async () => {
    const provider = createFileProviderMediaProvider({ fetch: fetchMock })!;
    await expect(provider.store.upload(new File([new Uint8Array(26)], "large.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "validation", operation: "put", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a server body-too-large response to the same non-retryable contract", async () => {
    fetchMock.mockResolvedValue(response({ ok: false, error: { code: "body-too-large", message: "Choose a smaller file." } }, 413));
    const provider = createFileProviderMediaProvider({ fetch: fetchMock })!;
    await expect(provider.store.upload(new File([new Uint8Array(8)], "large.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "validation", operation: "put", retryable: false, message: "Choose a smaller file." });
  });

  it("rejects a malformed successful upload record at the browser boundary", async () => {
    fetchMock.mockResolvedValue(response({ ok: true, result: { id: "../unsafe" } }));
    const provider = createFileProviderMediaProvider({ fetch: fetchMock })!;
    await expect(provider.store.upload(new File([new Uint8Array(8)], "hero.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "validation", operation: "put", retryable: false });
  });

  it("streams explicit replacement with metadata CAS and validates its response", async () => {
    const record = createMediaRecord({ fileName: "hero.png", mediaType: "image/png", byteLength: 8, checksum: "a".repeat(64) }, { id: "hero" });
    fetchMock.mockResolvedValue(response({ ok: true, result: record }));
    const store = createFileProviderMediaProvider({ fetch: fetchMock })!.store;
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
    const store = createFileProviderMediaProvider({ fetch: fetchMock })!.store;
    const snapshot = { schemaVersion: 2, mutationToken: "a".repeat(64), records: [], folders: [] };
    fetchMock.mockResolvedValue(response({ ok: true, result: snapshot }));
    expect(await store.mutationToken()).toBe(snapshot.mutationToken);
    expect(store.capabilities.permanentDelete).toBe(false);
    fetchMock.mockClear();
    await expect(store.upload(new File([new Uint8Array(8)], "hero.png"), { note: "あ".repeat(2000) })).rejects.toMatchObject({ code: "validation" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adapts initialization and truthfully refuses destructive startFresh", async () => {
    const summary = { id: "hero", fileName: "hero.png", mediaType: "image/png", byteLength: 8, checksum: "a".repeat(64), createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
    fetchMock.mockResolvedValue(response({ ok: true, result: { status: "ready", summaries: [summary] } }));
    const provider = createFileProviderMediaProvider({ fetch: fetchMock })!;
    await expect(provider.initialization.initialize()).resolves.toEqual({ status: "ready", summaries: [summary] });
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("x-operation")).toBe("initialize");
    fetchMock.mockReset();
    await expect(provider.initialization.startFresh()).resolves.toMatchObject({ status: "error", error: { code: "blocked" } });
    await expect(provider.store.clear()).rejects.toMatchObject({ code: "blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
