import type { JSX, RefObject, TargetedEvent } from "preact";
import { useCallback, useEffect, useReducer, useRef, useState } from "preact/hooks";
import { MEDIA_MAX_BYTE_LENGTH, type MediaRecord } from "../../media";
import { UploadIcon, XMarkIcon } from "../../components/icons";
import { Button, Chip, type ChipTone } from "../../components/ui";
import { formatBytes } from "./media-format";
import { normalizedClipboardFiles, normalizedFilesFromTransfer, uploadExtensionForMime } from "./upload-input";
import {
  initialMediaUploadState,
  MEDIA_UPLOAD_BUSY_REJECTION,
  mediaUploadItemId,
  reduceMediaUploadDrop,
  type MediaUploadSource,
  type MediaUploadState,
  type MediaUploadStatus,
} from "./upload-reducer";

export const MEDIA_UPLOAD_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
export { MEDIA_UPLOAD_BUSY_REJECTION } from "./upload-reducer";

export interface MediaUploadStore {
  upload(file: Blob & { name: string }): Promise<MediaRecord>;
}

export interface UseMediaUploadOptions {
  store: MediaUploadStore;
  refresh(): void | Promise<void>;
  now?: () => number;
}

/**
 * The uploader, split from its presentation so the page header's primary
 * `Upload` button and the drop strip drive the same queue and the same file
 * input. Only the strip is a drop target; the header button just opens the
 * picker.
 */
export interface MediaUploadController {
  readonly state: MediaUploadState;
  readonly dragActive: boolean;
  readonly inputRef: RefObject<HTMLInputElement>;
  openPicker(): void;
  dismiss(id: string): void;
  onInput(event: TargetedEvent<HTMLInputElement, Event>): void;
  onDragOver(event: JSX.TargetedDragEvent<HTMLElement>): void;
  onDragLeave(event: JSX.TargetedDragEvent<HTMLElement>): void;
  onDrop(event: JSX.TargetedDragEvent<HTMLElement>): void;
  onPaste(event: JSX.TargetedClipboardEvent<HTMLElement>): void;
}

const STATUS_LABEL: Readonly<Record<MediaUploadStatus, string>> = {
  queued: "Queued",
  uploading: "Uploading",
  stored: "Stored",
  failed: "Failed",
};

const STATUS_TONE: Readonly<Record<MediaUploadStatus, ChipTone>> = {
  queued: "neutral",
  uploading: "accent",
  stored: "ok",
  failed: "err",
};

function messageForError(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Upload failed.";
}

export function useMediaUpload({ store, refresh, now = Date.now }: UseMediaUploadOptions): MediaUploadController {
  const [state, dispatch] = useReducer(reduceMediaUploadDrop, initialMediaUploadState);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const ingestGuard = useRef({ busy: false });
  // Batch numbers must never repeat, so they come from a ref rather than the
  // reducer: a rejected claim leaves the reducer's state untouched, and the two
  // counters would drift apart the first time a drop landed on a busy queue.
  const batch = useRef(0);

  useEffect(() => () => { alive.current = false; }, []);

  const ingestFiles = useCallback((incoming: readonly File[], source: MediaUploadSource): boolean => {
    if (incoming.length === 0) return false;
    if (ingestGuard.current.busy) {
      dispatch({ type: "reject", message: MEDIA_UPLOAD_BUSY_REJECTION });
      return false;
    }

    ingestGuard.current.busy = true;
    const claimed = (batch.current += 1);
    let fallbackTimestamp: number | undefined;
    const files = incoming.map((file, index) => {
      if (file.name) return file;
      fallbackTimestamp ??= now();
      return new File([file], `upload-${fallbackTimestamp}-${index + 1}.${uploadExtensionForMime(file.type)}`, {
        type: file.type || "application/octet-stream",
        lastModified: file.lastModified,
      });
    });
    dispatch({ type: "claim", source, batch: claimed, files });

    void (async () => {
      try {
        for (const [index, file] of files.entries()) {
          const id = mediaUploadItemId(source, claimed, index);
          if (alive.current) dispatch({ type: "uploading", id });
          try {
            const record = await store.upload(file);
            if (alive.current) dispatch({ type: "stored", id, fileName: record.document.fileName });
          } catch (reason) {
            if (alive.current) dispatch({ type: "failed", id, message: messageForError(reason) });
          }
        }
        try {
          await refresh();
        } catch (reason) {
          if (alive.current) dispatch({ type: "reject", message: messageForError(reason) });
        }
      } finally {
        ingestGuard.current.busy = false;
        if (alive.current) dispatch({ type: "settled" });
      }
    })();
    return true;
  }, [now, refresh, store]);

  return {
    state,
    dragActive,
    inputRef,
    openPicker: () => inputRef.current?.click(),
    dismiss: (id) => dispatch({ type: "dismiss", id }),
    onInput: (event) => {
      const input = event.currentTarget;
      const files = Array.from(input.files ?? []);
      input.value = "";
      ingestFiles(files, "picker");
    },
    onDragOver: (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setDragActive(true);
    },
    onDragLeave: (event) => {
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
      setDragActive(false);
    },
    onDrop: (event) => {
      event.preventDefault();
      setDragActive(false);
      if (event.dataTransfer) ingestFiles(normalizedFilesFromTransfer(event.dataTransfer), "drop");
    },
    onPaste: (event) => {
      if (!event.clipboardData) return;
      const files = normalizedClipboardFiles(event.clipboardData, now);
      if (files.length > 0 && ingestFiles(files, "paste")) event.preventDefault();
    },
  };
}

