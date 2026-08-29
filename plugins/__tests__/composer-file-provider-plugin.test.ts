import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFilesystemCompositionStore } from "../../src/composer/storage/filesystem";
import {
  CompositionPersistenceError,
  validateCompositionRecord,
  type CompositionRecord,
} from "../../src/composer/library";
import { createFixtureDocument } from "../../src/composer/__tests__/fixtures";
import plugin, {
  COMPOSER_FILE_PROVIDER_CAPABILITY_HEADER,
  COMPOSER_FILE_PROVIDER_ENDPOINT,
  createComposerFileProviderMiddleware,
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

describe("dev/build registration boundary", () => {
  function setupSource(command: "serve" | "build") {
    const instance = plugin();
    instance.configResolved({ command, root: sandbox });
    const resolved = instance.resolveId("virtual:composer-file-provider-config");
    expect(resolved).toBe("\0virtual:composer-file-provider-config");
    const source = instance.load(resolved);
    if (typeof source !== "string") throw new Error("expected synchronous virtual module");
    return { instance, source };
  }

  it("injects an unguessable per-server capability only for dev", () => {
    const { source: dev, instance } = setupSource("serve");
    const config = JSON.parse(dev.match(/= (.*);/)?.[1] ?? "null");
    expect(config.endpoint).toBe(COMPOSER_FILE_PROVIDER_ENDPOINT);
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
    const { instance, source } = setupSource("serve");
    const config = JSON.parse(source.match(/= (.*);/)?.[1] ?? "null");
    let middleware: ((request: Readable & { url?: string; method?: string; headers: Record<string, string> }, response: unknown, next: () => void) => Promise<void>) | undefined;
    const ssrLoadModule = vi.fn().mockResolvedValue({
      createFilesystemCompositionStore,
      validateCompositionRecord,
    });
    await instance.configureServer?.({
      middlewares: { use(value: typeof middleware) { middleware = value; } },
      ssrLoadModule,
    } as never);
    expect(ssrLoadModule).toHaveBeenCalledWith("/src/composer/storage/file-provider/dev-server-entry.ts");
    if (!middleware) throw new Error("Vite middleware was not registered");

    const requestStream = Readable.from([
      Buffer.alloc(config.maxBodyBytes, 97),
      Buffer.from("overflow"),
      Buffer.from("repeat"),
    ]) as Readable & { url?: string; method?: string; headers: Record<string, string> };
    requestStream.url = COMPOSER_FILE_PROVIDER_ENDPOINT;
    requestStream.method = "POST";
    requestStream.headers = {};
    const response = {
      statusCode: 0,
      setHeader: vi.fn(),
      end: vi.fn(),
    };
    await middleware(requestStream, response, vi.fn());
    expect(response.statusCode).toBe(413);
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(response.end.mock.calls[0]![0]).toContain("body-too-large");
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
