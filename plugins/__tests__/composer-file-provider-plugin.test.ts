import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilesystemCompositionStore } from "../../src/composer/storage/filesystem";
import { createWorkspaceScopedCompositionStore } from "../../src/composer/storage/file-provider/dev-server-entry";
import { createFilesystemMediaStore } from "../../src/media/storage/filesystem";
import { createMediaRecord } from "../../src/media/library";
import {
  CompositionPersistenceError,
  validateCompositionRecord,
  type CompositionRecord,
} from "../../src/composer/library";
import { createFixtureDocument } from "../../src/composer/__tests__/fixtures";
import { APP_ROOT, appModuleId } from "../roots.mjs";
import { workspaceScopedRoot } from "../../src/shared/workspace-scope";
import plugin, {
  COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER,
  COMPOSER_FILE_PROVIDER_ENDPOINT,
  COMPOSER_FILE_PROVIDER_WORKSPACE_HEADER,
  COMPOSITIONS_ROOT_ENV,
  MEDIA_FILE_PROVIDER_ENDPOINT,
  MEDIA_FILE_PROVIDER_FILE_NAME_HEADER,
  MEDIA_FILE_PROVIDER_OPERATION_HEADER,
  MEDIA_FILE_PROVIDER_RECORD_ID_HEADER,
  MEDIA_FILE_PROVIDER_METADATA_HEADER,
  MEDIA_FILE_PROVIDER_ROOT,
  MEDIA_UPLOAD_MAX_BYTES,
  createComposerFileProviderMiddleware,
  createMediaFileMiddleware,
  createMediaUploadMiddleware,
  resolveCompositionsRoot,
} from "../composer-file-provider-plugin.mjs";

const CAPABILITY = "test-capability-value-that-is-not-guessable";
/** Compositions are workspace scoped; the header names the workspace directory. */
const WORKSPACE = "test-workspace";
const T1 = "2026-01-02T03:04:05.000Z";

let sandbox: string;
let root: string;

function record(id = "alpha"): CompositionRecord {
  const document = createFixtureDocument();
  document.id = id;
  return { id, createdAt: T1, updatedAt: T1, document };
}

function request(
  body: unknown,
  overrides: Partial<{
    method: string;
    url: string;
    headers: Record<string, string>;
    rawBody: string;
    protocol: "http" | "https";
  }> = {},
) {
  return {
    method: overrides.method ?? "POST",
    url: overrides.url ?? COMPOSER_FILE_PROVIDER_ENDPOINT,
    headers: overrides.headers ?? {
      host: "localhost:4321",
      origin: "http://localhost:4321",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json; charset=utf-8",
      [COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER]: CAPABILITY,
      [COMPOSER_FILE_PROVIDER_WORKSPACE_HEADER]: WORKSPACE,
    },
    body: overrides.rawBody ?? JSON.stringify(body),
    protocol: overrides.protocol,
  };
}

function payload(response: { body?: string }) {
  return JSON.parse(response.body ?? "{}");
}

function generated(code: string) {
  return { status: "generated" as const, code };
}

function makeHandler(options: { maxBodyBytes?: number } = {}) {
  return createComposerFileProviderMiddleware({
    capability: CAPABILITY,
    maxBodyBytes: options.maxBodyBytes,
    validateRecord: validateCompositionRecord,
    createStore: ({ workspaceId, provideJsx }) => createFilesystemCompositionStore({
      compositionsRoot: workspaceScopedRoot(join(sandbox, "compositions"), workspaceId),
      provideJsx,
    }),
  });
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "composer-file-provider-"));
  // The endpoint writes below the workspace directory, not the domain root.
  root = workspaceScopedRoot(join(sandbox, "compositions"), WORKSPACE);
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("file-provider request boundary", () => {
  it("requires both an exact same-origin request and Sec-Fetch-Site", async () => {
    const handler = makeHandler();
    for (const headers of [
      { ...request({}).headers, origin: "http://evil.example" },
      { ...request({}).headers, "sec-fetch-site": "same-site" },
      { ...request({}).headers, "sec-fetch-site": "none" },
      { ...request({}).headers, origin: "https://localhost:4321" },
    ]) {
      const response = await handler(request({ operation: "clear" }, { headers }));
      expect(response.status).toBe(403);
      expect(response.headers?.["cache-control"]).toBe("no-store");
    }
  });

  it("accepts an exact HTTPS origin when the active server transport is HTTPS", async () => {
    const handler = makeHandler();
    const headers = { ...request({}).headers, origin: "https://localhost:4321" };
    const response = await handler(request({ operation: "clear" }, { headers, protocol: "https" }));
    expect(response.status).toBe(200);
  });

  it("rejects missing and incorrect capabilities without disclosing the expected value", async () => {
    const handler = makeHandler();
    for (const supplied of [undefined, "wrong"] as const) {
      const headers = { ...request({}).headers };
      if (supplied === undefined) delete headers[COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER];
      else headers[COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER] = supplied;
      const response = await handler(request({ operation: "clear" }, { headers }));
      expect(response.status).toBe(401);
      expect(response.body).not.toContain(CAPABILITY);
    }
  });

  it("enforces the exact route and POST method", async () => {
    const handler = makeHandler();
    const wrongRoute = await handler(request({ operation: "clear" }, {
      url: `${COMPOSER_FILE_PROVIDER_ENDPOINT}/extra`,
    }));
    const queryRoute = await handler(request({ operation: "clear" }, {
      url: `${COMPOSER_FILE_PROVIDER_ENDPOINT}?operation=clear`,
    }));
    const wrongMethod = await handler(request({ operation: "clear" }, { method: "GET" }));

    expect(wrongRoute.status).toBe(404);
    expect(queryRoute.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers?.allow).toBe("POST");
  });

  it("requires application/json and rejects malformed JSON", async () => {
    const handler = makeHandler();
    const textHeaders = { ...request({}).headers, "content-type": "text/plain" };
    expect((await handler(request({}, { headers: textHeaders }))).status).toBe(415);
    expect((await handler(request({}, { rawBody: "{broken" }))).status).toBe(400);
  });

  it("measures the documented body ceiling in UTF-8 bytes", async () => {
    const handler = makeHandler({ maxBodyBytes: 32 });
    const body = JSON.stringify({ operation: "clear", pad: "界界界界" });
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(32);
    const response = await handler(request({}, { rawBody: body }));
    expect(response.status).toBe(413);
    expect(payload(response).error.code).toBe("body-too-large");
  });

  it("rejects invalid records and every unknown filename/path field", async () => {
    const handler = makeHandler();
    const invalid = record("alpha");
    invalid.document.id = "other";

    const validation = await handler(request({ operation: "put", record: invalid, outputsById: {} }));
    expect(validation.status).toBe(422);

    for (const field of ["path", "filename", "filePath"]) {
      const response = await handler(request({ operation: "put", record: record(), outputsById: {}, [field]: "../escape" }));
      expect(response.status).toBe(400);
      expect(payload(response).error.message).toContain("not accepted");

      const taintedRecord = { ...record(), [field]: "../escape" };
      const nested = await handler(request({ operation: "put", record: taintedRecord, outputsById: {} }));
      expect(nested.status).toBe(400);
    }
    await expect(readFile(root)).rejects.toThrow();
  });

  it("sets no-store and JSON headers on success and every error", async () => {
    const handler = makeHandler();
    const responses = [
      await handler(request({ operation: "clear" })),
      await handler(request({ operation: "unknown" })),
      await handler(request({ operation: "clear" }, { method: "PATCH" })),
    ];
    for (const response of responses) {
      expect(response.headers?.["cache-control"]).toBe("no-store");
      expect(response.headers?.["content-type"]).toContain("application/json");
      expect(response.headers?.["x-content-type-options"]).toBe("nosniff");
    }
  });
});

