import type { EditDoc, RgbaImage } from "../core/types";
import {
  ImageEditorError,
  guardWorkingSet,
  validateImage,
} from "../core/limits";
import { renderSteps } from "../core/pipeline";
import { toneSteps, neutralTone } from "../core/tone";
export interface Identity {
  sourceId: string;
  incarnation: number;
  generation: number;
  requestId: number;
}
export type Request = Identity &
  (
    | { kind: "register"; image: RgbaImage }
    | { kind: "release" }
    | { kind: "preview" | "full"; doc: EditDoc }
  );
export type Response = Identity &
  (
    | { kind: "registered" | "released" }
    | { kind: "result"; image: RgbaImage }
    | { kind: "error"; code: ImageEditorError["code"]; message: string }
  );
export interface WorkerState {
  source?: {
    sourceId: string;
    incarnation: number;
    image: RgbaImage;
    generation: number;
  };
  lastIncarnation: number;
  cache?: { key: string; image: RgbaImage };
  cacheHits: number;
}
export interface Emission {
  message: Response;
  transfer: Transferable[];
}
export const createWorkerState = (): WorkerState => ({
  lastIncarnation: 0,
  cacheHits: 0,
});
export function* handleMessageSteps(
  state: WorkerState,
  request: Request,
): Generator<void, Emission[]> {
  const identity: Identity = {
    sourceId: request.sourceId,
    incarnation: request.incarnation,
    generation: request.generation,
    requestId: request.requestId,
  };
  const emit = (message: Response): Emission[] => [
    {
      message,
      transfer:
        message.kind === "result"
          ? [message.image.data.buffer as ArrayBuffer]
          : [],
    },
  ];
  try {
    if (
      !request.sourceId ||
      ![request.incarnation, request.generation, request.requestId].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      )
    )
      throw new ImageEditorError("invalid-document");
    if (request.kind === "register") {
      if (request.incarnation <= state.lastIncarnation)
        throw new ImageEditorError("superseded");
      validateImage(request.image);
      guardWorkingSet(request.image.data.byteLength * 2);
      state.source = {
        sourceId: request.sourceId,
        incarnation: request.incarnation,
        generation: request.generation,
        image: request.image,
      };
      state.lastIncarnation = request.incarnation;
      state.cache = undefined;
      return emit({ ...identity, kind: "registered" });
    }
    const source = state.source;
    if (
      !source ||
      source.sourceId !== request.sourceId ||
      source.incarnation !== request.incarnation
    )
      throw new ImageEditorError("unknown-source");
    if (request.kind === "release") {
      state.source = undefined;
      state.cache = undefined;
      return emit({ ...identity, kind: "released" });
    }
    if (request.kind === "preview" && request.generation < source.generation)
      throw new ImageEditorError("superseded");
    source.generation = Math.max(source.generation, request.generation);
    let image: RgbaImage;
    if (request.kind === "full")
      image = yield* renderSteps(request.doc, source.image);
    else {
      const key = JSON.stringify([
        source.incarnation,
        request.doc.crop,
        request.doc.rotate,
        request.doc.flipH,
        request.doc.flipV,
        request.doc.resize,
      ]);
      if (state.cache?.key === key) state.cacheHits++;
      else {
        state.cache = undefined;
        state.cache = {
          key,
          image: yield* renderSteps(
            { ...request.doc, tone: neutralTone },
            source.image,
            { maxEdge: 1024 },
          ),
        };
      }
      image = yield* toneSteps(state.cache.image, request.doc.tone);
    }
    return emit({ ...identity, kind: "result", image });
  } catch (error) {
    const typed =
      error instanceof ImageEditorError
        ? error
        : new ImageEditorError("worker-failed", String(error));
    return emit({
      ...identity,
      kind: "error",
      code: typed.code,
      message: typed.message,
    });
  }
}

export function handleMessage(
  state: WorkerState,
  request: Request,
): Emission[] {
  const steps = handleMessageSteps(state, request);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}
