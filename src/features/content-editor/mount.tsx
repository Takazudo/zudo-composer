// `mountContentEditor`: the supported browser mount of the restricted,
// content-only editor a host (for example Pinsel's private admin shell)
// renders for its client role.
//
// It renders the real Content route (`ContentApp`) in restricted mode inside
// a minimal shell. There is no router: the mount ignores the page URL and
// never writes it, so `/composer`, `/mapping`, `/sitemapper`, `/assets` or a
// schema view cannot be reached by navigation, and the view provider refuses
// every structural write. Entry edits travel only through the session's
// expected-revision save path to the host's `storage`.

import type { JSX } from "preact";
import { render } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { Banner, Button } from "../../components/ui";
import { ContentApp } from "../content/content-app";
import { createContentAuthoringController, type ContentAuthoringController, type ContentAuthoringState } from "../content/controller";
import { ContentRestrictionContext, type ContentRestriction } from "../content/restriction";
import { createHostPreviewBridge, type HostPreviewBridge, type HostPreviewState } from "../../hosted-content/preview-bridge";
import type { HostPreviewPackIdentity } from "../../hosted-content/preview-protocol";
import type { ContentEditorStorage } from "../../hosted-content/editor-service";
import type { ContentExportAdapter, ContentExportPackageIdentity, ContentExportStatus } from "../../hosted-content/export";
import type { HostContentPolicy } from "../../hosted-content/policy";
import type { ContentDraftState, ContentSnapshotRecord } from "../../hosted-content/storage";
import { createHostedAssetPicker, hostedAssetCatalogItems, hostedAssetSource, type ContentEditorAssetCatalog } from "./asset-picker";
import { createContentEditorSession, type ContentEditorSaveState, type ContentEditorSession } from "./session";
import { createHostedContentView, type HostedContentView } from "./view-provider";
import "./editor.css";

export interface ContentEditorLabels {
  readonly title: string;
  readonly loading: string;
  readonly loadFailed: string;
  readonly retry: string;
  readonly blocked: string;
  readonly clean: string;
  readonly unsaved: string;
  readonly saving: string;
  /** `{revision}` is replaced with the durable draft revision. */
  readonly saved: string;
  readonly recovering: string;
  readonly conflict: string;
  readonly failed: string;
  readonly preview: string;
  readonly previewPending: string;
  readonly previewRendered: string;
  readonly previewStale: string;
  readonly previewError: string;
  readonly previewUnavailable: string;
  readonly submit: string;
  readonly submitted: string;
  readonly refreshStatus: string;
  readonly assetPickerTitle: string;
  readonly assetChoose: string;
  readonly assetEmpty: string;
}

export const CONTENT_EDITOR_LABELS: ContentEditorLabels = Object.freeze({
  title: "Content",
  loading: "Loading content…",
  loadFailed: "Content could not be loaded.",
  retry: "Retry",
  blocked: "Editing is paused until a developer updates this site.",
  clean: "All changes saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved (revision {revision})",
  recovering: "Confirming the last save…",
  conflict: "Someone else saved first — choose how to continue",
  failed: "Not saved",
  preview: "Preview saved draft",
  previewPending: "Rendering preview…",
  previewRendered: "Preview shows this saved draft",
  previewStale: "Preview is out of date",
  previewError: "Preview failed",
  previewUnavailable: "No preview is configured.",
  submit: "Submit for publication",
  submitted: "Submitted",
  refreshStatus: "Refresh status",
  assetPickerTitle: "Choose an approved image",
  assetChoose: "Choose",
  assetEmpty: "No approved assets are available.",
});

/** Japanese host-facing labels; pass as `labels` or spread over your own overrides. */
export const CONTENT_EDITOR_LABELS_JA: ContentEditorLabels = Object.freeze({
  title: "コンテンツ",
  loading: "コンテンツを読み込んでいます…",
  loadFailed: "コンテンツを読み込めませんでした。",
  retry: "再試行",
  blocked: "サイトの更新が必要なため、編集を一時停止しています。",
  clean: "すべて保存済み",
  unsaved: "未保存の変更があります",
  saving: "保存しています…",
  saved: "保存しました（リビジョン {revision}）",
  recovering: "直前の保存を確認しています…",
  conflict: "他の方が先に保存しました。続け方を選んでください",
  failed: "保存されていません",
  preview: "保存済みの下書きをプレビュー",
  previewPending: "プレビューを作成しています…",
  previewRendered: "プレビューはこの保存済みの下書きです",
  previewStale: "プレビューが古くなっています",
  previewError: "プレビューに失敗しました",
  previewUnavailable: "プレビューは設定されていません。",
  submit: "公開を申請",
  submitted: "申請しました",
  refreshStatus: "状況を更新",
  assetPickerTitle: "承認済みの画像を選択",
  assetChoose: "選択",
  assetEmpty: "利用できる承認済みの画像がありません。",
});

