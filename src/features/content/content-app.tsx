import type { JSX } from "preact";
import { useWorkspace } from "../../app/workspace-context";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useBreadcrumb, type EditorStatus } from "../../app/chrome-context";
import { encodeContentValuePath, formatIntent, notifyRouteSelection, parseIntent } from "../../app/route-intents";
import { EditorBody, EditorChrome, RecordTitle, readEditorCollapsed, writeEditorCollapsed } from "../../components/editor-chrome";
import { CheckCircleIcon, CheckIcon, CopyIcon, DuplicateIcon, EllipsisIcon, EyeIcon, FileIcon, SettingsIcon, TrashIcon, WarningIcon } from "../../components/icons";
import { useLibraryConfirm } from "../../components/library-page";
import { ConfirmDialog, Menu, MenuItem, MenuSeparator, useMenu } from "../../components/overlay";
import { Banner, Button, Chip, EmptyState, Pane, PaneBody, PaneHeader, PaneTabs, SegmentedControl, StatusChip } from "../../components/ui";
import type { ContentProvider, ContentSnapshot } from "../../content";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { ContentAddModelDialog } from "./add-model-dialog";
import { ContentEntryAuthor, ContentSchemaAuthor } from "./content-author";
import { ContentNavigator } from "./content-library";
import { ContentModelDirectory } from "./content-directory";
import { ContentEntriesWorkspace, ContentRawView, ContentRelationshipsView, ContentUsedByView } from "./content-workspace";
import { ContentPreviewPane } from "./content-preview-pane";
import { createContentAuthoringController, type ContentAuthoringController, type ContentAuthoringState, type ContentSaveStatus, type ContentWorkMode } from "./controller";
import { contentEntryLabel, contentEntryTitleField } from "./presentation";
import type { ContentPreviewSource } from "./preview-source";
import type { ContentMediaPickerRenderer } from "./structured-field-editor";

export interface ContentRouteContentProps {
  provider: ContentProvider;
  controller?: ContentAuthoringController;
  componentProvider?: ComposerComponentProvider;
  createPreviewSource?: () => ContentPreviewSource;
  renderMediaPicker?: ContentMediaPickerRenderer;
  loadActivatedBaseline?: () => Promise<readonly ContentSnapshot[]>;
}

/** Names the persisted rail geometry: one Content editor, not one per record. */
const CONTENT_EDITOR_KEY = "content";
const CONTENT_ROUTE = "/content";

const MODE_OPTIONS = [
  { value: "entries" as const, label: "Entry", icon: FileIcon },
  { value: "model-fields" as const, label: "Schema", icon: SettingsIcon },
  { value: "relationships" as const, label: "Relationships", icon: CopyIcon },
];

/** The save queue's vocabulary, translated into the chrome's four states. */
function statusOf(status: ContentSaveStatus, detail: string, onRetry: () => void): EditorStatus | null {
  switch (status) {
    case "pristine": return null;
    case "saved": return { state: "saved" };
    case "saving": return { state: "saving" };
    case "error": return { state: "failed", detail, onRetry };
    case "dirty": return { state: "unsaved" };
  }
}

