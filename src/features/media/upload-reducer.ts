export type MediaUploadSource = "picker" | "drop" | "paste";
export type MediaUploadStatus = "queued" | "uploading" | "stored" | "failed";
export const MEDIA_UPLOAD_BUSY_REJECTION = "Another upload batch is already in progress. Try again when it finishes.";

export interface MediaUploadItem {
  readonly id: string;
  readonly fileName: string;
  readonly status: MediaUploadStatus;
  readonly storedFileName?: string;
  readonly error?: string;
}

export interface MediaUploadState {
  readonly busy: boolean;
  readonly items: readonly MediaUploadItem[];
  readonly rejection: string | null;
}

export type MediaUploadEvent =
  | { type: "claim"; source: MediaUploadSource; batch: number; files: readonly File[] }
  | { type: "reject"; message: string }
  | { type: "uploading"; id: string }
  | { type: "stored"; id: string; fileName: string }
  | { type: "failed"; id: string; message: string }
  | { type: "dismiss"; id: string }
  | { type: "settled" };

export const initialMediaUploadState: MediaUploadState = { busy: false, items: [], rejection: null };

/**
 * Row identity.
 *
 * `batch` is a monotonic counter owned by the uploader, not the position of the
 * drop: a failed row outlives its batch, so `drop-0` reused by the next drop
 * would key two different files to the same list row and hand Preact the wrong
 * DOM node to reuse.
 */
export function mediaUploadItemId(source: MediaUploadSource, batch: number, index: number): string {
  return `${source}-${batch}-${index}`;
}

export function reduceMediaUploadDrop(state: MediaUploadState, event: MediaUploadEvent): MediaUploadState {
  if (event.type === "claim") {
    if (event.files.length === 0) return state;
    if (state.busy) return { ...state, rejection: MEDIA_UPLOAD_BUSY_REJECTION };
    return {
      busy: true,
      rejection: null,
      // Stored rows have arrived in the library below and stop being news; a
      // failed one is the only record of what went wrong, so it waits to be
      // dismissed rather than being cleared by the next drop.
      items: [
        ...state.items.filter((item) => item.status === "failed"),
        ...event.files.map((file, index): MediaUploadItem => ({
          id: mediaUploadItemId(event.source, event.batch, index),
          fileName: file.name,
          status: "queued",
        })),
      ],
    };
  }
  if (event.type === "reject") return { ...state, rejection: event.message };
  if (event.type === "settled") return { ...state, busy: false };
  if (event.type === "dismiss") {
    const items = state.items.filter((item) => item.id !== event.id);
    return items.length === state.items.length ? state : { ...state, items };
  }

  let matched = false;
  const items = state.items.map((item): MediaUploadItem => {
    if (item.id !== event.id) return item;
    matched = true;
    if (event.type === "uploading") return { ...item, status: "uploading", error: undefined };
    if (event.type === "stored") return { ...item, status: "stored", storedFileName: event.fileName, error: undefined };
    return { ...item, status: "failed", error: event.message };
  });
  return matched ? { ...state, items } : state;
}