describe("file-provider core integration", () => {
  it("stores the client batch output byte-for-byte without accepting a path", async () => {
    const handler = makeHandler();
    const jsx = "export const exact = '界';\n";
    const response = await handler(request({ operation: "put", record: record(), outputsById: { alpha: generated(jsx) } }));

    expect(response.status).toBe(200);
    expect(await readFile(join(root, "composition-alpha.tsx"), "utf8")).toBe(jsx);
  });

  it("repairs missing and stale output on get before reporting success", async () => {
    const handler = makeHandler();
    await handler(request({ operation: "put", record: record(), outputsById: { alpha: generated("old") } }));
    await unlink(join(root, "composition-alpha.tsx"));

    const needsJsx = await handler(request({ operation: "get", id: "alpha", outputsById: {} }));
    expect(needsJsx.status).toBe(409);
    expect(payload(needsJsx)).toMatchObject({
      error: { code: "output-required", operation: "get" },
      request: { targetIds: ["alpha"] },
    });
    expect(payload(needsJsx).request).not.toHaveProperty("path");

    const repaired = await handler(request({
      operation: "get",
      id: "alpha",
      outputsById: { alpha: generated("production-exact") },
    }));
    expect(repaired.status).toBe(200);
    expect(payload(repaired).result.status).toBe("loaded");
    expect(await readFile(join(root, "composition-alpha.tsx"), "utf8")).toBe("production-exact");

    await writeFile(join(root, "composition-alpha.tsx"), "stale");
    const list = await handler(request({
      operation: "list",
      outputsById: { alpha: generated("production-exact") },
    }));
    expect(list.status).toBe(200);
    expect(payload(list).result).toHaveLength(1);
    expect(await readFile(join(root, "composition-alpha.tsx"), "utf8")).toBe("production-exact");
  });

  it("exposes dependency-safe lifecycle operations and unpublish output handshakes", async () => {
    const handler = makeHandler();
    const source = record("source");
    source.document.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "split-1", slotId: "left" } },
    };
    const consumer = record("consumer");
    consumer.document.binding = { sourceRecordId: source.id, outletId: "outlet-main" };
    expect((await handler(request({ operation: "put", record: source, outputsById: { source: generated("source") } }))).status).toBe(200);
    expect((await handler(request({
      operation: "put",
      record: consumer,
      outputsById: { source: generated("source"), consumer: generated("consumer") },
    }))).status).toBe(200);

    const blocked = await handler(request({ operation: "delete-with-dependency-check", id: source.id }));
    expect(payload(blocked).result).toMatchObject({ status: "blocked", dependents: [{ summary: { id: consumer.id } }] });
    expect((await handler(request({ operation: "delete", id: consumer.id }))).status).toBe(200);

    const needsOutput = await handler(request({ operation: "unpublish-with-dependency-check", id: source.id, outputsById: {} }));
    expect(needsOutput.status).toBe(409);
    expect(payload(needsOutput)).toMatchObject({
      error: { code: "output-required", operation: "unpublish-with-dependency-check" },
      request: { targetIds: [source.id] },
    });
    const unpublished = await handler(request({
      operation: "unpublish-with-dependency-check",
      id: source.id,
      outputsById: { source: generated("unpublished") },
    }));
    expect(payload(unpublished).result).toEqual({ status: "unpublished" });
  });

  it("maps core failures to actionable errors without leaking host paths", async () => {
    const secretPath = join(sandbox, "private-host-path");
    const handler = createComposerFileProviderMiddleware({
      capability: CAPABILITY,
      validateRecord: validateCompositionRecord,
      createStore: async () => {
        throw new CompositionPersistenceError(
          "initialize",
          "read-failed",
          `Could not initialize ${secretPath}`,
          true,
        );
      },
    });
    const response = await handler(request({ operation: "clear" }));
    expect(response.status).toBe(503);
    expect(payload(response).error).toMatchObject({ code: "read-failed", operation: "initialize" });
    expect(response.body).not.toContain(secretPath);
    expect(response.body).toContain("permissions");
  });

  it("never reports a failed derived repair as a successful read", async () => {
    await mkdir(root, { recursive: true });
    const initial = await createFilesystemCompositionStore({
      compositionsRoot: root,
      provideJsx: () => "initial",
    });
    await initial.put(record(), "initial");
    await unlink(join(root, "composition-alpha.tsx"));
    const handler = createComposerFileProviderMiddleware({
      capability: CAPABILITY,
      validateRecord: validateCompositionRecord,
      createStore: async () => ({
        list: vi.fn(),
        get: vi.fn().mockRejectedValue(new CompositionPersistenceError(
          "get", "write-failed", `failed at ${root}`, true,
        )),
        put: vi.fn(), delete: vi.fn(), clear: vi.fn(),
      }),
    });
    const response = await handler(request({
      operation: "get", id: "alpha", outputsById: { alpha: generated("expected") },
    }));
    expect(response.status).toBe(500);
    expect(payload(response).ok).toBe(false);
    expect(response.body).not.toContain(root);
  });
});

