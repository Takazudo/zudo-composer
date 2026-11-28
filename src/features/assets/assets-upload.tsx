import { batch, computed, For, getScope, Show, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import type { WorkspaceServices } from "../../app/services";
import { ASSET_MAX_BYTE_LENGTH, ASSET_ACCEPT, ASSET_UPLOAD_HINT, type AssetRecord } from "../../assets";
import { UploadIcon, XMarkIcon } from "../../components/icons";
import { Button, Chip, type ChipTone } from "../../components/ui";
import { formatBytes } from "./assets-format";
import { normalizedClipboardFiles, normalizedFilesFromTransfer, uploadExtensionForMime } from "./upload-input";
import {
  initialAssetUploadState,
  ASSET_UPLOAD_BUSY_REJECTION,
  assetUploadItemId,
  reduceAssetUploadDrop,
  type AssetUploadEvent,
  type AssetUploadItem,
  type AssetUploadSource,
  type AssetUploadState,
  type AssetUploadStatus,
} from "./upload-reducer";

export const ASSET_UPLOAD_ACCEPT = ASSET_ACCEPT;
export { ASSET_UPLOAD_BUSY_REJECTION } from "./upload-reducer";

export interface AssetUploadStore {
  upload(file: Blob & { name: string }): Promise<AssetRecord>;
}

export interface AssetUploadOptions {
  store: AssetUploadStore;
  refresh(): void | Promise<void>;
  now?: () => number;
  /** The route's workspace; the queue registers as a save-barrier session on it. */
  workspace?: WorkspaceServices;
}

type DragEventOn = DragEvent & { currentTarget: HTMLElement };

/**
 * The uploader, split from its presentation so the page header's primary
 * `Upload` button and the drop strip drive the same queue and the same file
 * input. Only the strip is a drop target; the header button just opens the
 * picker.
 */
export interface AssetUploadController {
  readonly state: ReadonlySignal<AssetUploadState>;
  readonly dragActive: ReadonlySignal<boolean>;
  readonly inputRef: Ref<HTMLInputElement>;
  openPicker(): void;
  dismiss(id: string): void;
  retry(id: string): void;
  /** Tracked when read in a computed. */
  canRetry(id: string): boolean;
  onInput(event: Event & { currentTarget: HTMLInputElement }): void;
  onDragOver(event: DragEventOn): void;
  onDragLeave(event: DragEventOn): void;
  onDrop(event: DragEventOn): void;
  onPaste(event: ClipboardEvent & { currentTarget: HTMLElement }): void;
}

const STATUS_LABEL: Readonly<Record<AssetUploadStatus, string>> = {
  queued: "Queued",
  uploading: "Uploading",
  stored: "Stored",
  failed: "Failed",
};

const STATUS_TONE: Readonly<Record<AssetUploadStatus, ChipTone>> = {
  queued: "neutral",
  uploading: "accent",
  stored: "ok",
  failed: "err",
};

function messageForError(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Upload failed.";
}

/** Call once in a component's setup; the session and in-flight work end with that scope. */
export function createAssetUpload({ store, refresh, now = Date.now, workspace }: AssetUploadOptions): AssetUploadController {
  const scope = getScope();
  const integration = workspace?.integration;
  let pending: Promise<void> = Promise.resolve();
  let session: ReturnType<NonNullable<typeof integration>["sessions"]["register"]> | null = null;
  const state = signal<AssetUploadState>(initialAssetUploadState);
  const dispatch = (event: AssetUploadEvent) => { state.value = reduceAssetUploadDrop(state.value, event); };
  const dragActive = signal(false);
  const inputRef: Ref<HTMLInputElement> = { current: null };
  const alive = () => !scope.abortSignal.aborted;
  const ingestGuard = { busy: false };
  // Batch numbers must never repeat, so they come from a counter rather than
  // the reducer: a rejected claim leaves the reducer's state untouched, and the
  // two counters would drift apart the first time a drop landed on a busy queue.
  let batchNumber = 0;
  const retryFiles = new Map<string, File>();
  // `retryFiles` is a plain map; this revision makes `canRetry` reactive.
  const retryRevision = signal(0);
  const setRetry = (change: () => void) => { change(); retryRevision.value++; };
  scope.onActivate(() => {
    if (!integration) return;
    const registered = integration.sessions.register({ feature: "Asset upload", providerId: integration.assetProvider?.descriptor.id ?? "asset-unavailable", workspaceId: integration.workspace.id }, { flush: () => pending });
    session = registered;
    return () => { registered.detach(); session = null; };
  });

  const ingestFiles = (incoming: readonly File[], source: AssetUploadSource): boolean => {
    if (incoming.length === 0) return false;
    if (ingestGuard.busy) {
      dispatch({ type: "reject", message: ASSET_UPLOAD_BUSY_REJECTION });
      return false;
    }

    ingestGuard.busy = true;
    const claimed = (batchNumber += 1);
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
    session?.changed();

    pending = (async () => {
      const failures: string[] = [];
      try {
        for (const [index, file] of files.entries()) {
          const id = assetUploadItemId(source, claimed, index);
          if (alive()) dispatch({ type: "uploading", id });
          try {
            const record = await store.upload(file);
            setRetry(() => retryFiles.delete(id));
            if (alive()) dispatch({ type: "stored", id, fileName: record.document.fileName });
          } catch (reason) {
            // Uncertain commits require exact-state inspection, not duplicate uploads.
            if (!(reason && typeof reason === "object" && "code" in reason && (reason.code === "commit-uncertain" || reason.code === "committed-stale"))) setRetry(() => retryFiles.set(id, file));
            failures.push(messageForError(reason));
            if (alive()) dispatch({ type: "failed", id, message: messageForError(reason) });
          }
        }
        try {
          await refresh();
        } catch (reason) {
          failures.push(messageForError(reason));
          if (alive()) dispatch({ type: "reject", message: messageForError(reason) });
        }
        if (failures.length) throw new Error(failures.join("; "));
      } finally {
        ingestGuard.busy = false;
        if (alive()) dispatch({ type: "settled" });
      }
    })();
    void pending.catch(() => undefined); // The panel and shared save barrier both retain the failure.
    return true;
  };

  return {
    state,
    dragActive,
    inputRef,
    openPicker: () => inputRef.current?.click(),
    dismiss: (id) => { batch(() => { setRetry(() => retryFiles.delete(id)); dispatch({ type: "dismiss", id }); }); },
    retry: (id) => { const file = retryFiles.get(id); if (file && ingestFiles([file], "picker")) { batch(() => { setRetry(() => retryFiles.delete(id)); dispatch({ type: "dismiss", id }); }); } },
    canRetry: (id) => { void retryRevision.value; return retryFiles.has(id); },
    onInput: (event) => {
      const input = event.currentTarget;
      const files = Array.from(input.files ?? []);
      input.value = "";
      ingestFiles(files, "picker");
    },
    onDragOver: (event) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      dragActive.value = true;
    },
    onDragLeave: (event) => {
      if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Node)) return;
      dragActive.value = false;
    },
    onDrop: (event) => {
      event.preventDefault();
      dragActive.value = false;
      if (event.dataTransfer) ingestFiles(normalizedFilesFromTransfer(event.dataTransfer), "drop");
    },
    onPaste: (event) => {
      if (!event.clipboardData) return;
      const files = normalizedClipboardFiles(event.clipboardData, now);
      if (files.length > 0 && ingestFiles(files, "paste")) event.preventDefault();
    },
  };
}