export interface ContentEditorPreviewOptions {
  /** Trusted same-origin private preview document; editable content never chooses it. */
  readonly url: string;
  readonly origin: string;
  readonly pack: HostPreviewPackIdentity;
  /** The approved route rendered for the open draft. */
  readonly route: string;
  readonly title?: string;
}

export interface ContentEditorExportOptions {
  readonly adapter: ContentExportAdapter;
  readonly packageIdentity: ContentExportPackageIdentity;
}

export interface MountContentEditorOptions {
  /** The configured site; its id must equal `policy.projectId`. */
  readonly project: { readonly id: string; readonly label?: string };
  /** The baseline (e.g. Git commit) the host's definitions were built for; a draft on another baseline is blocked. */
  readonly revision?: string;
  /** Presentation copy of the host's trusted policy. The host service stays authoritative. */
  readonly policy: HostContentPolicy;
  readonly storage: ContentEditorStorage;
  readonly assets?: ContentEditorAssetCatalog;
  readonly preview?: ContentEditorPreviewOptions;
  readonly export?: ContentEditorExportOptions;
  readonly labels?: Partial<ContentEditorLabels>;
  readonly operationId?: () => string;
}

export type ContentEditorDisplayStatus = "loading" | "load-failed" | "blocked" | "clean" | "unsaved" | "saving" | "saved" | "recovering" | "conflict" | "failed";

export interface ContentEditorState {
  readonly status: ContentEditorDisplayStatus;
  readonly message: string;
  /** The last durable draft revision this editor proved, if any. */
  readonly revision: number | null;
  readonly save: ContentEditorSaveState;
  readonly preview: HostPreviewState;
  readonly exportStatus: ContentExportStatus | null;
}

export interface ContentEditorHandle {
  readonly state: ContentEditorState;
  subscribe(listener: (state: ContentEditorState) => void): () => void;
  /** Await every pending edit's durable save; rejects (and keeps the form) when one fails. */
  flush(): Promise<void>;
  /** Removes the presentation and its listeners. An in-flight save still resolves on the server. */
  dispose(): void;
}

/** The status the shell shows, combining the session's durable state with the form's local edits. */
export interface ContentEditorFormStatus {
  readonly saveStatus: "pristine" | "saved" | "dirty" | "saving" | "error";
  readonly conflictRecovery: { readonly message: string } | null;
  readonly message: string;
}

export function contentEditorDisplayStatus(save: ContentEditorSaveState, form: ContentEditorFormStatus | null): { status: ContentEditorDisplayStatus; message: string } {
  if (save.status === "loading" || save.status === "load-failed" || save.status === "blocked") return { status: save.status, message: save.status === "loading" ? "" : save.message };
  if (form?.conflictRecovery || save.status === "conflict") return { status: "conflict", message: form?.conflictRecovery?.message ?? (save.status === "conflict" ? save.message : "") };
  if (save.status === "recovering") return { status: "recovering", message: save.message };
  if (save.status === "failed") return { status: "failed", message: save.message };
  if (save.status === "saving" || form?.saveStatus === "saving") return { status: "saving", message: "" };
  if (form?.saveStatus === "dirty") return { status: "unsaved", message: "" };
  if (form?.saveStatus === "error") return { status: "failed", message: form.message };
  if (save.status === "saved") return { status: "saved", message: "" };
  return { status: "clean", message: "" };
}

/**
 * Submit is offered only for the exact snapshot the preview acknowledged, at
 * the adopted draft revision, with nothing unsaved or unresolved in between.
 */
export function canSubmitPreviewedSnapshot(input: { preview: HostPreviewState; snapshot: ContentSnapshotRecord | null; draft: ContentDraftState | null; status: ContentEditorDisplayStatus }): boolean {
  const { preview, snapshot, draft, status } = input;
  if (!snapshot || !draft || preview.status !== "rendered") return false;
  if (status !== "clean" && status !== "saved") return false;
  return preview.request.snapshotId === snapshot.snapshotId && preview.request.revision === snapshot.draftRevision && snapshot.draftRevision === draft.draftRevision && snapshot.baselineRevision === draft.baselineRevision;
}

interface EditorRootProps {
  options: MountContentEditorOptions;
  labels: ContentEditorLabels;
  session: ContentEditorSession;
  view: { current: HostedContentView | null };
  publish(state: ContentEditorState): void;
  controllerRef: { current: ContentAuthoringController | null };
}

function format(template: string, revision: number | null): string {
  return template.replace("{revision}", revision === null ? "–" : String(revision));
}