describe("media upload request boundary and core integration", () => {
  function mediaRequest(chunks: readonly Uint8Array[], overrides: { headers?: Record<string, string>; url?: string; method?: string } = {}) {
    const stream = Readable.from(chunks) as Readable & { url?: string; method?: string; headers: Record<string, string>; aborted?: boolean; destroyed?: boolean };
    stream.url = overrides.url ?? MEDIA_FILE_PROVIDER_ENDPOINT;
    stream.method = overrides.method ?? "POST";
    stream.headers = overrides.headers ?? {
      host: "localhost:4321", origin: "http://localhost:4321", "sec-fetch-site": "same-origin",
      "content-type": "image/png", [COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER]: CAPABILITY,
      [MEDIA_FILE_PROVIDER_OPERATION_HEADER]: "upload", [MEDIA_FILE_PROVIDER_FILE_NAME_HEADER]: "pixel.png",
    };
    return stream;
  }
  function connectResponse() {
    return { statusCode: 0, destroyed: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn(function (this: { writableEnded: boolean }) { this.writableEnded = true; }) };
  }

  it("streams exact bytes into the media store and returns frozen JSON headers", async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const handler = createMediaUploadMiddleware({ capability: CAPABILITY, createStore: () => createFilesystemMediaStore({ mediaStoreRoot: join(sandbox, "media-store"), idFactory: () => "pixel", now: () => T1 }) });
    const res = connectResponse();
    await handler(mediaRequest([bytes.subarray(0, 8), bytes.subarray(8)]), res);
    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(res.setHeader).toHaveBeenCalledWith("cache-control", "no-store");
    expect(res.setHeader).toHaveBeenCalledWith("x-content-type-options", "nosniff");
    expect(await readFile(join(sandbox, `media-store/versions/sha256-${createHash("sha256").update(bytes).digest("hex")}.png`))).toEqual(Buffer.from(bytes));
  });

  it("rejects request-head failures before opening a store", async () => {
    const createStore = vi.fn();
    const handler = createMediaUploadMiddleware({ capability: CAPABILITY, createStore });
    for (const requestStream of [
      mediaRequest([], { url: `${MEDIA_FILE_PROVIDER_ENDPOINT}?operation=clear` }),
      mediaRequest([], { url: `${MEDIA_FILE_PROVIDER_ENDPOINT}/extra` }),
      mediaRequest([], { method: "GET" }),
      mediaRequest([], { headers: { ...mediaRequest([]).headers, origin: "http://evil.example" } }),
      mediaRequest([], { headers: { ...mediaRequest([]).headers, "sec-fetch-site": "cross-site" } }),
      mediaRequest([], { headers: { ...mediaRequest([]).headers, [COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER]: "wrong" } }),
      mediaRequest([], { headers: { ...mediaRequest([]).headers, "content-type": "text/plain" } }),
    ]) {
      const res = connectResponse();
      await handler(requestStream, res);
      expect(res.end).toHaveBeenCalledTimes(1);
      expect(res.setHeader).toHaveBeenCalledWith("cache-control", "no-store");
      expect(res.setHeader).toHaveBeenCalledWith("x-content-type-options", "nosniff");
      expect(String(res.end.mock.calls[0]![0])).not.toContain(CAPABILITY);
    }
    expect(createStore).not.toHaveBeenCalled();
  });

  it("transports JSON folder/metadata CAS, streamed replacement, exact pins and retained trash", async () => {
    let sequence = 0;
    const store = await createFilesystemMediaStore({ mediaStoreRoot: join(sandbox, "media-store"), idFactory: () => `asset-${++sequence}` });
    const handler = createMediaUploadMiddleware({ capability: CAPABILITY, createStore: async () => store });
    const send = async (operation: string, data: unknown = {}, id?: string, bytes?: Uint8Array) => {
      const headers = { ...mediaRequest([]).headers, "content-type": bytes ? "application/pdf" : "application/json",
        [MEDIA_FILE_PROVIDER_OPERATION_HEADER]: operation,
        ...(id === undefined ? {} : { [MEDIA_FILE_PROVIDER_RECORD_ID_HEADER]: id }),
        ...(bytes === undefined ? {} : { [MEDIA_FILE_PROVIDER_METADATA_HEADER]: encodeURIComponent(JSON.stringify(data)) }),
      };
      const res = connectResponse();
      await handler(mediaRequest([bytes ?? new TextEncoder().encode(JSON.stringify(data))], { headers }), res);
      return { status: res.statusCode, body: JSON.parse(res.end.mock.calls[0]![0] as string) };
    };
    const folder = (await send("create-folder", { input: { name: "Files", parentId: null }, expectedMutationToken: await store.mutationToken() })).body.result;
    const record = await store.upload({ fileName: "original.pdf", declaredMediaType: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.7\noriginal") });
    expect((await send("metadata", { patch: { folderId: folder.id, note: "Transport" }, precondition: { expectedRevision: 1 } }, record.id)).status).toBe(200);
    const replacement = new TextEncoder().encode("%PDF-1.7\nreplacement");
    expect((await send("replace", { precondition: { expectedRevision: 1 } }, record.id, replacement)).status).toBe(409);
    const replaced = await send("replace", { precondition: { expectedRevision: 2 } }, record.id, replacement);
    expect(replaced.status).toBe(200); expect(replaced.body.result.document.versions).toHaveLength(2);
    const ref = { providerId: store.provider.id, assetId: record.id, versionId: record.document.currentVersionId };
    expect((await send("resolve-version", { ref })).body.result.versionId).toBe(ref.versionId);
    expect((await send("trash", { precondition: { expectedRevision: 3 } }, record.id)).status).toBe(200);
    expect((await send("list")).body.result).toEqual([]);
    expect((await send("restore", { precondition: { expectedRevision: 4 } }, record.id)).status).toBe(200);
    expect((await send("snapshot")).body.result.mutationToken).toBe(await store.mutationToken());
    expect((await send("delete", {}, record.id)).status).toBe(422);
    expect((await send("clear")).status).toBe(409);
  });

  it("rejects malformed JSON and binary metadata without invoking mutations", async () => {
    const createStore = vi.fn();
    const handler = createMediaUploadMiddleware({ capability: CAPABILITY, createStore });
    for (const [operation, contentType, header, body] of [
      ["replace", "application/pdf", "%not-json", ""],
      ["metadata", "application/json", "", "{broken"],
      ["metadata", "application/json", "", '{"unexpected":true}'],
    ]) {
      const res = connectResponse();
      await handler(mediaRequest([new TextEncoder().encode(body)], { headers: { ...mediaRequest([]).headers,
        "content-type": contentType!, [MEDIA_FILE_PROVIDER_OPERATION_HEADER]: operation!, [MEDIA_FILE_PROVIDER_METADATA_HEADER]: header!,
      } }), res);
      expect(res.statusCode).toBe(422);
    }
    expect(createStore).not.toHaveBeenCalled();
  });

  it("preflights an oversized content-length before opening the store", async () => {
    const createStore = vi.fn();
    const handler = createMediaUploadMiddleware({ capability: CAPABILITY, createStore });
    const req = mediaRequest([], { headers: { ...mediaRequest([]).headers, "content-length": String(MEDIA_UPLOAD_MAX_BYTES + 1) } });
    const res = connectResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(413);
    expect(createStore).not.toHaveBeenCalled();
  });

  it("accepts a maximally long encoded Unicode display filename", async () => {
    const fileName = "界".repeat(255);
    const upload = vi.fn().mockResolvedValue({ id: "unicode-name" });
    const handler = createMediaUploadMiddleware({ capability: CAPABILITY, createStore: async () => ({ upload }) });
    const req = mediaRequest([], { headers: { ...mediaRequest([]).headers, [MEDIA_FILE_PROVIDER_FILE_NAME_HEADER]: encodeURIComponent(fileName) } });
    const res = connectResponse();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ fileName }));
  });

  it("lets the sink drain chunked overflow and sends one 413", async () => {
    let chunks = 0;
    const handler = createMediaUploadMiddleware({ capability: CAPABILITY, maxBodyBytes: 4, createStore: async () => ({ upload: async ({ bytes }: { bytes: AsyncIterable<Uint8Array> }) => {
      let size = 0;
      for await (const chunk of bytes) { chunks += 1; size += chunk.byteLength; }
      if (size > 4) throw Object.assign(new Error("too large"), { code: "BYTE_CAP_EXCEEDED" });
    } }) });
    const res = connectResponse();
    await handler(mediaRequest([Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5), Uint8Array.of(6)]), res);
    expect(chunks).toBe(3);
    expect(res.statusCode).toBe(413);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it("passes a non-destroying iterator and abort signal, then sends nothing on client abort", async () => {
    const req = mediaRequest([Uint8Array.of(1)]);
    const iterator = vi.spyOn(req, "iterator");
    let release!: () => void;
    const aborted = new Promise<void>((resolve) => { release = resolve; });
    const handler = createMediaUploadMiddleware({ capability: CAPABILITY, createStore: async () => ({
      upload: async ({ signal }: { signal: AbortSignal }) => {
        signal.addEventListener("abort", release, { once: true });
        await aborted;
        signal.throwIfAborted();
      },
    }) });
    const res = connectResponse();
    const pending = handler(req, res);
    await vi.waitFor(() => expect(req.listenerCount("aborted")).toBe(1));
    req.aborted = true;
    req.emit("aborted");
    await pending;
    expect(iterator).toHaveBeenCalledWith({ destroyOnReturn: false });
    expect(res.end).not.toHaveBeenCalled();
    expect(req.listenerCount("aborted")).toBe(0);
  });
});

