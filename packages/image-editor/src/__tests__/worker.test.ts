import { expect, it } from "vitest";
import { createEditDoc } from "../index";
import { createImageEditorClient } from "../worker/client";
import type { WorkerLike } from "../worker/client";
import { createWorkerState, handleMessage } from "../worker/worker-core";
import type { Request, Response } from "../worker/worker-core";
const image = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray(16).fill(255),
  },
  doc = createEditDoc(image);
const identity = { sourceId: "a", incarnation: 1, generation: 1, requestId: 1 };
it("guards incarnations, stale generations and cache ownership", () => {
  const state = createWorkerState();
  const send = (request: Request) => handleMessage(state, request)[0].message;
  expect(send({ ...identity, kind: "full", doc })).toMatchObject({
    kind: "error",
    code: "unknown-source",
  });
  send({ ...identity, kind: "register", image });
  send({ ...identity, kind: "preview", doc });
  const cache = state.cache;
  send({
    ...identity,
    kind: "preview",
    doc: { ...doc, tone: { ...doc.tone, brightness: 10 } },
  });
  expect(state.cache).toBe(cache);
  expect(state.cacheHits).toBe(1);
  send({ ...identity, kind: "full", doc });
  expect(state.cache).toBe(cache);
  send({
    ...identity,
    kind: "preview",
    doc: { ...doc, flipH: true },
    generation: 2,
  });
  expect(state.cache).not.toBe(cache);
  expect(send({ ...identity, kind: "preview", doc })).toMatchObject({
    code: "superseded",
  });
  send({ ...identity, kind: "register", image, incarnation: 2 });
  expect(state.cache).toBeUndefined();
  expect(send({ ...identity, kind: "release" })).toMatchObject({
    code: "unknown-source",
  });
  expect(state.source?.incarnation).toBe(2);
  expect(send({ ...identity, kind: "register", image })).toMatchObject({
    code: "superseded",
  });
  send({ ...identity, incarnation: 2, kind: "release" });
  expect(state.source).toBeUndefined();
});
class FakeWorker implements WorkerLike {
  requests: Request[] = [];
  terminated = false;
  listeners = new Map<string, Set<(e: MessageEvent<Response>) => void>>();
  state = createWorkerState();
  postMessage(request: Request) {
    this.requests.push(request);
  }
  addEventListener(
    type: string,
    listener: (e: MessageEvent<Response>) => void,
  ) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }
  removeEventListener(
    type: string,
    listener: (e: MessageEvent<Response>) => void,
  ) {
    this.listeners.get(type)?.delete(listener);
  }
  terminate() {
    this.terminated = true;
  }
  finish() {
    const request = this.requests.shift()!;
    const response = handleMessage(this.state, request)[0].message;
    for (const listener of this.listeners.get("message") ?? [])
      listener({ data: response } as MessageEvent<Response>);
  }
  error() {
    for (const listener of this.listeners.get("error") ?? [])
      listener({} as MessageEvent<Response>);
  }
}
it("keeps one active and one trailing preview, promptly supersedes and protects saves", async () => {
  const worker = new FakeWorker(),
    client = createImageEditorClient({ workerFactory: () => worker });
  const registration = client.registerSource(image);
  worker.finish();
  await registration;
  const first = client.renderPreview(doc).catch((e) => e.code),
    second = client.renderPreview(doc).catch((e) => e.code),
    third = client.renderPreview(doc);
  expect(await first).toBe("superseded");
  expect(await second).toBe("superseded");
  expect(worker.requests).toHaveLength(1);
  const save = client.renderFull(doc);
  worker.finish();
  expect(worker.requests[0].kind).toBe("preview");
  worker.finish();
  await third;
  expect(worker.requests[0].kind).toBe("full");
  const later = client.renderPreview(doc);
  worker.finish();
  expect(await save).toEqual(image);
  worker.finish();
  await later;
  client.dispose();
  expect(worker.terminated).toBe(true);
  expect([...worker.listeners.values()].every((set) => set.size === 0)).toBe(
    true,
  );
});
it("settles every queued promise on failure and disposal", async () => {
  for (const failure of [true, false]) {
    const worker = new FakeWorker(),
      client = createImageEditorClient({ workerFactory: () => worker });
    const registration = client.registerSource(image).catch((e) => e.code),
      preview = client.renderPreview(doc).catch((e) => e.code),
      save = client.renderFull(doc).catch((e) => e.code);
    if (failure) worker.error();
    else client.dispose();
    expect(await Promise.all([registration, preview, save])).toEqual(
      Array(3).fill(failure ? "worker-failed" : "disposed"),
    );
    await expect(client.renderFull(doc)).rejects.toMatchObject({
      code: "disposed",
    });
  }
});
it("fallback runs the identical protocol and settles disposal between chunks", async () => {
  const client = createImageEditorClient();
  await client.registerSource(image);
  expect(await client.renderFull(doc)).toEqual(image);
  const full = client.renderFull({
    ...doc,
    resize: { width: 500, height: 500 },
  });
  client.dispose();
  await expect(full).rejects.toMatchObject({ code: "disposed" });
});