function EditorRoot({ options, labels, session, view, publish, controllerRef }: EditorRootProps): JSX.Element {
  const [save, setSave] = useState<ContentEditorSaveState>(session.state);
  const [form, setForm] = useState<ContentAuthoringState | null>(null);
  const [preview, setPreview] = useState<HostPreviewState>({ status: "idle" });
  const [snapshot, setSnapshot] = useState<ContentSnapshotRecord | null>(null);
  const [exportStatus, setExportStatus] = useState<ContentExportStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const bridgeRef = useRef<HostPreviewBridge | null>(null);

  useEffect(() => session.subscribe(setSave), [session]);
  useEffect(() => { void session.load(); }, [session]);

  const ready = save.status !== "loading" && save.status !== "load-failed" && save.status !== "blocked";
  const controller = useMemo(() => {
    if (!ready || !view.current) return null;
    const approved = options.policy.assets?.assetIds ?? [];
    const created = createContentAuthoringController(view.current.provider, {
      writeEntry: (record) => session.writeEntry(record),
      ...(options.assets ? { assetProvider: hostedAssetSource(options.assets, approved) } : {}),
    });
    controllerRef.current = created;
    return created;
  }, [ready, session]);
  useEffect(() => controller?.subscribe(setForm), [controller]);

  // "Use latest" after a conflict adopts the authoritative draft the session already reread.
  const hadConflict = useRef(false);
  useEffect(() => {
    if (form?.conflictRecovery) { hadConflict.current = true; return; }
    if (hadConflict.current && form) { hadConflict.current = false; session.acknowledgeConflict(); }
  }, [form?.conflictRecovery, session]);

  const display = contentEditorDisplayStatus(save, form);
  const revision = session.draft?.draftRevision ?? null;
  useEffect(() => {
    publish({ status: display.status, message: display.message, revision, save, preview, exportStatus });
  }, [display.status, display.message, revision, save, preview, exportStatus]);

  // The listener is installed as the iframe element is inserted, before its
  // document can load and announce `ready`.
  const attachFrame = useCallback((frame: HTMLIFrameElement | null) => {
    bridgeRef.current?.dispose();
    bridgeRef.current = null;
    if (!frame || !options.preview) return;
    bridgeRef.current = createHostPreviewBridge({ frame, origin: options.preview.origin, hostWindow: window, pack: options.preview.pack, onStateChange: setPreview });
  }, []);
  useEffect(() => () => { bridgeRef.current?.dispose(); bridgeRef.current = null; }, []);

  const assetItems = useMemo(() => options.assets ? hostedAssetCatalogItems(options.assets, options.policy.assets?.assetIds ?? []) : [], [options.assets]);
  const renderAssetPicker = useMemo(() => createHostedAssetPicker(assetItems, { title: labels.assetPickerTitle, choose: labels.assetChoose, empty: labels.assetEmpty }), [assetItems, labels]);
  const restriction = useMemo<ContentRestriction>(() => ({ models: options.policy.models }), [options.policy]);

  const act = (action: () => Promise<void>) => {
    setActionError(null);
    void action().catch((cause: unknown) => setActionError(cause instanceof Error ? cause.message : String(cause)));
  };
  const runPreview = () => act(async () => {
    if (!options.preview || !controller) return;
    await controller.flushSessions();
    const captured = await session.captureSnapshot();
    setSnapshot(captured);
    bridgeRef.current?.preview({ snapshotId: captured.snapshotId, revision: captured.draftRevision, route: options.preview.route });
  });
  const submittable = canSubmitPreviewedSnapshot({ preview, snapshot, draft: session.draft, status: display.status });
  const submit = () => act(async () => {
    if (!options.export || !snapshot || !submittable) return;
    const result = await options.export.adapter.submit({
      snapshotId: snapshot.snapshotId,
      projectRevision: snapshot.snapshotId,
      baselineRevision: snapshot.baselineRevision,
      packageIdentity: options.export.packageIdentity,
      idempotencyKey: `submit-${snapshot.snapshotId.slice(0, 48)}`,
    });
    if (result.status !== "ok") throw new Error(result.status === "conflict" ? "This snapshot was already submitted differently." : result.message);
    await refreshExport(result.value.operationId);
  });
  const refreshExport = async (operationId: string) => {
    const status = await options.export!.adapter.status(operationId);
    if (status.status !== "ok") throw new Error(status.status === "unavailable" ? status.message : "The submission is not known to the host.");
    setExportStatus(status.value);
  };

  const statusText = {
    loading: labels.loading, "load-failed": labels.loadFailed, blocked: labels.blocked, clean: labels.clean, unsaved: labels.unsaved,
    saving: labels.saving, saved: format(labels.saved, save.status === "saved" ? save.revision : revision), recovering: labels.recovering, conflict: labels.conflict, failed: labels.failed,
  }[display.status];
  const stale = preview.status !== "idle" && (preview.request.revision !== revision || display.status === "unsaved" || display.status === "saving");
  const previewText = !options.preview ? labels.previewUnavailable : stale ? labels.previewStale
    : preview.status === "pending" ? labels.previewPending : preview.status === "rendered" ? labels.previewRendered : preview.status === "error" ? `${labels.previewError}: ${preview.message}` : "";

  const inspector = (
    <section class="sg-hosted-content-editor__preview" aria-label={options.preview?.title ?? labels.preview}>
      {options.preview ? <>
        <div class="sg-hosted-content-editor__preview-bar">
          <Button size="sm" disabled={!controller || display.status === "conflict" || display.status === "recovering"} onClick={runPreview}>{labels.preview}</Button>
          <span class="sg-hosted-content-editor__preview-state" role="status" data-preview={stale ? "stale" : preview.status}>{previewText}</span>
        </div>
        <iframe ref={attachFrame} class="sg-hosted-content-editor__frame" src={options.preview.url} title={options.preview.title ?? labels.preview} />
      </> : <p class="sg-hosted-content-editor__note">{labels.previewUnavailable}</p>}
    </section>
  );

  return (
    <ContentRestrictionContext.Provider value={restriction}>
      <div class="sg-hosted-content-editor" data-status={display.status}>
        <header class="sg-hosted-content-editor__bar">
          <h1 class="sg-hosted-content-editor__title">{options.project.label ?? labels.title}</h1>
          <p class="sg-hosted-content-editor__status" role="status" aria-live="polite" data-save-status={display.status}>{statusText}{display.message && display.status !== "conflict" ? ` — ${display.message}` : ""}</p>
          {options.export ? <Button size="sm" variant="primary" disabled={!submittable} onClick={submit}>{labels.submit}</Button> : null}
          {exportStatus ? <span class="sg-hosted-content-editor__export" data-export-state={exportStatus.state}>{labels.submitted}: {exportStatus.state}<Button size="xs" variant="ghost" onClick={() => act(() => refreshExport(exportStatus.operationId))}>{labels.refreshStatus}</Button></span> : null}
        </header>
        {actionError ? <Banner tone="err">{actionError}</Banner> : null}
        {save.status === "loading" ? <p class="sg-hosted-content-editor__note" role="status">{labels.loading}</p> : null}
        {save.status === "load-failed" ? <Banner tone="err" action={<Button size="sm" onClick={() => void session.load()}>{labels.retry}</Button>}>{labels.loadFailed} {save.message}</Banner> : null}
        {save.status === "blocked" ? <Banner tone="warn">{labels.blocked}</Banner> : null}
        {controller && view.current ? (
          <ContentApp provider={view.current.provider} controller={controller} renderAssetPicker={options.assets ? renderAssetPicker : undefined} assetPickerCapabilities={{ upload: false }} inspector={inspector} />
        ) : null}
      </div>
    </ContentRestrictionContext.Provider>
  );
}

