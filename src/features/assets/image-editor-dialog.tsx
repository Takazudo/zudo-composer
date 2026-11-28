import { batch, computed, For, getScope, Show, signal, type Child } from "@takazudo/zfb/zudo-react";
import { MAX_DECODED_PIXELS, MAX_ENCODED_BYTES, type EditableMime } from "@zudo-composer/image-editor";
import { ImageEditor } from "@zudo-composer/image-editor/ui";
import type { AssetRecord, AssetSummary } from "../../assets";
import { Dialog } from "../../components/overlay";
import { Button } from "../../components/ui";
import type { AssetDimensionStore } from "./assets-dimensions";

type SaveMode = "replace" | "copy";
type EditorPhase = "loading" | "ready" | "error";

const EDITABLE_MIME_TYPES = new Set<EditableMime>(["image/png", "image/jpeg", "image/webp"]);

export interface ImageEditorDialogProps {
  /** The immutable version and revision captured by the opening gesture. */
  record: AssetSummary;
  dimensions: AssetDimensionStore;
  /** Maps a canonical version URL to a realm-local URL when the provider needs it. */
  previewUrl?: (versionUrl: string) => string;
  canSaveCopy?: boolean;
  onSave(blob: Blob, mode: SaveMode): Promise<AssetRecord | void>;
  onSaved?(record: AssetRecord | void, mode: SaveMode): void;
  onClose(): void;
}

