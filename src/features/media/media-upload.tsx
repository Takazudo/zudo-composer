import type { JSX, TargetedEvent } from "preact";
import { useCallback, useEffect, useReducer, useRef, useState } from "preact/hooks";
import type { MediaRecord } from "../../media";
import { normalizedClipboardFiles, normalizedFilesFromTransfer, uploadExtensionForMime } from "./upload-input";
import { initialMediaUploadState, MEDIA_UPLOAD_BUSY_REJECTION, reduceMediaUploadDrop, type MediaUploadSource, type MediaUploadStatus } from "./upload-reducer";

export const MEDIA_UPLOAD_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,application/pdf";
export { MEDIA_UPLOAD_BUSY_REJECTION } from "./upload-reducer";

export interface MediaUploadStore {
  upload(file: Blob & { name: string }): Promise<MediaRecord>;
}

export interface MediaUploadProps {
  store: MediaUploadStore;
  refresh(): void | Promise<void>;
  now?: () => number;
}

const statusLabel: Readonly<Record<MediaUploadStatus, string>> = {
  queued: "Queued",
  uploading: "Uploading",
  stored: "Stored",
  failed: "Failed",
};

function messageForError(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Upload failed.";
}

export function MediaUpload({ store, refresh, now = Date.now }: MediaUploadProps): JSX.Element {
  const [state, dispatch] = useReducer(reduceMediaUploadDrop, initialMediaUploadState);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const ingestGuard = useRef({ busy: false });

  useEffect(() => () => { alive.current = false; }, []);

  const ingestFiles = useCallback((incoming: readonly File[], source: MediaUploadSource): boolean => {
    if (incoming.length === 0) return false;
    if (ingestGuard.current.busy) {
      dispatch({ type: "reject", message: MEDIA_UPLOAD_BUSY_REJECTION });
      return false;
    }

    ingestGuard.current.busy = true;
    let fallbackTimestamp: number | undefined;
    const files = incoming.map((file, index) => {
      if (file.name) return file;
      fallbackTimestamp ??= now();
      return new File([file], `upload-${fallbackTimestamp}-${index + 1}.${uploadExtensionForMime(file.type)}`, {
        type: file.type || "application/octet-stream",
        lastModified: file.lastModified,
      });
    });
    dispatch({ type: "claim", source, files });

    void (async () => {
      try {
        for (const [index, file] of files.entries()) {
          if (alive.current) dispatch({ type: "uploading", index });
          try {
            const record = await store.upload(file);
            if (alive.current) dispatch({ type: "stored", index, fileName: record.document.fileName });
          } catch (reason) {
            if (alive.current) dispatch({ type: "failed", index, message: messageForError(reason) });
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

  const onInput = (event: TargetedEvent<HTMLInputElement, Event>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    ingestFiles(files, "picker");
  };
  const onDragOver = (event: JSX.TargetedDragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    setDragActive(true);
  };
  const onDragLeave = (event: JSX.TargetedDragEvent<HTMLElement>) => {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDragActive(false);
  };
  const onDrop = (event: JSX.TargetedDragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer) ingestFiles(normalizedFilesFromTransfer(event.dataTransfer), "drop");
  };
  const onPaste = (event: JSX.TargetedClipboardEvent<HTMLElement>) => {
    if (!event.clipboardData) return;
    const files = normalizedClipboardFiles(event.clipboardData, now);
    if (files.length > 0 && ingestFiles(files, "paste")) event.preventDefault();
  };

  return <section
    class={`sg-media-upload${dragActive ? " sg-media-upload--drag-active" : ""}`}
    aria-labelledby="sg-media-upload-title"
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    onPaste={onPaste}
  >
    <div class="sg-media-upload__intro">
      <div><h2 id="sg-media-upload-title">Upload media</h2><p>Drop or paste images and PDFs here, or choose files.</p></div>
      <input ref={inputRef} class="sg-media-upload__input" type="file" multiple accept={MEDIA_UPLOAD_ACCEPT} onChange={onInput} />
      <button type="button" disabled={state.busy} onClick={() => inputRef.current?.click()}>Choose files</button>
    </div>
    {state.rejection && <p class="sg-media-upload__rejection" role="status">{state.rejection}</p>}
    <div aria-live="polite">
      {state.items.length > 0 && <ul class="sg-media-upload__status" aria-label="Upload status">
        {state.items.map((item) => <li key={item.id}>
          <span title={item.fileName}>{item.fileName}</span>
          <strong>{statusLabel[item.status]}</strong>
          {item.storedFileName && item.storedFileName !== item.fileName && <span>Stored as {item.storedFileName}</span>}
          {item.error && <span>{item.error}</span>}
        </li>)}
      </ul>}
    </div>
  </section>;
}