/** Mount the restricted content-only editor into `root`. */
export function mountContentEditor(root: Element, options: MountContentEditorOptions): ContentEditorHandle {
  if (options.project.id !== options.policy.projectId) throw new Error(`Editor project "${options.project.id}" does not match the policy project "${options.policy.projectId}".`);
  const labels: ContentEditorLabels = { ...CONTENT_EDITOR_LABELS, ...options.labels };
  const view: { current: HostedContentView | null } = { current: null };
  const listedModels = Object.keys(options.policy.models);
  const session = createContentEditorSession({
    storage: options.storage,
    projectId: options.policy.projectId,
    providerId: options.policy.providerId,
    ...(options.revision !== undefined ? { expectedBaselineRevision: options.revision } : {}),
    ...(options.operationId ? { operationId: options.operationId } : {}),
    onAuthoritative: (draft) => {
      if (view.current) view.current.replace(draft.snapshot);
      else view.current = createHostedContentView(draft.snapshot, listedModels, options.project.label ?? labels.title);
    },
  });
  const listeners = new Set<(state: ContentEditorState) => void>();
  let current: ContentEditorState = { status: "loading", message: "", revision: null, save: session.state, preview: { status: "idle" }, exportStatus: null };
  const controllerRef: { current: ContentAuthoringController | null } = { current: null };
  const publish = (next: ContentEditorState) => { current = next; for (const listener of [...listeners]) listener(next); };
  let disposed = false;
  render(<EditorRoot options={options} labels={labels} session={session} view={view} publish={publish} controllerRef={controllerRef} />, root);
  return {
    get state() { return current; },
    subscribe(listener) { listeners.add(listener); listener(current); return () => { listeners.delete(listener); }; },
    async flush() {
      if (!controllerRef.current) throw new Error("Content is not loaded.");
      await controllerRef.current.flushSessions();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      session.dispose();
      render(null, root);
    },
  };
}
