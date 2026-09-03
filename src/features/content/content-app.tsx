import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useBreadcrumb, type EditorStatus } from "../../app/chrome-context";
import { formatIntent, parseIntent } from "../../app/route-intents";
import { EditorBody, EditorChrome, RecordTitle, readEditorCollapsed, writeEditorCollapsed } from "../../components/editor-chrome";
import { CheckIcon, CopyIcon, DuplicateIcon, EllipsisIcon, EyeIcon, FileIcon, SettingsIcon, TrashIcon } from "../../components/icons";
import { useLibraryConfirm } from "../../components/library-page";
import { ConfirmDialog, Menu, MenuItem, MenuSeparator, useMenu } from "../../components/overlay";
import { Banner, Button, Chip, EmptyState, Pane, PaneBody, PaneHeader, SegmentedControl } from "../../components/ui";
import type { ContentProvider } from "../../content";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { ContentAddModelDialog } from "./add-model-dialog";
import { ContentEntryAuthor, ContentSchemaAuthor } from "./content-author";
import { ContentNavigator } from "./content-library";
import { ContentPreviewPane } from "./content-preview-pane";
import { createContentAuthoringController, type ContentAuthoringController, type ContentAuthoringState, type ContentSaveStatus, type ContentWorkMode } from "./controller";
import { contentEntryLabel, contentEntryTitleField } from "./presentation";
import type { ContentPreviewSource } from "./preview-source";

export interface ContentRouteContentProps {
  provider: ContentProvider;
  controller?: ContentAuthoringController;
  componentProvider?: ComposerComponentProvider;
  createPreviewSource?: () => ContentPreviewSource;
}

/** Names the persisted rail geometry: one Content editor, not one per record. */
const CONTENT_EDITOR_KEY = "content";
const CONTENT_ROUTE = "/content";

const MODE_OPTIONS = [
  { value: "entries" as const, label: "Entry", icon: FileIcon },
  { value: "model-fields" as const, label: "Schema", icon: SettingsIcon },
];

/** The save queue's vocabulary, translated into the chrome's four states. */
function statusOf(status: ContentSaveStatus, detail: string, onRetry: () => void): EditorStatus {
  switch (status) {
    case "saved": return { state: "saved" };
    case "saving": return { state: "saving" };
    case "error": return { state: "failed", detail, onRetry };
    case "dirty": return { state: "unsaved" };
  }
}

function contentHref(modelId: string, entryId?: string): string {
  return formatIntent(entryId === undefined ? { route: "content", modelId } : { route: "content", modelId, entryId });
}

/**
 * The Content route on the shared editor chrome.
 *
 * The navigator IS the library — there is no separate listing page — so the
 * whole route is one editor: models and their Entries on the left, the author
 * in the middle, and what the draft renders as on the right. Save state is
 * published through `useEditorStatus` rather than drawn here, because autosave
 * remains authoritative and the app chrome owns where its state is shown.
 */
