import { createFallbackWorker } from "./fallback";
import type { EditDoc, RgbaImage } from "../core/types";
import {
  ImageEditorError,
  guardWorkingSet,
  validateImage,
} from "../core/limits";
import type { Identity, Request, Response } from "./worker-core";
export interface WorkerLike {
  postMessage(message: Request, transfer: Transferable[]): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: MessageEvent<Response>) => void,
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: MessageEvent<Response>) => void,
  ): void;
  terminate(): void;
}
interface Job {
  request: Request;
  resolve: (value: Response) => void;
  reject: (error: ImageEditorError) => void;
  settled: boolean;
}
export interface SourceIdentity {
  sourceId: string;
  incarnation: number;
}
export function createImageEditorClient(
  options: { workerFactory?: () => WorkerLike } = {},
) {
  let worker: WorkerLike;
  if (options.workerFactory) worker = options.workerFactory();
  else {
    try {
      worker = new Worker(new URL("./worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      worker = createFallbackWorker();
    }
  }
  let disposed = false,
    incarnation = 0,
    generation = 0,
    requestId = 0,
    source: SourceIdentity | undefined,
    active: Job | undefined,
    resident: { width: number; height: number } | undefined;
  const queue: Job[] = [];
  const settle = (job: Job, error?: ImageEditorError, response?: Response) => {
    if (job.settled) return;
    job.settled = true;
    if (error) job.reject(error);
    else job.resolve(response!);
  };
  const pump = () => {
    if (active || disposed) return;
    active = queue.shift();
    if (!active) return;
    try {
      worker.postMessage(
        active.request,
        active.request.kind === "register"
          ? [active.request.image.data.buffer as ArrayBuffer]
          : [],
      );
    } catch (error) {
      fail(new ImageEditorError("worker-failed", String(error)));
    }
  };
  const cancelPreviews = () => {
    if (active?.request.kind === "preview")
      settle(active, new ImageEditorError("superseded"));
    for (let i = queue.length - 1; i >= 0; i--)
      if (queue[i].request.kind === "preview") {
        settle(queue[i], new ImageEditorError("superseded"));
        queue.splice(i, 1);
      }
  };
  const fail = (error: ImageEditorError) => {
    if (active) settle(active, error);
    active = undefined;
    for (const job of queue) settle(job, error);
    queue.length = 0;
    disposed = true;
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onError);
    worker.removeEventListener("messageerror", onError);
    worker.terminate();
  };
  const onError = () => fail(new ImageEditorError("worker-failed"));
  const onMessage = (event: MessageEvent<Response>) => {
    const response = event.data,
      job = active;
    if (!job) return;
    const r = job.request;
    if (response.requestId !== r.requestId) return;
    if (
      response.sourceId !== r.sourceId ||
      response.incarnation !== r.incarnation ||
      response.generation !== r.generation
    ) {
      fail(new ImageEditorError("worker-failed", "Mismatched worker identity"));
      return;
    }
    if (r.kind === "register" && response.kind === "registered")
      resident = { width: r.image.width, height: r.image.height };
    if (r.kind === "release" && response.kind === "released")
      resident = undefined;
    if (response.kind === "error")
      settle(job, new ImageEditorError(response.code, response.message));
    else if (
      (r.kind === "preview" || r.kind === "full") &&
      (r.incarnation !== source?.incarnation ||
        (r.kind === "preview" && r.generation !== generation))
    )
      settle(job, new ImageEditorError("superseded"));
    else if (
      (r.kind === "preview" || r.kind === "full") &&
      response.kind !== "result"
    )
      settle(job, new ImageEditorError("worker-failed"));
    else settle(job, undefined, response);
    active = undefined;
    pump();
  };
  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onError);
  worker.addEventListener("messageerror", onError);
  const submit = (request: Request) =>
    new Promise<Response>((resolve, reject) => {
      if (disposed) {
        reject(new ImageEditorError("disposed"));
        return;
      }
      queue.push({ request, resolve, reject, settled: false });
      pump();
    });
  const identity = (): Identity => {
    if (disposed) throw new ImageEditorError("disposed");
    if (!source) throw new ImageEditorError("unknown-source");
    return { ...source, generation, requestId: ++requestId };
  };
  const render = async (
    kind: "preview" | "full",
    doc: EditDoc,
  ): Promise<RgbaImage> => {
    if (kind === "preview") {
      generation++;
      cancelPreviews();
    }
    const response = await submit({
      ...identity(),
      kind,
      doc: structuredClone(doc),
    });
    if (response.kind !== "result") throw new ImageEditorError("worker-failed");
    return response.image;
  };
  return {
    async registerSource(
      image: RgbaImage,
      sourceId = "source",
    ): Promise<SourceIdentity> {
      if (disposed) throw new ImageEditorError("disposed");
      validateImage(image);
      const residentBytes = resident ? resident.width * resident.height * 4 : 0;
      let activeBytes = 0;
      if (active?.request.kind === "register")
        activeBytes =
          active.request.image.width * active.request.image.height * 4;
      if (
        resident &&
        active &&
        (active.request.kind === "preview" || active.request.kind === "full")
      ) {
        const output = active.request.doc.resize;
        const scale =
          active.request.kind === "preview"
            ? Math.min(1, 1024 / Math.max(output.width, output.height))
            : 1;
        activeBytes =
          residentBytes * 3 +
          Math.max(1, Math.round(output.width * scale)) *
            Math.max(1, Math.round(output.height * scale)) *
            12 +
          Math.max(resident.width, resident.height, output.width) * 256;
      }
      // A replacement snapshot can overlap the current render. Include its live
      // source/scratch/output budget instead of guarding the new image alone.
      guardWorkingSet(
        image.data.byteLength * 2,
        residentBytes,
        activeBytes,
        1024 * 1024 * 8,
      );
      cancelPreviews();
      if (active && active.request.kind !== "release")
        settle(active, new ImageEditorError("superseded"));
      // Drop queued source copies before accepting a replacement; only the active
      // request and the newest resident-source handoff may own source buffers.
      for (let i = queue.length - 1; i >= 0; i--) {
        settle(queue[i], new ImageEditorError("superseded"));
        queue.splice(i, 1);
      }
      const next = { sourceId, incarnation: ++incarnation };
      source = next;
      generation = 0;
      const response = await submit({
        ...identity(),
        kind: "register",
        image: { width: image.width, height: image.height, data: image.data.slice() },
      });
      if (response.kind !== "registered")
        throw new ImageEditorError("worker-failed");
      return next;
    },
    renderPreview: (doc: EditDoc) => render("preview", doc),
    renderFull: (doc: EditDoc) => render("full", doc),
    async releaseSource(): Promise<void> {
      const id = identity();
      source = undefined;
      cancelPreviews();
      await submit({ ...id, kind: "release" });
    },
    dispose() {
      if (!disposed) fail(new ImageEditorError("disposed"));
    },
  };
}