function contentHref(providerId: string, modelId: string, entryId?: string, viewId?: string | null, selection?: { fieldId: string; valuePath?: readonly (string | number)[] } | null): string {
  return formatIntent({ route: "content", providerId, modelId, ...(entryId ? { entryId } : {}), ...(viewId ? { viewId } : {}), ...(selection ? selection : {}) });
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
export function ContentApp({ provider, controller: supplied, componentProvider, createPreviewSource, renderMediaPicker, loadActivatedBaseline }: ContentRouteContentProps): JSX.Element {
  const integration = useWorkspace()?.integration;
  const controller = useMemo(() => supplied ?? createContentAuthoringController(provider, { providers: integration?.contentProviders, mediaProvider: integration?.mediaProvider, loadActivatedBaseline }), [integration, loadActivatedBaseline, provider, supplied]);
  const [state, setState] = useState<ContentAuthoringState>(controller.state);
  const [actionError, setError] = useState<string | null>(null);
  const [intentError, setIntentError] = useState<string | null>(null);
  const error = [actionError, intentError].filter(Boolean).join(" ") || null;
  const [notice, setNotice] = useState<string | null>(null);
  const [addModelOpen, setAddModelOpen] = useState(false);
  const [entryTab, setEntryTab] = useState<"fields" | "raw" | "used-by">("fields");
  const [deepSelection, setDeepSelection] = useState<{ fieldId: string; valuePath?: readonly (string | number)[] } | null>(null);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(() => readEditorCollapsed(CONTENT_EDITOR_KEY).insp);
  const confirm = useLibraryConfirm();
  const overflowRef = useRef<HTMLButtonElement | null>(null);
  const overflow = useMenu(overflowRef, { align: "end" });

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => {
    if (!integration) return;
    const session = integration.sessions.register({ feature: "Content", providerId: provider.descriptor.id, workspaceId: integration.workspace.id }, { flush: () => controller.flushSessions(), retry: () => controller.retrySave() });
    let model = controller.state.model, entry = controller.state.entry;
    const unsubscribe = controller.subscribe((next) => {
      if (model !== next.model || entry !== next.entry) { model = next.model; entry = next.entry; session.changed(); }
    });
    return () => { unsubscribe(); session.detach(); };
  }, [controller, integration, provider]);
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
  const [intentAccepted, setIntentAccepted] = useState(false);
  const acceptVisibleSelection = () => {
    if (!controller.state.model) return;
    if (!intentAccepted) controller.selectView(null);
    setDeepSelection(null); setIntentError(null); setError(null); setIntentAccepted(true);
  };
  useEffect(() => {
    if (appliedIntent.current || state.phase !== "ready") return;
    appliedIntent.current = true;
    const outcome = parseIntent();
    if (outcome.status === "invalid") { setIntentError(outcome.message); return; }
    if (outcome.status !== "matched" || outcome.intent.route !== "content") { setIntentAccepted(true); return; }
    const intent = outcome.intent;
    if (intent.providerId !== provider.descriptor.id) { setIntentError("The requested Content provider is unavailable."); return; }
    void (async () => {
      await controller.openModel(intent.modelId);
      controller.selectView(intent.viewId ?? null);
      if (intent.entryId !== undefined) await controller.openEntry(intent.entryId);
      if (intent.fieldId !== undefined) { controller.selectView(null); setEntryTab("fields"); setDeepSelection({ fieldId: intent.fieldId, ...(intent.valuePath ? { valuePath: intent.valuePath } : {}) }); }
      setIntentAccepted(true);
    })().catch((cause: unknown) => setIntentError(cause instanceof Error ? cause.message : "The Content link could not be opened."));
  }, [controller, state.phase]);

  // The address bar follows the selection, so a copied URL opens what the
  // author is looking at. `replaceState` keeps it out of the history stack —
  // choosing a record is not a navigation.
  useEffect(() => {
    if (!intentAccepted || state.phase !== "ready") return;
    if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") return;
    window.history.replaceState(null, "", state.model ? contentHref(provider.descriptor.id, state.model.id, state.entry?.id, state.viewId, state.entry ? deepSelection : null) : CONTENT_ROUTE);
    notifyRouteSelection();
  }, [deepSelection, intentAccepted, state.phase, state.model?.id, state.entry?.id, state.viewId]);

  useEffect(() => {
    if (!deepSelection || !state.entry || entryTab !== "fields") return;
    const path = deepSelection.valuePath ? encodeContentValuePath(deepSelection.valuePath) : "/";
    const root = document.querySelector<HTMLElement>(`[data-content-field-id="${deepSelection.fieldId}"]`) ?? document.getElementById(`content-entry-${deepSelection.fieldId}`);
    const target = deepSelection.valuePath ? root?.querySelector<HTMLElement>(`[data-content-value-path="${path}"]`) : root;
    if (!target) { setIntentError(`The requested field or structured value no longer exists. Open Fields and choose a current value.`); return; }
    setIntentError(null);
    target.scrollIntoView?.({ block: "center" });
    (target.matches("input,select,textarea,button") || target.hasAttribute("tabindex") ? target : target.querySelector<HTMLElement>("input,select,textarea,button"))?.focus();
  }, [deepSelection, entryTab, state.entry?.id, state.model?.updatedAt]);

  const fields = state.model?.document.fields ?? [];
  const entryName = state.entry ? contentEntryLabel(state.entry, fields) : "";
  const titleField = contentEntryTitleField(fields);
  const schemaMode = state.workMode === "model-fields";
  const relationshipsMode = state.workMode === "relationships";
  // Completeness is a claim about the open Entry, so it belongs beside the
  // record's own chips in the pane header rather than being re-drawn as a panel
  // at the top of the form the author is filling in.
  const missing = state.entry ? controller.completeness().length : 0;
  const activeEntryTab = entryTab === "fields" && state.viewId ? `view:${state.viewId}` : entryTab;
  const entryTabs = [{ id: "fields", label: "Fields" }, { id: "raw", label: "Raw" }, { id: "used-by", label: "Used by", count: state.incoming.length }, ...(state.model?.document.presentation?.views.map((view) => ({ id: `view:${view.id}`, label: view.label })) ?? [])];

  useBreadcrumb([
    { label: "Content", href: CONTENT_ROUTE },
    ...(state.model ? [state.entry ? { label: state.model.document.name, href: contentHref(provider.descriptor.id, state.model.id) } : { label: state.model.document.name }] : []),
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
      dirty={state.saveStatus === "dirty" || state.saveStatus === "saving" || state.saveStatus === "error"}
      paneLabels={{ nav: "Content", main: schemaMode ? "Schema" : "Entry", insp: "Preview" }}
      center={
        <SegmentedControl<ContentWorkMode>
          label="Editor mode"
          size="sm"
          value={state.workMode}
          options={MODE_OPTIONS}
          onChange={(mode) => run(async () => { if (mode === "model-fields") await controller.inspectSchema(); else if (mode === "relationships") await controller.inspectRelationships(); else controller.browseEntries(); setDeepSelection(null); acceptVisibleSelection(); })}
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
            disabled={state.saveStatus === "saved" || state.saveStatus === "pristine"}
            // Autosave stays authoritative; Save is the explicit flush for an
            // author who wants the pending write to land now.
            title={state.saveStatus === "pristine" ? "No changes to save" : state.saveStatus === "saved" ? "All changes saved" : "Save now"}
            onClick={() => run(() => (state.saveStatus === "error" ? controller.retrySave() : controller.flushSessions()))}
          >
            <CheckIcon size="sm" />
            Save
          </Button>
          <Button variant="ghost" iconOnly elementRef={overflowRef} aria-label="More Content actions" {...overflow.triggerProps}>
            <EllipsisIcon size="sm" />
          </Button>
          <Menu controller={overflow} label="Content actions">
            {schemaMode ? (
              <MenuItem icon={FileIcon} onSelect={() => { controller.browseEntries(); acceptVisibleSelection(); }}>Edit entry</MenuItem>
            ) : (
              <MenuItem icon={SettingsIcon} onSelect={() => run(async () => { await controller.inspectSchema(); acceptVisibleSelection(); })}>Edit schema</MenuItem>
            )}
            <MenuSeparator />
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
            <MenuItem icon={WarningIcon} disabled={state.entry?.lifecycle !== "published"} onSelect={() => run(() => controller.requestUnpublish())}>
              Request unpublish
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
              Delete {state.entry ? "entry" : "model"}…
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
            onSelectionAccepted={acceptVisibleSelection}
          />
        }
        main={
          <Pane variant="main" label="Editor">
            <PaneHeader
              title={!state.model ? "All models" : schemaMode ? "Schema" : relationshipsMode ? "Relationships" : state.entry ? "Entry" : "Entries"}
              actions={state.entry ? (<>
                <Chip tone={state.publicationState === "draft" ? "plain" : state.publicationState === "published-pending" || state.publicationState === "published-baseline-unavailable" ? "warn" : "accent"}>{state.publicationState === "published-pending" ? "Published · pending changes" : state.publicationState === "published-baseline-unavailable" ? "Published · baseline unavailable" : state.publicationState === "published" ? "Published" : "Draft"}</Chip>
                <StatusChip
                  class="sg-content-completeness"
                  state="custom"
                  tone={missing === 0 ? "ok" : "warn"}
                  icon={missing === 0 ? CheckCircleIcon : WarningIcon}
                  label={missing === 0 ? "Complete" : "Incomplete draft"}
                  // Short on purpose: the header is a fixed-height row that
                  // already carries the record's own chips beside it.
                  detail={missing === 0 ? undefined : `${missing} missing`}
                />
              </>) : null}
            >
              {state.model ? <Chip tone="plain">{state.model.document.name} · {state.model.document.kind}</Chip> : null}
            </PaneHeader>
            <PaneBody padded>
              {error || state.saveStatus === "error" ? (
                <Banner
                  tone="err"
                  action={state.conflictRecovery ? (
                    state.conflictRecovery.authoritativeReady ? <>
                      <Button size="sm" onClick={() => run(() => controller.discardConflictDraft())}>Use latest</Button>
                      <Button size="sm" disabled={!state.conflictRecovery.canReapply} onClick={() => run(() => controller.reconcileConflictDraft())}>Reapply my draft</Button>
                    </> : <Button size="sm" onClick={() => run(() => controller.reloadConflictAuthoritative())}>Retry latest</Button>
                  ) : state.saveStatus === "error" ? <Button size="sm" onClick={() => controller.retrySave()}>Retry save</Button> : undefined}
                >
                  {error ?? state.conflictRecovery?.message ?? state.message}
                </Banner>
              ) : null}
              {notice ? <Banner tone="info">{notice}</Banner> : null}
              {!state.model ? (
                <><p class="sg-content-hint">No model selected</p><ContentModelDirectory state={state} controller={controller} run={run} onAddModel={() => setAddModelOpen(true)} /></>
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
              ) : relationshipsMode ? (
                <ContentRelationshipsView state={state} />
              ) : state.entry ? (
                <div class="sg-content-entry-workspace"><PaneTabs label="Entry workspace" class="sg-content-entry-tabs" tabs={entryTabs} activeId={activeEntryTab} onSelect={(id) => { setDeepSelection(null); if (id.startsWith("view:")) { controller.selectView(id.slice(5)); setEntryTab("fields"); } else { controller.selectView(null); setEntryTab(id as "fields" | "raw" | "used-by"); } }} />{entryTab === "raw" ? <ContentRawView model={state.model} entry={state.entry} /> : entryTab === "used-by" ? <ContentUsedByView state={state} controller={controller} /> : <ContentEntryAuthor state={state} controller={controller} run={run} renderMediaPicker={renderMediaPicker} />}</div>
              ) : (
                <ContentEntriesWorkspace state={state} controller={controller} run={run} />
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
          run(async () => { await controller.createModel(name, kind); acceptVisibleSelection(); });
        }}
        onClose={() => setAddModelOpen(false)}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </EditorChrome>
  );
}