export function ContentApp({ provider, controller: supplied, componentProvider, createPreviewSource }: ContentRouteContentProps): JSX.Element {
  const controller = useMemo(() => supplied ?? createContentAuthoringController(provider), [provider, supplied]);
  const [state, setState] = useState<ContentAuthoringState>(controller.state);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => readEditorCollapsed(CONTENT_EDITOR_KEY).insp);
  const confirm = useLibraryConfirm();
  const overflowRef = useRef<HTMLButtonElement | null>(null);
  const overflow = useMenu(overflowRef, { align: "end" });

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => { if (controller.state.phase === "idle") void controller.initialize(); }, [controller]);

  const run = (action: () => void | Promise<void>) => {
    const fail = (reason: unknown) => setError(reason instanceof Error ? reason.message : "Content action failed.");
    setError(null);
    setNotice(null);
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };

  // `/content?model=&entry=` opens what it names, once, and only after the
  // library is loaded — `openModel` reads through the store the initialization
  // just prepared. A malformed link is reported rather than silently opening
  // the bare route.
  const appliedIntent = useRef(false);
  useEffect(() => {
    if (appliedIntent.current || state.phase !== "ready") return;
    appliedIntent.current = true;
    const outcome = parseIntent();
    if (outcome.status === "invalid") { setError(outcome.message); return; }
    if (outcome.status !== "matched" || outcome.intent.route !== "content") return;
    const intent = outcome.intent;
    run(async () => {
      await controller.openModel(intent.modelId);
      if (intent.entryId !== undefined) await controller.openEntry(intent.entryId);
    });
  }, [controller, state.phase]);

  // The address bar follows the selection, so a copied URL opens what the
  // author is looking at. `replaceState` keeps it out of the history stack —
  // choosing a record is not a navigation.
  useEffect(() => {
    if (!appliedIntent.current || state.phase !== "ready") return;
    if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") return;
    window.history.replaceState(null, "", state.model ? contentHref(state.model.id, state.entry?.id) : CONTENT_ROUTE);
  }, [state.phase, state.model?.id, state.entry?.id]);

  const fields = state.model?.document.fields ?? [];
  const entryName = state.entry ? contentEntryLabel(state.entry, fields) : "";
  const titleField = contentEntryTitleField(fields);
  const schemaMode = state.workMode === "model-fields";

  useBreadcrumb([
    { label: "Content", href: CONTENT_ROUTE },
    ...(state.model ? [state.entry ? { label: state.model.document.name, href: contentHref(state.model.id) } : { label: state.model.document.name }] : []),
    ...(state.entry ? [{ label: entryName }] : []),
  ]);

  function collapseInspector(collapsed: boolean): void {
    setInspectorCollapsed(collapsed);
    writeEditorCollapsed(CONTENT_EDITOR_KEY, "insp", collapsed);
  }

  function copyEntryId(id: string): void {
    setError(null);
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) { setNotice(`Entry ID: ${id}`); return; }
    void clipboard.writeText(id).then(
      () => setNotice("Entry ID copied."),
      () => setNotice(`Entry ID: ${id}`),
    );
  }

  function confirmDeleteModel(id: string, label: string): void {
    confirm.request({
      title: "Delete model?",
      message: `${label} and every Entry it holds are permanently removed. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: () => run(() => controller.deleteModel(id)),
    });
  }

  function confirmDeleteEntry(id: string, label: string): void {
    confirm.request({
      title: "Delete entry?",
      message: `${label} is permanently removed. This cannot be undone.`,
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: () => run(() => controller.deleteEntry(id)),
    });
  }

  function confirmStartFresh(): void {
    confirm.request({
      title: "Start fresh?",
      message: "All quarantined Content data is permanently removed. Your source records stay quarantined and are not overwritten.",
      confirmLabel: "Start fresh",
      tone: "danger",
      onConfirm: () => run(() => controller.startFresh()),
    });
  }

  if (state.phase !== "ready") {
    return (
      <main class="sg-content-app sg-content-app--state" aria-busy={state.phase === "loading"}>
        {state.phase === "error" ? (
          <EmptyState
            title="Content library unavailable"
            description={state.message}
            action={<Button variant="primary" onClick={() => run(() => controller.retryInitialization())}>Retry</Button>}
          />
        ) : null}
        {state.phase === "recovery" ? (
          <EmptyState
            title="Stored Content needs recovery"
            description={<>{state.recoveryMessage} Your source records are quarantined and will not be overwritten.</>}
            action={
              <>
                <Button onClick={() => run(() => controller.retryInitialization())}>Retry</Button>
                <Button variant="danger" onClick={confirmStartFresh}>Start fresh…</Button>
              </>
            }
          />
        ) : null}
        {state.phase === "idle" || state.phase === "loading" ? <p class="sg-content-loading" role="status">Loading Content library…</p> : null}
        <ConfirmDialog {...confirm.dialogProps} />
      </main>
    );
  }

  return (
    <EditorChrome
      editorKey={CONTENT_EDITOR_KEY}
      class="sg-content-app"
      back={{ href: CONTENT_ROUTE, label: "Back to Content" }}
      title={
        <RecordTitle
          value={schemaMode ? (state.model?.document.name ?? "") : entryName}
          label={schemaMode ? "Model name" : "Entry title"}
          placeholder={schemaMode ? "Model name" : "Untitled Entry"}
          disabled={schemaMode ? state.model === null : state.entry === null || titleField === null}
          onCommit={(next) => run(() => {
            if (schemaMode) controller.renameModel(next);
            else if (titleField) controller.updateEntryValue(titleField.id, next);
          })}
        />
      }
      status={statusOf(state.saveStatus, state.message, () => controller.retrySave())}
      dirty={state.saveStatus !== "saved"}
      paneLabels={{ nav: "Content", main: "Editor", insp: "Preview" }}
      center={
        <SegmentedControl<ContentWorkMode>
          label="Editor mode"
          size="sm"
          value={state.workMode}
          options={MODE_OPTIONS}
          onChange={(mode) => run(() => (mode === "model-fields" ? controller.inspectSchema() : controller.browseEntries()))}
        />
      }
      right={
        <>
          <Button
            aria-pressed={!inspectorCollapsed}
            title={inspectorCollapsed ? "Preview panel is closed" : "Preview panel is open"}
            onClick={() => collapseInspector(!inspectorCollapsed)}
          >
            <EyeIcon size="sm" />
            Preview
          </Button>
          <Button
            variant="primary"
            disabled={state.saveStatus === "saved"}
            // Autosave stays authoritative; Save is the explicit flush for an
            // author who wants the pending write to land now.
            title={state.saveStatus === "saved" ? "All changes saved" : "Save now"}
            onClick={() => run(() => controller.flushSessions())}
          >
            <CheckIcon size="sm" />
            Save
          </Button>
          <Button variant="ghost" iconOnly elementRef={overflowRef} aria-label="More Content actions" {...overflow.triggerProps}>
            <EllipsisIcon size="sm" />
          </Button>
          <Menu controller={overflow} label="Content actions">
            <MenuItem
              icon={DuplicateIcon}
              disabled={state.entry === null || state.model?.document.kind === "single"}
              onSelect={() => { if (state.entry) run(() => controller.duplicateEntry(state.entry!.id)); }}
            >
              Duplicate entry
            </MenuItem>
            <MenuItem icon={CopyIcon} disabled={state.entry === null} onSelect={() => { if (state.entry) copyEntryId(state.entry.id); }}>
              Copy entry ID
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={TrashIcon}
              tone="danger"
              disabled={state.model === null}
              onSelect={() => {
                if (state.entry) confirmDeleteEntry(state.entry.id, entryName);
                else if (state.model) confirmDeleteModel(state.model.id, state.model.document.name);
              }}
            >
              Delete…
            </MenuItem>
          </Menu>
        </>
      }
    >
      <EditorBody
        navLabel="Content"
        inspectorLabel="Preview"
        inspectorCollapsed={inspectorCollapsed}
        onInspectorCollapsedChange={collapseInspector}
        nav={
          <ContentNavigator
            state={state}
            controller={controller}
            run={run}
            onAddModel={() => setAddModelOpen(true)}
            onDeleteModel={confirmDeleteModel}
            onDeleteEntry={confirmDeleteEntry}
            onCopyEntryId={copyEntryId}
          />
        }
        main={
          <Pane variant="main" label="Editor">
            <PaneHeader title={schemaMode ? "Schema" : "Entry"}>
              {state.model ? <Chip tone="plain">{state.model.document.name} · {state.model.document.kind}</Chip> : null}
            </PaneHeader>
            <PaneBody padded>
              {error || state.saveStatus === "error" ? (
                <Banner
                  tone="err"
                  action={state.saveStatus === "error" ? <Button size="sm" onClick={() => controller.retrySave()}>Retry save</Button> : undefined}
                >
                  {error ?? state.message}
                </Banner>
              ) : null}
              {notice ? <Banner tone="info">{notice}</Banner> : null}
              {!state.model ? (
                <EmptyState title="No model selected" description="Choose a model in the Content navigator, or add one." inline />
              ) : schemaMode ? (
                <ContentSchemaAuthor
                  state={state}
                  controller={controller}
                  run={run}
                  onRemove={(field) => confirm.request({
                    title: "Remove field?",
                    message: `${field.label} is removed from the model and its stored values are scrubbed from every Entry.`,
                    confirmLabel: "Remove",
                    tone: "danger",
                    onConfirm: () => run(() => controller.removeField(field.id)),
                  })}
                />
              ) : state.entry ? (
                <ContentEntryAuthor state={state} controller={controller} />
              ) : (
                <EmptyState title="Choose an Entry" description="Select an Entry in the navigator, or add one with its model's Add entry row." inline />
              )}
            </PaneBody>
          </Pane>
        }
        inspector={
          <ContentPreviewPane
            providerId={provider.descriptor.id}
            model={state.model}
            entry={state.entry}
            entryName={entryName || "Entry"}
            componentProvider={componentProvider}
            createPreviewSource={createPreviewSource}
          />
        }
      />
      <ContentAddModelDialog
        open={addModelOpen}
        onSubmit={(name, kind) => {
          setAddModelOpen(false);
          run(() => controller.createModel(name, kind));
        }}
        onClose={() => setAddModelOpen(false)}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </EditorChrome>
  );
}
