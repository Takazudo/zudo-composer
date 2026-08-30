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
  | { type: "claim"; source: MediaUploadSource; files: readonly File[] }
  | { type: "reject"; message: string }
  | { type: "uploading"; index: number }
  | { type: "stored"; index: number; fileName: string }
  | { type: "failed"; index: number; message: string }
  | { type: "settled" };

export const initialMediaUploadState: MediaUploadState = { busy: false, items: [], rejection: null };

export function reduceMediaUploadDrop(state: MediaUploadState, event: MediaUploadEvent): MediaUploadState {
  if (event.type === "claim") {
    if (event.files.length === 0) return state;
    if (state.busy) return { ...state, rejection: MEDIA_UPLOAD_BUSY_REJECTION };
    return {
      busy: true,
      rejection: null,
      items: event.files.map((file, index) => ({ id: `${event.source}-${index}`, fileName: file.name, status: "queued" })),
    };
  }
  if (event.type === "reject") return { ...state, rejection: event.message };
  if (event.type === "settled") return { ...state, busy: false };
  if (event.index < 0 || event.index >= state.items.length) return state;
  const items = state.items.map((item, index): MediaUploadItem => {
    if (index !== event.index) return item;
    if (event.type === "uploading") return { ...item, status: "uploading", error: undefined };
    if (event.type === "stored") return { ...item, status: "stored", storedFileName: event.fileName, error: undefined };
    return { ...item, status: "failed", error: event.message };
  });
  return { ...state, items };
}