it("drops stale preview deliveries during source replacement and bounds pending registrations", async () => {
  const worker = new FakeWorker(),
    client = createImageEditorClient({ workerFactory: () => worker });
  const initial = client.registerSource(image);
  worker.finish();
  await initial;
  const preview = client.renderPreview(doc).catch((error) => error.code);
  const oldRegistration = client
    .registerSource(image, "old")
    .catch((error) => error.code);
  const replacement = client.registerSource(image, "new");
  expect(await preview).toBe("superseded");
  expect(await oldRegistration).toBe("superseded");
  worker.finish();
  expect(worker.requests).toHaveLength(1);
  expect(worker.requests[0].sourceId).toBe("new");
  worker.finish();
  expect(await replacement).toMatchObject({ sourceId: "new" });
  const release = client.releaseSource();
  worker.finish();
  await release;
  await expect(client.renderPreview(doc)).rejects.toMatchObject({
    code: "unknown-source",
  });
  client.dispose();
});
it("rejects mismatched identity and postMessage failure without stranding promises", async () => {
  const worker = new FakeWorker(),
    client = createImageEditorClient({ workerFactory: () => worker });
  const registration = client
    .registerSource(image)
    .catch((error) => error.code);
  const request = worker.requests[0];
  for (const listener of worker.listeners.get("message") ?? [])
    listener({
      data: { ...request, kind: "registered", incarnation: 999 },
    } as MessageEvent<Response>);
  expect(await registration).toBe("worker-failed");
  expect(worker.terminated).toBe(true);
  const broken = new FakeWorker();
  broken.postMessage = () => {
    throw new Error("transfer failed");
  };
  const brokenClient = createImageEditorClient({ workerFactory: () => broken });
  await expect(brokenClient.registerSource(image)).rejects.toMatchObject({
    code: "worker-failed",
  });
  expect(broken.terminated).toBe(true);
});

it("does not deliver an old-source save after source replacement", async () => {
  const worker = new FakeWorker(),
    client = createImageEditorClient({ workerFactory: () => worker });
  const initial = client.registerSource(image);
  worker.finish();
  await initial;
  const oldSave = client.renderFull(doc).catch((error) => error.code);
  const replacement = client.registerSource(image, "replacement");
  expect(await oldSave).toBe("superseded");
  worker.finish();
  worker.finish();
  await replacement;
  client.dispose();
});

it("registers native ImageData-shaped prototype accessors without dropping dimensions or mutating input", async () => {
  class NativeImageDataShape {
    get width() { return 2; }
    get height() { return 2; }
    get data() { return pixels; }
  }
  const pixels = new Uint8ClampedArray(16).fill(127);
  const native = new NativeImageDataShape();
  expect(Object.keys(native)).toEqual([]);
  const worker = new FakeWorker();
  const client = createImageEditorClient({ workerFactory: () => worker });
  const registration = client.registerSource(native);
  const request = worker.requests[0];
  expect(request.kind).toBe("register");
  if (request.kind !== "register") throw new Error("Expected registration");
  expect(request.image).toEqual({ width: 2, height: 2, data: pixels });
  expect(request.image.data).not.toBe(pixels);
  worker.finish();
  await registration;
  const preview = client.renderPreview(createEditDoc(native));
  worker.finish();
  expect(await preview).toEqual({ width: 2, height: 2, data: pixels });
  expect(native.data).toBe(pixels);
  expect([...pixels]).toEqual(Array(16).fill(127));
  expect(Object.keys(native)).toEqual([]);
  client.dispose();
});