export interface MediaUploadPanelProps {
  controller: MediaUploadController;
}

/**
 * The compact drop strip and the queue below it. One control-height row, not
 * the hero-sized box this route used to open with: uploading is one of the
 * things an author does here, not the point of the page.
 */
export function MediaUploadPanel({ controller }: MediaUploadPanelProps): JSX.Element {
  const { state } = controller;
  return (
    <section
      class={`sg-media-upload${controller.dragActive ? " sg-media-upload--drag-active" : ""}`}
      aria-label="Upload media"
      onDragOver={controller.onDragOver}
      onDragLeave={controller.onDragLeave}
      onDrop={controller.onDrop}
      onPaste={controller.onPaste}
    >
      <input
        ref={controller.inputRef}
        class="sg-media-upload__input"
        type="file"
        multiple
        accept={MEDIA_UPLOAD_ACCEPT}
        onChange={controller.onInput}
      />
      <div class="sg-media-drop">
        <UploadIcon size="sm" class="sg-media-drop__icon" />
        <span class="sg-media-drop__text">
          Drop files here, paste from the clipboard, or{" "}
          <Button size="xs" variant="ghost" class="sg-media-drop__choose" disabled={state.busy} onClick={controller.openPicker}>
            Choose files
          </Button>
        </span>
        <span class="sg-media-drop__hint">{`PNG, JPEG, GIF, WebP, PDF · up to ${formatBytes(MEDIA_MAX_BYTE_LENGTH)}`}</span>
      </div>
      {state.rejection ? <p class="sg-media-upload__rejection" role="status">{state.rejection}</p> : null}
      <div aria-live="polite">
        {state.items.length > 0 ? (
          <ul class="sg-media-uploads" aria-label="Upload status">
            {state.items.map((item) => (
              <li key={item.id} class="sg-media-uploads__row">
                <span class="sg-media-uploads__name" title={item.fileName}>{item.fileName}</span>
                <Chip tone={STATUS_TONE[item.status]} dot>{STATUS_LABEL[item.status]}</Chip>
                {item.status === "failed" ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    iconOnly
                    aria-label={`Dismiss ${item.fileName}`}
                    onClick={() => controller.dismiss(item.id)}
                  >
                    <XMarkIcon size="sm" />
                  </Button>
                ) : null}
                {item.storedFileName && item.storedFileName !== item.fileName ? (
                  <span class="sg-media-uploads__detail">Stored as {item.storedFileName}</span>
                ) : null}
                {item.error ? <span class="sg-media-uploads__detail">{item.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
