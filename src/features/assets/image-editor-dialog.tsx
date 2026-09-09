import type { JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
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
}): JSX.Element {
  // Let the host know when this subtree has left the tree. disposeBitmap()
  // defers the actual close until the complete unmount stack has unwound, so
  // this remains safe even if Preact changes parent/child cleanup ordering.
  useLayoutEffect(() => () => onUnmounted(source), [onUnmounted, source]);
  return <ImageEditor source={source} mimeType={mimeType} canSaveCopy={canSaveCopy} onSave={onSave} onCancel={onCancel} onSavingChange={onSavingChange} />;
}

export function ImageEditorDialog({ record, dimensions, previewUrl, canSaveCopy = false, onSave, onSaved, onClose }: ImageEditorDialogProps): JSX.Element {
  const mimeType = editableMime(record.mimeType) ? record.mimeType : null;
  const sourceUrl = useMemo(() => mimeType ? previewUrl?.(record.url) ?? record.url : record.url, [mimeType, previewUrl, record.url]);
  const dimensionsRef = useRef(dimensions);
  dimensionsRef.current = dimensions;
  const [phase, setPhase] = useState<EditorPhase>(mimeType ? "loading" : "error");
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const [error, setError] = useState(mimeType ? "" : record.mimeType === "image/gif" ? "GIF editing is not supported yet" : "This file type cannot be edited.");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const closeRequested = useRef(false);
  const closeNotified = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const disposedBitmaps = useRef(new WeakSet<ImageBitmap>());
  const disposeBitmap = useCallback((source: ImageBitmap, defer = true) => {
    if (disposedBitmaps.current.has(source)) return;
    disposedBitmaps.current.add(source);
    if (bitmapRef.current === source) bitmapRef.current = null;
    // Defer past the complete unmount stack. The package owns worker/client
    // cleanup, and the host must not close its source while that subtree is
    // still unwinding, regardless of parent/child hook cleanup ordering.
    if (defer) queueMicrotask(() => source.close());
    else source.close();
  }, []);

  const close = useCallback((afterSave = false) => {
    if ((!afterSave && savingRef.current) || closeRequested.current) return;
    closeRequested.current = true;
    abortRef.current?.abort();
    setClosing(true);
    setBitmap(null);
  }, []);

  const handleSavingChange = useCallback((value: boolean) => {
    savingRef.current = value;
    setSaving(value);
  }, []);

  const handleSave = useCallback(async (blob: Blob, mode: SaveMode): Promise<void> => {
    const saved = await onSave(blob, mode);
    onSaved?.(saved, mode);
    close(true);
  }, [close, onSave, onSaved]);

  const handleBitmapUnmounted = useCallback((source: ImageBitmap) => {
    disposeBitmap(source);
  }, [disposeBitmap]);

  useEffect(() => {
    const request = ++generation.current;
    const abort = new AbortController();
    abortRef.current = abort;
    closeRequested.current = false;
    closeNotified.current = false;
    setClosing(false);
    setBitmap(null);
    setPhase(mimeType ? "loading" : "error");
    setError(mimeType ? "" : record.mimeType === "image/gif" ? "GIF editing is not supported yet" : "This file type cannot be edited.");
    setSaving(false);
    savingRef.current = false;
    if (!mimeType) return () => { abort.abort(); };
    const cached = dimensionsRef.current.get(record.versionId);
    if (cached && cached.width * cached.height > MAX_DECODED_PIXELS) {
      setPhase("error");
      setError(pixelLimitMessage(cached));
      return () => { abort.abort(); };
    }
    let active = true;
    let ownedBitmap: ImageBitmap | null = null;
    void loadBitmap(sourceUrl, mimeType, cached, abort.signal).then((next) => {
      if (!active || abort.signal.aborted || request !== generation.current || closeRequested.current) {
        // This result was never handed to the editor subtree, so it can be
        // released synchronously instead of waiting for an unmount boundary.
        disposeBitmap(next, false);
        return;
      }
      ownedBitmap = next;
      bitmapRef.current = next;
      setBitmap(next);
      setPhase("ready");
    }).catch((reason) => {
      if (!active || abort.signal.aborted || request !== generation.current || closeRequested.current) return;
      setPhase("error");
      setError(reason instanceof Error ? reason.message : "Unable to load the source image.");
    });
    return () => {
      active = false;
      abort.abort();
      if (ownedBitmap) disposeBitmap(ownedBitmap);
      if (abortRef.current === abort) abortRef.current = null;
    };
  }, [disposeBitmap, mimeType, record.id, record.mimeType, record.revision, record.versionId, sourceUrl]);

  useLayoutEffect(() => {
    if (!closing || closeNotified.current) return;
    // EditorSurface's layout cleanup has scheduled bitmap disposal by this
    // point. Notify the owner only after the editor subtree is gone.
    closeNotified.current = true;
    onClose();
  }, [closing, onClose]);

  const unsupported = !mimeType;
  const status = phase === "loading" ? "Loading image…" : phase === "ready" ? "Ready" : "Unable to edit this image.";
  return <Dialog
    open
    size="full"
    class="sg-assets-image-editor-dialog"
    title={`Edit image: ${record.fileName}`}
    dismissOnBackdrop={!saving}
    onClose={() => close()}
    closeLabel="Close image editor"
    footer={unsupported || phase === "error" ? <Button onClick={() => close()}>Close</Button> : undefined}
  >
    {phase === "loading" ? <div class="sg-assets-image-editor-loading" role="status" aria-live="polite"><p>{status}</p></div> : null}
    {phase === "error" ? <div class="sg-assets-image-editor-error"><p role="alert">{error || status}</p></div> : null}
    {phase === "ready" && bitmap && mimeType ? <EditorSurface source={bitmap} mimeType={mimeType} canSaveCopy={canSaveCopy} onSave={handleSave} onCancel={() => close()} onSavingChange={handleSavingChange} onUnmounted={handleBitmapUnmounted} /> : null}
  </Dialog>;
}