function editableMime(value: string): value is EditableMime {
  return EDITABLE_MIME_TYPES.has(value as EditableMime);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The image load was aborted.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

function sameOriginUrl(value: string): string {
  const base = typeof globalThis.location?.href === "string" ? globalThis.location.href : "http://localhost/";
  const resolved = new URL(value, base);
  const origin = globalThis.location?.origin;
  if (typeof origin !== "string" || origin === "null" || resolved.origin !== origin) throw new Error("Source image URL must be same-origin.");
  return resolved.href;
}

function safeContentLength(response: Response): number | undefined {
  const value = response.headers?.get("content-length");
  if (value === null || value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function responseBytes(response: Response, signal: AbortSignal): Promise<Uint8Array> {
  const contentLength = safeContentLength(response);
  if (contentLength !== undefined && contentLength > MAX_ENCODED_BYTES) {
    throw new Error("Source image exceeds the 25 MiB limit.");
  }
  throwIfAborted(signal);

  // A bounded reader keeps a misleading or absent Content-Length from making
  // us buffer an unbounded response before applying the source-size guard.
  const reader = response.body?.getReader();
  if (!reader) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > MAX_ENCODED_BYTES) throw new Error("Source image exceeds the 25 MiB limit.");
    return data;
  }

  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = () => { void reader.cancel(abortReason(signal)).catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const item = await reader.read();
      if (item.done) break;
      const chunk = Uint8Array.from(item.value);
      length += chunk.byteLength;
      if (length > MAX_ENCODED_BYTES) {
        cancel();
        throw new Error("Source image exceeds the 25 MiB limit.");
      }
      chunks.push(chunk);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

interface PixelSize {
  width: number;
  height: number;
}

function smallerSize({ width, height }: PixelSize, maximumPixels: number): PixelSize {
  const pixels = width * height;
  const scale = Math.min(0.999999, Math.sqrt(maximumPixels / pixels));
  const next = { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
  while (next.width * next.height > maximumPixels && (next.width > 1 || next.height > 1)) {
    if (next.width >= next.height && next.width > 1) next.width -= 1;
    else if (next.height > 1) next.height -= 1;
  }
  return next;
}

function pixelLimitMessage(size: PixelSize): string {
  const suggestion = smallerSize(size, MAX_DECODED_PIXELS - 1);
  return `This image is ${size.width} × ${size.height} and exceeds the 40 MP limit. Downscale to ${suggestion.width} × ${suggestion.height}?`;
}

function byteLimitMessage(size: PixelSize | undefined): string {
  if (!size || size.width * size.height < 2) return "Source image exceeds the 25 MiB limit. Downscale the image before opening it.";
  const suggestion = smallerSize(size, Math.max(1, Math.floor(size.width * size.height * 0.75)));
  return `Source image exceeds the 25 MiB limit. Downscale to ${suggestion.width} × ${suggestion.height}?`;
}

async function loadBitmap(url: string, mimeType: EditableMime, cachedSize: PixelSize | undefined, signal: AbortSignal): Promise<ImageBitmap> {
  if (cachedSize && cachedSize.width * cachedSize.height > MAX_DECODED_PIXELS) throw new Error(pixelLimitMessage(cachedSize));
  let response: Response;
  try {
    response = await fetch(sameOriginUrl(url), { cache: "no-store", credentials: "same-origin", signal });
  } catch (error) {
    throwIfAborted(signal);
    throw error instanceof Error ? error : new Error("Unable to fetch the source image.");
  }
  throwIfAborted(signal);
  if (!response.ok) throw new Error(`Unable to load the source image (HTTP ${response.status}).`);
  let bytes: Uint8Array;
  try {
    bytes = await responseBytes(response, signal);
  } catch (error) {
    if (error instanceof Error && error.message === "Source image exceeds the 25 MiB limit.") throw new Error(byteLimitMessage(cachedSize), { cause: error });
    throw error;
  }
  throwIfAborted(signal);

  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: mimeType });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unable to decode the source image.");
  }
  const size = { width: bitmap.width, height: bitmap.height };
  if (!Number.isSafeInteger(size.width) || !Number.isSafeInteger(size.height) || size.width < 1 || size.height < 1) {
    bitmap.close();
    throw new Error("The source image has invalid dimensions.");
  }
  if (size.width * size.height > MAX_DECODED_PIXELS) {
    bitmap.close();
    throw new Error(pixelLimitMessage(size));
  }
  return bitmap;
}

function EditorSurface({ source, mimeType, canSaveCopy, onSave, onCancel, onSavingChange, onUnmounted }: {
  source: ImageBitmap;
  mimeType: EditableMime;
  canSaveCopy: boolean;
  onSave(blob: Blob, mode: SaveMode): Promise<void>;
  onCancel(): void;
  onSavingChange(saving: boolean): void;
  onUnmounted(source: ImageBitmap): void;
}): Child {
  // Let the host know when this subtree has left the tree. disposeBitmap()
  // defers the actual close until the complete unmount stack has unwound, so
  // this stays safe whatever order the editor's own cleanups run in.
  getScope().onCleanup(() => onUnmounted(source));
  return <ImageEditor source={source} mimeType={mimeType} canSaveCopy={canSaveCopy} onSave={onSave} onCancel={onCancel} onSavingChange={onSavingChange} />;
}

/**
 * One editing visit for one captured record. The record is fixed for the
 * dialog's lifetime: the owner remounts it (keyed by id, revision and version)
 * for another record, which aborts this visit's load.
 */
export function ImageEditorDialog({ record, dimensions, previewUrl, canSaveCopy = false, onSave, onSaved, onClose }: ImageEditorDialogProps): Child {
  const scope = getScope();
  const mimeType = editableMime(record.mimeType) ? record.mimeType : null;
  const sourceUrl = mimeType ? previewUrl?.(record.url) ?? record.url : record.url;
  const phase = signal<EditorPhase>(mimeType ? "loading" : "error");
  const bitmap = signal<ImageBitmap | null>(null);
  let bitmapNow: ImageBitmap | null = null;
  const error = signal(mimeType ? "" : record.mimeType === "image/gif" ? "GIF editing is not supported" : "This file type cannot be edited.");
  const saving = signal(false);
  let savingNow = false;
  const closing = signal(false);
  let closeRequested = false;
  let closeNotified = false;
  let abort: AbortController | null = null;

  const disposedBitmaps = new WeakSet<ImageBitmap>();
  const disposeBitmap = (source: ImageBitmap, defer = true) => {
    if (disposedBitmaps.has(source)) return;
    disposedBitmaps.add(source);
    if (bitmapNow === source) bitmapNow = null;
    // Defer past the complete unmount stack. The package owns worker/client
    // cleanup, and the host must not close its source while that subtree is
    // still unwinding, regardless of parent/child cleanup ordering.
    if (defer) queueMicrotask(() => source.close());
    else source.close();
  };

  const close = (afterSave = false) => {
    if ((!afterSave && savingNow) || closeRequested) return;
    closeRequested = true;
    abort?.abort();
    batch(() => { closing.value = true; bitmap.value = null; });
  };

  const handleSavingChange = (value: boolean) => {
    savingNow = value;
    saving.value = value;
  };

  const handleSave = async (blob: Blob, mode: SaveMode): Promise<void> => {
    const saved = await onSave(blob, mode);
    if (scope.abortSignal.aborted) return;
    onSaved?.(saved, mode);
    close(true);
  };

  scope.onActivate(() => {
    const request = new AbortController();
    abort = request;
    if (!mimeType) return () => { request.abort(); };
    const cached = dimensions.get(record.versionId);
    if (cached && cached.width * cached.height > MAX_DECODED_PIXELS) {
      batch(() => { phase.value = "error"; error.value = pixelLimitMessage(cached); });
      return () => { request.abort(); };
    }
    let active = true;
    let ownedBitmap: ImageBitmap | null = null;
    void loadBitmap(sourceUrl, mimeType, cached, request.signal).then((next) => {
      if (!active || request.signal.aborted || closeRequested) {
        // This result was never handed to the editor subtree, so it can be
        // released synchronously instead of waiting for an unmount boundary.
        disposeBitmap(next, false);
        return;
      }
      ownedBitmap = next;
      bitmapNow = next;
      batch(() => { bitmap.value = next; phase.value = "ready"; });
    }).catch((reason) => {
      if (!active || request.signal.aborted || closeRequested) return;
      batch(() => { phase.value = "error"; error.value = reason instanceof Error ? reason.message : "Unable to load the source image."; });
    });
    return () => {
      active = false;
      request.abort();
      if (ownedBitmap) disposeBitmap(ownedBitmap);
      if (abort === request) abort = null;
    };
  });

  // The effect phase follows the commit that removed the editor subtree, so
  // EditorSurface's cleanup has scheduled bitmap disposal by this point.
  // Notify the owner only after the editor subtree is gone.
  scope.effect(() => {
    if (!closing.value || closeNotified) return;
    closeNotified = true;
    onClose();
  });

  const status = computed(() => (phase.value === "loading" ? "Loading image…" : phase.value === "ready" ? "Ready" : "Unable to edit this image."));
  const editorSource = computed(() => (phase.value === "ready" && bitmap.value && mimeType ? [bitmap.value] : []));
  const ids = new WeakMap<ImageBitmap, number>();
  let nextId = 0;
  const identity = (value: ImageBitmap) => { let id = ids.get(value); if (id === undefined) { id = ++nextId; ids.set(value, id); } return id; };
  return <Dialog
    open
    size="full"
    class="sg-assets-image-editor-dialog"
    title={`Edit image: ${record.fileName}`}
    dismissOnBackdrop={computed(() => !saving.value)}
    onClose={() => close()}
    closeLabel="Close image editor"
    footer={<Show when={computed(() => phase.value === "error")}>{() => <Button on:click={() => close()}>Close</Button>}</Show>}
  >
    <Show when={computed(() => phase.value === "loading")}>{() => <div class="sg-assets-image-editor-loading" role="status" aria-live="polite"><p>{status}</p></div>}</Show>
    <Show when={computed(() => phase.value === "error")}>{() => <div class="sg-assets-image-editor-error"><p role="alert">{computed(() => error.value || status.value)}</p></div>}</Show>
    <For each={editorSource} by={identity}>{(source) => <EditorSurface source={source.value} mimeType={mimeType!} canSaveCopy={canSaveCopy} onSave={handleSave} onCancel={() => close()} onSavingChange={handleSavingChange} onUnmounted={disposeBitmap} />}</For>
  </Dialog>;
}