describe("dev/build registration boundary", () => {
  type RegisteredMiddleware = (request: unknown, response: unknown, next: () => unknown) => unknown;

  function setupSource(command: "serve" | "build", mediaStoreRoot?: string, workspaceRoot = sandbox) {
    const instance = plugin({ mediaStoreRoot, workspaceRoot });
    instance.configResolved({ command });
    const resolved = instance.resolveId("virtual:composer-file-provider-config");
    expect(resolved).toBe("\0virtual:composer-file-provider-config");
    const source = instance.load(resolved);
    if (typeof source !== "string") throw new Error("expected synchronous virtual module");
    return { instance, source };
  }

  async function invokeRegistered(
    middlewares: readonly RegisteredMiddleware[],
    requestStream: unknown,
    response: unknown,
    finalNext: () => unknown = () => undefined,
  ) {
    let index = 0;
    const dispatch = async (): Promise<void> => {
      const middleware = middlewares[index++];
      if (middleware === undefined) {
        await finalNext();
        return;
      }
      await middleware(requestStream, response, dispatch);
    };
    await dispatch();
  }

  async function setupServeServer(mediaStoreRoot?: string, workspaceRoot = sandbox) {
    const { instance, source } = setupSource("serve", mediaStoreRoot, workspaceRoot);
    const middlewares: RegisteredMiddleware[] = [];
    const ssrLoadModule = vi.fn().mockResolvedValue({
      createWorkspaceScopedCompositionStore,
      createFilesystemMediaStore,
      validateCompositionRecord,
    });
    await instance.configureServer?.({
      middlewares: { use(value: RegisteredMiddleware) { middlewares.push(value); } },
      ssrLoadModule,
    } as never);
    expect(middlewares).toHaveLength(3);
    return { instance, source, middlewares, ssrLoadModule };
  }

  function mediaRequest(method: string, url: string) {
    const requestStream = Readable.from([]) as Readable & { method?: string; url?: string; headers: Record<string, string> };
    requestStream.method = method;
    requestStream.url = url;
    requestStream.headers = {};
    return requestStream;
  }

  function mediaResponse() {
    const response = new PassThrough() as PassThrough & {
      statusCode: number;
      headers: Record<string, string>;
      headersSent: boolean;
      setHeader(name: string, value: string): void;
    };
    response.statusCode = 0;
    response.headers = {};
    response.headersSent = false;
    response.setHeader = (name, value) => { response.headers[name] = String(value); };
    return response;
  }

  async function responseBytes(response: PassThrough) {
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async function writeMediaBytes(fileName: string, bytes: Uint8Array) {
    const bytesRoot = join(sandbox, MEDIA_FILE_PROVIDER_ROOT, "versions");
    await mkdir(bytesRoot, { recursive: true });
    await writeFile(join(bytesRoot, fileName), bytes);
    const store = await createFilesystemMediaStore({ mediaStoreRoot: join(sandbox, MEDIA_FILE_PROVIDER_ROOT) });
    const snapshot = await store.snapshot();
    const types = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" } as const;
    const extension = fileName.split(".").at(-1)! as keyof typeof types;
    snapshot.records.push(createMediaRecord({ fileName: "fixture." + extension, mediaType: types[extension], byteLength: bytes.length,
      checksum: fileName.slice(7, 71) }, { id: `fixture-${snapshot.records.length}` }));
    await writeFile(join(sandbox, MEDIA_FILE_PROVIDER_ROOT, "catalog.json"), JSON.stringify(snapshot));
  }

  describe("uploaded-media direct serving", () => {
    it("uploads, redirects and serves only from an explicit isolated root without exposing it", async () => {
      const mediaStoreRoot = join(sandbox, "isolated-media");
      const workspaceRoot = join(sandbox, "project"); await mkdir(workspaceRoot);
      const { middlewares, source } = await setupServeServer(mediaStoreRoot, workspaceRoot);
      expect(source).not.toContain(mediaStoreRoot);
      const config = JSON.parse(source.match(/= (.*);/)![1]!);
      const bytes = Buffer.from("%PDF-1.7\nisolated upload");
      const request = Object.assign(Readable.from([bytes]), { method: "POST", url: MEDIA_FILE_PROVIDER_ENDPOINT, headers: {
        host: "localhost:4321", origin: "http://localhost:4321", "sec-fetch-site": "same-origin", "content-type": "application/pdf",
        [COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER]: config.capability,
        [MEDIA_FILE_PROVIDER_OPERATION_HEADER]: "upload", [MEDIA_FILE_PROVIDER_FILE_NAME_HEADER]: "isolated.pdf",
      } });
      const uploaded = mediaResponse(); await invokeRegistered(middlewares, request, uploaded);
      expect(uploaded.statusCode).toBe(200); await responseBytes(uploaded);
      const store = await createFilesystemMediaStore({ mediaStoreRoot });
      const record = (await store.snapshot()).records[0]!;
      const url = record.document.versions[0]!.url;
      const response = mediaResponse(); await invokeRegistered(middlewares, mediaRequest("GET", url), response);
      expect(await responseBytes(response)).toEqual(bytes);
      const redirect = mediaResponse(); await invokeRegistered(middlewares, mediaRequest("GET", `/uploaded-media/asset-${record.id}`), redirect);
      expect(redirect.headers.location).toBe(url);
      const raw = mediaResponse(); await invokeRegistered(middlewares, mediaRequest("GET", `/@fs/${mediaStoreRoot}/catalog.json`), raw);
      expect(raw.statusCode).toBe(404);
      await expect(readFile(join(workspaceRoot, "media-store", "catalog.json"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(setupSource("build", mediaStoreRoot).source).toBe("export const fileProviderConfig = undefined;\n");
    });
    it.each(["relative/media", "/tmp/../media", "/tmp/media/"])("rejects unresolved roots %s", (mediaStoreRoot) => {
      expect(() => plugin({ mediaStoreRoot })).toThrow("absolute resolved");
      expect(() => createMediaFileMiddleware({ workspaceRoot: sandbox, mediaStoreRoot })).toThrow("absolute resolved");
    });
    it("does not expose or ship failed publication and crash artifacts", async () => {
      const root = join(sandbox, "media-store");
      const store = await createFilesystemMediaStore({ mediaStoreRoot: root, operations: {
        rename: async (from, to) => {
          if (to.endsWith("catalog.json")) throw new Error("injected catalog failure");
          const { rename } = await import("node:fs/promises"); await rename(from, to);
        },
      } });
      const bytes = new TextEncoder().encode("%PDF-1.7\nuncommitted bytes");
      await expect(store.upload({ fileName: "failed.pdf", declaredMediaType: "application/pdf", bytes })).rejects.toMatchObject({ code: "write-failed" });
      const fileName = `sha256-${createHash("sha256").update(bytes).digest("hex")}.pdf`;
      expect(await readFile(join(root, "versions", fileName))).toEqual(Buffer.from(bytes));
      // Reopening represents the same crash artifact with no in-memory state.
      const middleware = createMediaFileMiddleware({ workspaceRoot: sandbox, createStore: () => createFilesystemMediaStore({ mediaStoreRoot: root }) });
      for (const url of [`/uploaded-media/${fileName}`, `/media-store/versions/${fileName}`, `/@fs/${root}/versions/${fileName}`, `/media-store%2fversions/${fileName}`]) {
        const response = mediaResponse(); const next = vi.fn();
        await invokeRegistered([middleware], mediaRequest("GET", url), response, next);
        expect(response.statusCode).toBe(404); expect(next).not.toHaveBeenCalled();
      }
      // Vite's publicDir copy cannot include the private crash artifact.
      const { cp, readdir } = await import("node:fs/promises");
      await writeFile(join(root, "public", "committed-static.txt"), "static input");
      const output = join(sandbox, "artifact"); await cp(join(root, "public"), output, { recursive: true });
      expect(await readdir(output, { recursive: true })).toEqual(["committed-static.txt"]);
    });
    it("resolves authoring URLs to latest while an old exact URL still serves its bytes", async () => {
      const store = await createFilesystemMediaStore({ mediaStoreRoot: join(sandbox, "media-store") });
      const original = new TextEncoder().encode("%PDF-1.7\nold immutable version");
      const record = await store.upload({ fileName: "paper.pdf", declaredMediaType: "application/pdf", bytes: original });
      const oldUrl = record.document.versions[0]!.url;
      const replacement = await store.replace(record.id, { bytes: new TextEncoder().encode("%PDF-1.7\nnew immutable version") }, { expectedRevision: 1 });
      const middleware = createMediaFileMiddleware({ workspaceRoot: sandbox, createStore: async () => store });
      const response = mediaResponse();
      await invokeRegistered([middleware], mediaRequest("GET", `/uploaded-media/asset-${record.id}`), response);
      expect(response.statusCode).toBe(307); expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers.location).toBe(replacement.document.versions[1]!.url);
      const exact = mediaResponse(); await invokeRegistered([middleware], mediaRequest("GET", oldUrl), exact);
      expect(await responseBytes(exact)).toEqual(Buffer.from(original));
      await store.trash(record.id, { expectedRevision: 2 });
      const trashed = mediaResponse(); await invokeRegistered([middleware], mediaRequest("GET", `/uploaded-media/asset-${record.id}`), trashed);
      expect(trashed.statusCode).toBe(404);
      const retained = mediaResponse(); await invokeRegistered([middleware], mediaRequest("GET", oldUrl), retained);
      expect(await responseBytes(retained)).toEqual(Buffer.from(original));
    });

    it("serves files created after middleware registration with the stored byte type", async () => {
      const { middlewares } = await setupServeServer();
      const variants = [
        ["png", "image/png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1])],
        ["jpg", "image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 2])],
        ["gif", "image/gif", Uint8Array.from([0x47, 0x49, 0x46, 0x38, 3])],
        ["webp", "image/webp", Uint8Array.from([0x52, 0x49, 0x46, 0x46, 4])],
        ["pdf", "application/pdf", Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 5])],
      ] as const;

      for (const [extension, contentType, bytes] of variants) {
        const fileName = `sha256-${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
        await writeMediaBytes(fileName, bytes);
        const response = mediaResponse();
        await invokeRegistered(middlewares, mediaRequest("GET", `/uploaded-media/${fileName}?cache=after-upload`), response);

        expect(response.statusCode).toBe(200);
        expect(response.headers).toEqual({
          "content-type": contentType,
          "content-length": String(bytes.byteLength),
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        });
        await expect(responseBytes(response)).resolves.toEqual(Buffer.from(bytes));
      }
    });

    it("returns headers and no body for HEAD", async () => {
      const { middlewares } = await setupServeServer();
      const bytes = Uint8Array.from([1, 2, 3, 4]);
      const fileName = `sha256-${createHash("sha256").update(bytes).digest("hex")}.pdf`;
      await writeMediaBytes(fileName, bytes);
      const response = mediaResponse();

      await invokeRegistered(middlewares, mediaRequest("HEAD", `/uploaded-media/${fileName}`), response);

      expect(response.statusCode).toBe(200);
      expect(response.headers).toEqual({
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
      });
      await expect(responseBytes(response)).resolves.toEqual(Buffer.alloc(0));
    });

    it("returns non-cacheable 404 for uncommitted managed URLs without fallthrough", async () => {
      const { middlewares } = await setupServeServer();
      const response = mediaResponse();
      const next = vi.fn();

      await invokeRegistered(middlewares, mediaRequest("GET", "/uploaded-media/sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png"), response, next);

      expect(next).not.toHaveBeenCalled();
      expect(response.statusCode).toBe(404);
      expect(response.headers).toEqual({ "cache-control": "no-store" });
      expect(response.readableLength).toBe(0);
    });

    it("rejects unsafe names before touching the filesystem", async () => {
      const lstat = vi.fn();
      const middleware = createMediaFileMiddleware({ workspaceRoot: sandbox, operations: { lstat } });
      const unsafeUrls = [
        "/uploaded-media/../x",
        "/uploaded-media/media-a.png/../b.png",
        "/uploaded-media/%2e%2e",
        "/uploaded-media/media-%2e%2e.png",
        "/uploaded-media/.media-x.png",
        "/uploaded-media/nested/media-x.png",
      ];

      for (const url of unsafeUrls) {
        const next = vi.fn();
        await invokeRegistered([middleware], mediaRequest("GET", url), mediaResponse(), next);
        expect(next).toHaveBeenCalledTimes(1);
      }
      expect(lstat).not.toHaveBeenCalled();
    });

    it("rejects names outside the store byte pattern", async () => {
      const lstat = vi.fn();
      const middleware = createMediaFileMiddleware({ workspaceRoot: sandbox, operations: { lstat } });
      const overlongId = "a".repeat(129);
      const driftedUrls = [
        "/uploaded-media/media-_a.png",
        "/uploaded-media/media-a_.png",
        "/uploaded-media/media--a.png",
        "/uploaded-media/media-a-.png",
        "/uploaded-media/media-A.png",
        `/uploaded-media/media-${overlongId}.png`,
        "/uploaded-media/media-a.bmp",
      ];

      for (const url of driftedUrls) {
        const next = vi.fn();
        await invokeRegistered([middleware], mediaRequest("GET", url), mediaResponse(), next);
        expect(next).toHaveBeenCalledTimes(1);
      }
      expect(lstat).not.toHaveBeenCalled();
    });

    it("passes POST requests to the next middleware", async () => {
      const lstat = vi.fn();
      const middleware = createMediaFileMiddleware({ workspaceRoot: sandbox, operations: { lstat } });
      const next = vi.fn();

      await invokeRegistered([middleware], mediaRequest("POST", "/uploaded-media/media-post.png"), mediaResponse(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(lstat).not.toHaveBeenCalled();
    });

    it("passes symlinks and directories to the next middleware", async () => {
      const bytesRoot = join(sandbox, MEDIA_FILE_PROVIDER_ROOT, "versions");
      await mkdir(bytesRoot, { recursive: true });
      const outside = join(sandbox, "outside-media.png");
      await writeFile(outside, Buffer.from("outside"));
      await symlink(outside, join(bytesRoot, "sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png"));
      await mkdir(join(bytesRoot, "sha256-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png"));
      const middleware = createMediaFileMiddleware({ workspaceRoot: sandbox });

      for (const fileName of ["sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png", "sha256-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png"]) {
        const next = vi.fn();
        const response = mediaResponse();
        await invokeRegistered([middleware], mediaRequest("GET", `/uploaded-media/${fileName}`), response, next);
        expect(next).not.toHaveBeenCalled();
        expect(response.statusCode).toBe(404);
      }
    });

    it("returns a plain-text 500 for non-missing open failures", async () => {
      const bytes = Uint8Array.from([1, 2, 3]);
      const fileName = `sha256-${createHash("sha256").update(bytes).digest("hex")}.png`;
      await writeMediaBytes(fileName, bytes);
      const open = vi.fn().mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));
      const middleware = createMediaFileMiddleware({ workspaceRoot: sandbox, operations: { open }, createStore: () => createFilesystemMediaStore({ mediaStoreRoot: join(sandbox, MEDIA_FILE_PROVIDER_ROOT) }) });
      const response = mediaResponse();

      await invokeRegistered([middleware], mediaRequest("GET", `/uploaded-media/${fileName}`), response);

      expect(open).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(500);
      expect(response.headers["content-type"]).toBe("text/plain");
      await expect(responseBytes(response)).resolves.toEqual(Buffer.from("Unable to read uploaded media file."));
    });
  });

  it("injects an unguessable per-server capability only for dev", () => {
    const { source: dev, instance } = setupSource("serve");
    const config = JSON.parse(dev.match(/= (.*);/)?.[1] ?? "null");
    expect(config.endpoint).toBe(COMPOSER_FILE_PROVIDER_ENDPOINT);
    expect(config.mediaEndpoint).toBe(MEDIA_FILE_PROVIDER_ENDPOINT);
    expect(config.mediaMaxBodyBytes).toBe(MEDIA_UPLOAD_MAX_BYTES);
    expect(config.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(config.capability).not.toBe(CAPABILITY);
    const nextDev = JSON.parse(setupSource("serve").source.match(/= (.*);/)?.[1] ?? "null");
    expect(nextDev.capability).not.toBe(config.capability);

    const build = setupSource("build").source;
    expect(build).toBe("export const fileProviderConfig = undefined;\n");
    expect(build).not.toContain(COMPOSER_FILE_PROVIDER_ENDPOINT);
    expect(build).not.toContain(config.capability);
    expect(build).not.toContain("compositions");
    expect(build).not.toContain("files");
    expect(Object.keys(instance).sort()).toEqual([
      "configResolved", "configureServer", "load", "name", "resolveId",
    ]);
  });

  it("rejects repeated Connect chunks over the limit exactly once", async () => {
    const { source, middlewares, ssrLoadModule } = await setupServeServer();
    const config = JSON.parse(source.match(/= (.*);/)?.[1] ?? "null");
    expect(ssrLoadModule).toHaveBeenCalledWith(appModuleId("src/composer/storage/file-provider/dev-server-entry.ts"));

    const requestStream = Readable.from([
      Buffer.alloc(config.maxBodyBytes, 97),
      Buffer.from("overflow"),
      Buffer.from("repeat"),
    ]) as Readable & { url?: string; method?: string; headers: Record<string, string> };
    requestStream.url = COMPOSER_FILE_PROVIDER_ENDPOINT;
    requestStream.method = "POST";
    requestStream.headers = {
      host: "localhost:4321",
      origin: "http://localhost:4321",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      [COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER]: config.capability,
    };
    const response = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    await invokeRegistered(middlewares, requestStream, response);
    expect(response.statusCode).toBe(413);
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(response.end.mock.calls[0]![0]).toContain("body-too-large");
  });

  it("rejects unauthenticated Connect requests before attaching body readers", async () => {
    const { middlewares } = await setupServeServer();
    const requestStream = Readable.from([Buffer.alloc(3 * 1024 * 1024)]) as Readable & {
      url?: string; method?: string; headers: Record<string, string>;
    };
    requestStream.url = COMPOSER_FILE_PROVIDER_ENDPOINT;
    requestStream.method = "POST";
    requestStream.headers = {};
    const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    await invokeRegistered(middlewares, requestStream, response);
    expect(response.statusCode).toBe(403);
    expect(requestStream.listenerCount("data")).toBe(0);
  });

  it("settles a prematurely aborted authenticated request", async () => {
    const { source, middlewares } = await setupServeServer();
    const config = JSON.parse(source.match(/= (.*);/)?.[1] ?? "null");
    let emitted = false;
    const requestStream = new Readable({
      read() {
        if (emitted) return;
        emitted = true;
        this.push("{partial");
        this.emit("aborted");
        this.push(null);
      },
    }) as Readable & { url?: string; method?: string; headers: Record<string, string> };
    requestStream.url = COMPOSER_FILE_PROVIDER_ENDPOINT;
    requestStream.method = "POST";
    requestStream.headers = {
      host: "localhost:4321",
      origin: "http://localhost:4321",
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      [COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER]: config.capability,
    };
    const response = { statusCode: 0, destroyed: false, setHeader: vi.fn(), end: vi.fn() };
    await invokeRegistered(middlewares, requestStream, response);
    expect(response.statusCode).toBe(400);
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it("never loads the Node filesystem entry for production configuration", async () => {
    const { instance } = setupSource("build");
    const ssrLoadModule = vi.fn();
    const use = vi.fn();
    await instance.configureServer?.({ ssrLoadModule, middlewares: { use } } as never);
    expect(ssrLoadModule).not.toHaveBeenCalled();
    expect(use).not.toHaveBeenCalled();
  });

  it("writes compositions into a foreign workspace root while loading package entries from the package", async () => {
    const workspaceRoot = join(sandbox, "host-project"); await mkdir(workspaceRoot);
    const { source, middlewares, ssrLoadModule } = await setupServeServer(undefined, workspaceRoot);
    const config = JSON.parse(source.match(/= (.*);/)![1]!);
    const body = JSON.stringify({ operation: "put", record: record(), outputsById: { alpha: generated("export const exact = 1;\n") } });
    const requestStream = Object.assign(Readable.from([Buffer.from(body)]), {
      method: "POST", url: COMPOSER_FILE_PROVIDER_ENDPOINT,
      headers: {
        host: "localhost:4321", origin: "http://localhost:4321", "sec-fetch-site": "same-origin", "content-type": "application/json",
        [COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER]: config.capability,
        [COMPOSER_FILE_PROVIDER_WORKSPACE_HEADER]: WORKSPACE,
      },
    });
    const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    await invokeRegistered(middlewares, requestStream, response);
    expect(response.statusCode).toBe(200);
    const stored = JSON.parse(await readFile(join(workspaceScopedRoot(join(workspaceRoot, "compositions"), WORKSPACE), "composition-alpha.composition.json"), "utf8"));
    expect(stored.id).toBe("alpha");
    // The package directory and the process working directory are both foreign
    // to the host workspace and must stay untouched.
    for (const foreign of new Set([APP_ROOT, process.cwd(), sandbox])) {
      await expect(readFile(join(foreign, "compositions", "composition-alpha.composition.json"))).rejects.toMatchObject({ code: "ENOENT" });
    }
    const specifiers = ssrLoadModule.mock.calls.map(([value]) => value as string);
    expect(specifiers).toHaveLength(2);
    for (const specifier of specifiers) {
      expect(specifier.startsWith("/@fs")).toBe(true);
      expect(specifier).toContain(APP_ROOT.split(sep).join("/"));
    }
    expect(specifiers).toContain(appModuleId("src/media/storage/file-provider/dev-server-entry.ts"));
  });

  it("resolves the compositions root from the explicit option, then the environment, then the workspace", () => {
    const workspaceRoot = join(sandbox, "host-project");
    expect(resolveCompositionsRoot(workspaceRoot)).toBe(join(workspaceRoot, "compositions"));
    try {
      vi.stubEnv(COMPOSITIONS_ROOT_ENV, join(sandbox, "elsewhere"));
      expect(resolveCompositionsRoot(workspaceRoot)).toBe(join(sandbox, "elsewhere"));
      expect(resolveCompositionsRoot(workspaceRoot, join(sandbox, "explicit"))).toBe(join(sandbox, "explicit"));
      vi.stubEnv(COMPOSITIONS_ROOT_ENV, "relative/compositions");
      expect(() => resolveCompositionsRoot(workspaceRoot)).toThrow("absolute resolved");
    } finally { vi.unstubAllEnvs(); }
  });
});