export interface AssetUploadPanelProps {
  controller: AssetUploadController;
}

/**
 * The compact drop strip and the queue below it. One control-height row, not
 * the hero-sized box this route used to open with: uploading is one of the
 * things an author does here, not the point of the page.
 */
export function AssetUploadPanel({ controller }: AssetUploadPanelProps): Child {
  const { state } = controller;
  const busy = computed(() => state.value.busy);
  const rejection = computed(() => state.value.rejection);
  const items = computed(() => state.value.items);
  return (
    <section
      class={computed(() => `sg-assets-upload${controller.dragActive.value ? " sg-assets-upload--drag-active" : ""}`)}
      aria-label="Upload asset"
      on:dragover={controller.onDragOver}
      on:dragleave={controller.onDragLeave}
      on:drop={controller.onDrop}
      on:paste={controller.onPaste}
    >
      <input
        ref={controller.inputRef}
        class="sg-assets-upload__input"
        type="file"
        multiple
        accept={ASSET_UPLOAD_ACCEPT}
        on:change={controller.onInput}
      />
      <div class="sg-assets-drop">
        <UploadIcon size="sm" class="sg-assets-drop__icon" />
        <span class="sg-assets-drop__text">
          Drop files here, paste from the clipboard, or{" "}
          <Button size="xs" variant="ghost" class="sg-assets-drop__choose" disabled={busy} on:click={controller.openPicker}>
            Choose files
          </Button>
        </span>
        <span class="sg-assets-drop__hint">{`${ASSET_UPLOAD_HINT} · up to ${formatBytes(ASSET_MAX_BYTE_LENGTH)}`}</span>
      </div>
      <Show when={computed(() => Boolean(rejection.value))}>{() => <p class="sg-assets-upload__rejection" role="status">{rejection}</p>}</Show>
      <div aria-live="polite">
        <Show when={computed(() => items.value.length > 0)}>{() => (
          <ul class="sg-assets-uploads" aria-label="Upload status">
            <For each={items} by={(item) => item.id}>{(item) => <UploadRow item={item} busy={busy} controller={controller} />}</For>
          </ul>
        )}</Show>
      </div>
    </section>
  );
}

function UploadRow({ item, busy, controller }: { item: ReadonlySignal<AssetUploadItem>; busy: ReadonlySignal<boolean>; controller: AssetUploadController }): Child {
  const { id, fileName } = item.value;
  const failed = computed(() => item.value.status === "failed");
  const storedAs = computed(() => { const stored = item.value.storedFileName; return stored && stored !== fileName ? `Stored as ${stored}` : ""; });
  const error = computed(() => item.value.error ?? "");
  return (
    <li class="sg-assets-uploads__row">
      <span class="sg-assets-uploads__name" title={fileName}>{fileName}</span>
      <UploadStatusChip status={computed(() => item.value.status)} />
      <Show when={failed}>{() => (
        <>
          <Button size="xs" disabled={computed(() => busy.value || !controller.canRetry(id))} on:click={() => controller.retry(id)}>Retry upload</Button>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={`Dismiss ${fileName}`}
            on:click={() => controller.dismiss(id)}
          >
            <XMarkIcon size="sm" />
          </Button>
        </>
      )}</Show>
      <Show when={computed(() => Boolean(storedAs.value))}>{() => <span class="sg-assets-uploads__detail">{storedAs}</span>}</Show>
      <Show when={computed(() => Boolean(error.value))}>{() => <span class="sg-assets-uploads__detail">{error}</span>}</Show>
    </li>
  );
}

/** The status chip; its tone is a static prop, so it remounts per status. */
function UploadStatusChip({ status }: { status: ReadonlySignal<AssetUploadStatus> }): Child {
  return <For each={computed(() => [status.value])} by={(value) => value}>{(value) => <Chip tone={STATUS_TONE[value.value]} dot>{STATUS_LABEL[value.value]}</Chip>}</For>;
}
