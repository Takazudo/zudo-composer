import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilesystemCompositionStore } from "../../src/composer/storage/filesystem";
import { createFilesystemMediaStore } from "../../src/media/storage/filesystem";
import {
  CompositionPersistenceError,
  validateCompositionRecord,
  type CompositionRecord,
} from "../../src/composer/library";
import { createFixtureDocument } from "../../src/composer/__tests__/fixtures";
import plugin, {
  COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER,
  COMPOSER_FILE_PROVIDER_ENDPOINT,
  MEDIA_FILE_PROVIDER_ENDPOINT,
  MEDIA_FILE_PROVIDER_FILE_NAME_HEADER,
  MEDIA_FILE_PROVIDER_OPERATION_HEADER,
  MEDIA_FILE_PROVIDER_ROOT,
  MEDIA_UPLOAD_MAX_BYTES,
  createComposerFileProviderMiddleware,
  createMediaFileMiddleware,
  createMediaUploadMiddleware,
} from "../composer-file-provider-plugin.mjs";

const CAPABILITY = "test-capability-value-that-is-not-guessable";
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
    createStore: ({ provideJsx }) => createFilesystemCompositionStore({
      compositionsRoot: root,
      provideJsx,
    }),
  });
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "composer-file-provider-"));
  root = join(sandbox, "compositions");
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
    await mkdir(root);
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
    expect(await readFile(join(sandbox, "media-store/public/uploaded-media/media-pixel.png"))).toEqual(Buffer.from(bytes));
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

  function setupSource(command: "serve" | "build") {
    const instance = plugin();
    instance.configResolved({ command, root: sandbox });
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

  async function setupServeServer() {
    const { instance, source } = setupSource("serve");
    const middlewares: RegisteredMiddleware[] = [];
    const ssrLoadModule = vi.fn().mockResolvedValue({
      createFilesystemCompositionStore,
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
    const bytesRoot = join(sandbox, MEDIA_FILE_PROVIDER_ROOT, "public", "uploaded-media");
    await mkdir(bytesRoot, { recursive: true });
    await writeFile(join(bytesRoot, fileName), bytes);
  }

  describe("uploaded-media direct serving", () => {
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
        const fileName = `media-${extension}.${extension}`;
        await writeMediaBytes(fileName, bytes);
        const response = mediaResponse();
        await invokeRegistered(middlewares, mediaRequest("GET", `/uploaded-media/${fileName}?cache=after-upload`), response);

        expect(response.statusCode).toBe(200);
        expect(response.headers).toEqual({
          "content-type": contentType,
          "content-length": String(bytes.byteLength),
          "cache-control": "no-cache",
        });
        await expect(responseBytes(response)).resolves.toEqual(Buffer.from(bytes));
      }
    });

    it("returns headers and no body for HEAD", async () => {
      const { middlewares } = await setupServeServer();
      const bytes = Uint8Array.from([1, 2, 3, 4]);
      await writeMediaBytes("media-head.pdf", bytes);
      const response = mediaResponse();

      await invokeRegistered(middlewares, mediaRequest("HEAD", "/uploaded-media/media-head.pdf"), response);

      expect(response.statusCode).toBe(200);
      expect(response.headers).toEqual({
        "content-type": "application/pdf",
        "content-length": String(bytes.byteLength),
        "cache-control": "no-cache",
      });
      await expect(responseBytes(response)).resolves.toEqual(Buffer.alloc(0));
    });

    it("passes missing files to the next middleware without writing a response", async () => {
      const { middlewares } = await setupServeServer();
      const response = mediaResponse();
      const next = vi.fn();

      await invokeRegistered(middlewares, mediaRequest("GET", "/uploaded-media/media-missing.png"), response, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(response.statusCode).toBe(0);
      expect(response.headers).toEqual({});
      expect(response.readableLength).toBe(0);
    });

    it("rejects unsafe names before touching the filesystem", async () => {
      const lstat = vi.fn();
      const middleware = createMediaFileMiddleware({ projectRoot: sandbox, operations: { lstat } });
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
      const middleware = createMediaFileMiddleware({ projectRoot: sandbox, operations: { lstat } });
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
      const middleware = createMediaFileMiddleware({ projectRoot: sandbox, operations: { lstat } });
      const next = vi.fn();

      await invokeRegistered([middleware], mediaRequest("POST", "/uploaded-media/media-post.png"), mediaResponse(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(lstat).not.toHaveBeenCalled();
    });

    it("passes symlinks and directories to the next middleware", async () => {
      const bytesRoot = join(sandbox, MEDIA_FILE_PROVIDER_ROOT, "public", "uploaded-media");
      await mkdir(bytesRoot, { recursive: true });
      const outside = join(sandbox, "outside-media.png");
      await writeFile(outside, Buffer.from("outside"));
      await symlink(outside, join(bytesRoot, "media-link.png"));
      await mkdir(join(bytesRoot, "media-directory.png"));
      const middleware = createMediaFileMiddleware({ projectRoot: sandbox });

      for (const fileName of ["media-link.png", "media-directory.png"]) {
        const next = vi.fn();
        await invokeRegistered([middleware], mediaRequest("GET", `/uploaded-media/${fileName}`), mediaResponse(), next);
        expect(next).toHaveBeenCalledTimes(1);
      }
    });

    it("returns a plain-text 500 for non-missing open failures", async () => {
      await writeMediaBytes("media-denied.png", Uint8Array.from([1, 2, 3]));
      const open = vi.fn().mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));
      const middleware = createMediaFileMiddleware({ projectRoot: sandbox, operations: { open } });
      const response = mediaResponse();

      await invokeRegistered([middleware], mediaRequest("GET", "/uploaded-media/media-denied.png"), response);

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
    expect(ssrLoadModule).toHaveBeenCalledWith("/src/composer/storage/file-provider/dev-server-entry.ts");

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
});
