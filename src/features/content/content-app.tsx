import { computed, getScope, Show, signal, type Ref } from "@takazudo/zfb/zudo-react";
import { bindBreadcrumb, type BreadcrumbItem, type EditorStatus } from "../../app/chrome-context";
import { encodeContentValuePath, formatIntent, notifyRouteSelection, parseIntent } from "../../app/route-intents";
import type { AppServices } from "../../app/services";
import { createEditorChrome, createEditorRails, EditorBody, EditorChrome, RecordTitle, readEditorCollapsed, writeEditorCollapsed } from "../../components/editor-chrome";
import { CheckCircleIcon, CheckIcon, CopyIcon, DuplicateIcon, EllipsisIcon, EyeIcon, FileIcon, SettingsIcon, TrashIcon, WarningIcon } from "../../components/icons";
import { createLibraryConfirm } from "../../components/library-page";
import { ConfirmDialog, createMenu, Menu, MenuItem, MenuSeparator } from "../../components/overlay";
import { Rebuild } from "../../components/rebuild";
import { Banner, Button, Chip, EmptyState, Pane, PaneBody, PaneHeader, PaneTabs, SegmentedControl, StatusChip } from "../../components/ui";
import type { ContentProvider, ContentSnapshot } from "../../content";
import { Keyed } from "../../runtime";
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
import { controllerState } from "./reactive-draft";
import type { ContentAssetPickerRenderer } from "./structured-field-editor";

export interface ContentRouteContentProps {
  provider: ContentProvider;
  controller?: ContentAuthoringController;
  componentProvider?: ComposerComponentProvider;
  createPreviewSource?: () => ContentPreviewSource;
  renderAssetPicker?: ContentAssetPickerRenderer;
  assetPickerCapabilities?: { upload: boolean };
  loadActivatedBaseline?: () => Promise<readonly ContentSnapshot[]>;
  /** The shell's services; without them the route runs on its own provider, unpublished. */
  services?: AppServices;
}

/** Names the persisted rail geometry: one Content editor, not one per record. */
const CONTENT_EDITOR_KEY = "content";
const CONTENT_ROUTE = "/content";

const MODE_OPTIONS = [
  { value: "entries" as const, label: "Entry", icon: FileIcon },
  { value: "model-fields" as const, label: "Schema", icon: SettingsIcon },
  { value: "relationships" as const, label: "Relationships", icon: CopyIcon },
];

/**
 * Every mode acts on the OPEN model, and opening one is a provider read now
 * rather than an in-memory lookup. Left live during that read, a mode the
 * author picks is silently reverted the moment the load commits its own
 * default — so the control refuses the choice until there is a model to apply
 * it to, instead of taking it and dropping it.
 */
const NO_MODEL_MODE_OPTIONS = MODE_OPTIONS.map((option) => ({ ...option, disabled: true }));

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
 * published through `bindEditorStatus` rather than drawn here, because autosave
 * remains authoritative and the app chrome owns where its state is shown.
 */
export function ContentApp({ provider, controller: supplied, componentProvider, createPreviewSource, renderAssetPicker, assetPickerCapabilities, loadActivatedBaseline, services }: ContentRouteContentProps) {
  const scope = getScope();
  const integration = services?.workspace.integration;
  const controller = supplied ?? createContentAuthoringController(provider, { providers: integration?.contentProviders, assetProvider: integration?.assetProvider, loadActivatedBaseline });
  const state = controllerState(scope, controller);
  const actionError = signal<string | null>(null);
  const intentError = signal<string | null>(null);
  const error = computed(() => [actionError.value, intentError.value].filter(Boolean).join(" ") || null);
  const notice = signal<string | null>(null);
  const addModelOpen = signal(false);
  const entryTab = signal<"fields" | "raw" | "used-by">("fields");
  const deepSelection = signal<{ fieldId: string; valuePath?: readonly (string | number)[] } | null>(null);
  const inspectorCollapsed = signal(readEditorCollapsed(CONTENT_EDITOR_KEY).insp);
  const confirm = createLibraryConfirm();
  const overflowRef: Ref<HTMLButtonElement> = { current: null };
  const overflow = createMenu(overflowRef, { align: "end" });

  scope.onActivate(() => {
    if (controller.state.phase === "idle") void controller.initialize();
    if (!integration) return undefined;
    const session = integration.sessions.register({ feature: "Content", providerId: provider.descriptor.id, workspaceId: integration.workspace.id }, { flush: () => controller.flushSessions(), retry: () => controller.retrySave() });
    let model = controller.state.model, entry = controller.state.entry;
    const unsubscribe = controller.subscribe((next) => {
      if (model !== next.model || entry !== next.entry) { model = next.model; entry = next.entry; session.changed(); }
    });
    return () => { unsubscribe(); session.detach(); };
  });

  const run = (action: () => void | Promise<void>) => {
    const fail = (reason: unknown) => { if (!scope.abortSignal.aborted) actionError.value = reason instanceof Error ? reason.message : "Content action failed."; };
    actionError.value = null;
    notice.value = null;
    try { void Promise.resolve(action()).catch(fail); } catch (reason) { fail(reason); }
  };

  // `/content?model=&entry=` opens what it names, once, and only after the
  // library is loaded — `openModel` reads through the store the initialization
  // just prepared. A malformed link is reported rather than silently opening
  // the bare route.
  let appliedIntent = false;
  const intentAccepted = signal(false);
  const acceptVisibleSelection = () => {
    if (!controller.state.model) return;
    if (!intentAccepted.value) controller.selectView(null);
    deepSelection.value = null; intentError.value = null; actionError.value = null; intentAccepted.value = true;
  };
  scope.effect(() => {
    if (appliedIntent || state.value.phase !== "ready") return;
    appliedIntent = true;
    const outcome = parseIntent();
    if (outcome.status === "invalid") { intentError.value = outcome.message; return; }
    if (outcome.status !== "matched" || outcome.intent.route !== "content") { intentAccepted.value = true; return; }
    const intent = outcome.intent;
    if (intent.providerId !== provider.descriptor.id) { intentError.value = "The requested Content provider is unavailable."; return; }
    void (async () => {
      await controller.openModel(intent.modelId);
      controller.selectView(intent.viewId ?? null);
      if (intent.entryId !== undefined) await controller.openEntry(intent.entryId);
      if (scope.abortSignal.aborted) return;
      if (intent.fieldId !== undefined) { controller.selectView(null); entryTab.value = "fields"; deepSelection.value = { fieldId: intent.fieldId, ...(intent.valuePath ? { valuePath: intent.valuePath } : {}) }; }
      intentAccepted.value = true;
    })().catch((cause: unknown) => { if (!scope.abortSignal.aborted) intentError.value = cause instanceof Error ? cause.message : "The Content link could not be opened."; });
  });

  // The address bar follows the selection, so a copied URL opens what the
  // author is looking at. `replaceState` keeps it out of the history stack —
  // choosing a record is not a navigation.
  let lastHref: string | null = null;
  scope.effect(() => {
    const current = state.value;
    if (!intentAccepted.value || current.phase !== "ready") return;
    if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") return;
    const href = current.model ? contentHref(provider.descriptor.id, current.model.id, current.entry?.id, current.viewId, current.entry ? deepSelection.value : null) : CONTENT_ROUTE;
    const key = `${href}\u0000${JSON.stringify(deepSelection.value)}`;
    if (key === lastHref) return;
    lastHref = key;
    window.history.replaceState(null, "", href);
    notifyRouteSelection();
  });

  // A deep link lands on its field once the form that holds it is mounted.
  let lastDeepKey = "";
  scope.effect(() => {
    const selection = deepSelection.value, current = state.value, tab = entryTab.value;
    if (!selection || !current.entry || tab !== "fields") { lastDeepKey = ""; return; }
    const key = JSON.stringify([selection, tab, current.entry.id, current.model?.updatedAt]);
    if (key === lastDeepKey) return;
    lastDeepKey = key;
    queueMicrotask(() => {
      if (scope.abortSignal.aborted || lastDeepKey !== key) return;
      const path = selection.valuePath ? encodeContentValuePath(selection.valuePath) : "/";
      const root = document.querySelector<HTMLElement>(`[data-content-field-id="${selection.fieldId}"]`) ?? document.getElementById(`content-entry-${selection.fieldId}`);
      const target = selection.valuePath ? root?.querySelector<HTMLElement>(`[data-content-value-path="${path}"]`) : root;
      if (!target) { intentError.value = `The requested field or structured value no longer exists. Open Fields and choose a current value.`; return; }
      intentError.value = null;
      target.scrollIntoView?.({ block: "center" });
      (target.matches("input,select,textarea,button") || target.hasAttribute("tabindex") ? target : target.querySelector<HTMLElement>("input,select,textarea,button"))?.focus();
    });
  });

  const fields = computed(() => state.value.model?.document.fields ?? []);
  const entryName = computed(() => state.value.entry ? contentEntryLabel(state.value.entry, fields.value) : "");
  const titleField = computed(() => contentEntryTitleField(fields.value));
  const schemaMode = computed(() => state.value.workMode === "model-fields");
  // Completeness is a claim about the open Entry, so it belongs beside the
  // record's own chips in the pane header rather than being re-drawn as a panel
  // at the top of the form the author is filling in.
  const missing = computed(() => state.value.entry ? controller.completeness().length : 0);

  bindBreadcrumb(scope, services?.chrome ?? null, computed<readonly BreadcrumbItem[]>(() => {
    const { model, entry } = state.value;
    return [
      { label: "Content", href: CONTENT_ROUTE },
      ...(model ? [entry ? { label: model.document.name, href: contentHref(provider.descriptor.id, model.id) } : { label: model.document.name }] : []),
      ...(entry ? [{ label: entryName.value }] : []),
    ];
  }));

  function collapseInspector(collapsed: boolean): void {
    inspectorCollapsed.value = collapsed;
    writeEditorCollapsed(CONTENT_EDITOR_KEY, "insp", collapsed);
  }

  function copyEntryId(id: string): void {
    actionError.value = null;
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard) { notice.value = `Entry ID: ${id}`; return; }
    void clipboard.writeText(id).then(
      () => { notice.value = "Entry ID copied."; },
      () => { notice.value = `Entry ID: ${id}`; },
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

  const notReady = () => (
    <main class="sg-content-app sg-content-app--state" aria-busy={computed(() => state.value.phase === "loading")}>
      <Rebuild value={computed(() => ({ phase: state.value.phase, message: state.value.message, recoveryMessage: state.value.recoveryMessage }))}>{({ phase, message, recoveryMessage }) => <>
        {phase === "error" ? (
          <EmptyState
            title="Content library unavailable"
            description={message}
            action={<Button variant="primary" on:click={() => run(() => controller.retryInitialization())}>Retry</Button>}
          />
        ) : null}
        {phase === "recovery" ? (
          <EmptyState
            title="Stored Content needs recovery"
            description={<>{recoveryMessage} Your source records are quarantined and will not be overwritten.</>}
            action={
              <>
                <Button on:click={() => run(() => controller.retryInitialization())}>Retry</Button>
                <Button variant="danger" on:click={confirmStartFresh}>Start fresh…</Button>
              </>
            }
          />
        ) : null}
        {phase === "idle" || phase === "loading" ? <p class="sg-content-loading" role="status">Loading Content library…</p> : null}
      </>}</Rebuild>
      <ConfirmDialog {...confirm.dialogProps} />
    </main>
  );

  const ready = () => {
    const chrome = createEditorChrome({ editorKey: CONTENT_EDITOR_KEY });
    const rails = createEditorRails({ chrome, navLabel: "Content", inspectorLabel: "Preview", inspectorCollapsed, onInspectorCollapsedChange: collapseInspector });
    const saveStatus = computed(() => state.value.saveStatus);
    const status = computed(() => statusOf(saveStatus.value, state.value.message, () => controller.retrySave()));
    const dirty = computed(() => saveStatus.value === "dirty" || saveStatus.value === "saving" || saveStatus.value === "error");
    const entryTitle = computed(() => { const field = titleField.value, entry = state.value.entry; const value = field && entry ? entry.values[field.id] : undefined; return typeof value === "string" ? value : ""; });
    const view = computed(() => { const { model, entry, workMode } = state.value; return !model ? "directory" : workMode === "model-fields" ? "schema" : workMode === "relationships" ? "relationships" : entry ? "entry" : "entries"; });
    const hasEntry = computed(() => state.value.entry !== null);

    return (
      <EditorChrome
        chrome={chrome}
        appChrome={services?.chrome ?? null}
        class="sg-content-app"
        back={{ href: CONTENT_ROUTE, label: "Back to Content" }}
        title={
          <Keyed value={schemaMode} by={(mode) => String(mode)}>{(mode) => mode.value ? (
            <RecordTitle
              value={computed(() => state.value.model?.document.name ?? "")}
              label="Model name"
              placeholder="Model name"
              disabled={computed(() => state.value.model === null)}
              onCommit={(next) => run(() => controller.renameModel(next))}
            />
          ) : (
            <RecordTitle
              value={entryTitle}
              label="Entry title"
              placeholder="Untitled Entry"
              disabled={computed(() => state.value.entry === null || titleField.value === null)}
              onCommit={(next) => run(() => { const field = titleField.value; if (field) controller.updateEntryValue(field.id, next); })}
            />
          )}</Keyed>
        }
        status={status}
        dirty={dirty}
        // The switch renders each label as live text.
        paneLabels={{ nav: "Content", main: computed(() => (schemaMode.value ? "Schema" : "Entry")) as unknown as string, insp: "Preview" }}
        center={
          <Rebuild value={computed(() => state.value.model === null)}>{(noModel) => (
            <SegmentedControl<ContentWorkMode>
              label="Editor mode"
              size="sm"
              value={computed(() => state.value.workMode)}
              options={noModel ? NO_MODEL_MODE_OPTIONS : MODE_OPTIONS}
              onChange={(mode) => run(async () => { if (mode === "model-fields") await controller.inspectSchema(); else if (mode === "relationships") await controller.inspectRelationships(); else controller.browseEntries(); deepSelection.value = null; acceptVisibleSelection(); })}
            />
          )}</Rebuild>
        }
        right={
          <>
            <Button
              aria-pressed={computed(() => !inspectorCollapsed.value)}
              title={computed(() => (inspectorCollapsed.value ? "Preview panel is closed" : "Preview panel is open"))}
              on:click={() => collapseInspector(!inspectorCollapsed.value)}
            >
              <EyeIcon size="sm" />
              Preview
            </Button>
            <Button
              variant="primary"
              disabled={computed(() => saveStatus.value === "saved" || saveStatus.value === "pristine")}
              // Autosave stays authoritative; Save is the explicit flush for an
              // author who wants the pending write to land now.
              title={computed(() => (saveStatus.value === "pristine" ? "No changes to save" : saveStatus.value === "saved" ? "All changes saved" : "Save now"))}
              on:click={() => run(() => (saveStatus.value === "error" ? controller.retrySave() : controller.flushSessions()))}
            >
              <CheckIcon size="sm" />
              Save
            </Button>
            <Button variant="ghost" iconOnly elementRef={overflowRef} aria-label="More Content actions" {...overflow.triggerProps}>
              <EllipsisIcon size="sm" />
            </Button>
            <Menu controller={overflow} label="Content actions">
              <Show
                when={schemaMode}
                fallback={() => <MenuItem icon={SettingsIcon} onSelect={() => run(async () => { await controller.inspectSchema(); acceptVisibleSelection(); })}>Edit schema</MenuItem>}
              >{() => <MenuItem icon={FileIcon} onSelect={() => { controller.browseEntries(); acceptVisibleSelection(); }}>Edit entry</MenuItem>}</Show>
              <MenuSeparator />
              <MenuItem
                icon={DuplicateIcon}
                disabled={computed(() => { const current = state.value; return current.entryCreationPending || current.modelSelectionPending || current.entry === null || current.model?.document.kind === "single"; })}
                onSelect={() => { const entry = state.value.entry; if (entry) run(() => controller.duplicateEntry(entry.id)); }}
              >
                Duplicate entry
              </MenuItem>
              <MenuItem icon={CopyIcon} disabled={computed(() => !hasEntry.value)} onSelect={() => { const entry = state.value.entry; if (entry) copyEntryId(entry.id); }}>
                Copy entry ID
              </MenuItem>
              <MenuItem icon={WarningIcon} disabled={computed(() => state.value.entry?.lifecycle !== "published")} onSelect={() => run(() => controller.requestUnpublish())}>
                Request unpublish
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={TrashIcon}
                tone="danger"
                disabled={computed(() => state.value.model === null)}
                onSelect={() => {
                  const { entry, model } = state.value;
                  if (entry) confirmDeleteEntry(entry.id, entryName.value);
                  else if (model) confirmDeleteModel(model.id, model.document.name);
                }}
              >
                {computed(() => `Delete ${hasEntry.value ? "entry" : "model"}…`)}
              </MenuItem>
            </Menu>
          </>
        }
      >
        <EditorBody
          chrome={chrome}
          rails={rails}
          nav={
            <ContentNavigator
              state={state}
              controller={controller}
              chrome={chrome}
              rails={rails}
              run={run}
              onAddModel={() => { addModelOpen.value = true; }}
              onDeleteModel={confirmDeleteModel}
              onDeleteEntry={confirmDeleteEntry}
              onCopyEntryId={copyEntryId}
              onSelectionAccepted={acceptVisibleSelection}
            />
          }
          main={
            <Pane variant="main" label="Editor">
              <PaneHeader
                title={computed(() => ({ directory: "All models", schema: "Schema", relationships: "Relationships", entry: "Entry", entries: "Entries" })[view.value])}
                actions={
                  <Rebuild value={computed(() => state.value.entry ? `${state.value.publicationState}\u0000${missing.value}` : null)}>{(key) => {
                    if (key === null) return null;
                    const publicationState = state.value.publicationState, count = missing.value;
                    return <>
                      <Chip tone={publicationState === "draft" ? "plain" : publicationState === "published-pending" || publicationState === "published-baseline-unavailable" ? "warn" : "accent"}>{publicationState === "published-pending" ? "Published · pending changes" : publicationState === "published-baseline-unavailable" ? "Published · baseline unavailable" : publicationState === "published" ? "Published" : "Draft"}</Chip>
                      <StatusChip
                        class="sg-content-completeness"
                        state="custom"
                        tone={count === 0 ? "ok" : "warn"}
                        icon={count === 0 ? CheckCircleIcon : WarningIcon}
                        label={count === 0 ? "Complete" : "Incomplete draft"}
                        // Short on purpose: the header is a fixed-height row that
                        // already carries the record's own chips beside it.
                        detail={count === 0 ? undefined : `${count} missing`}
                      />
                    </>;
                  }}</Rebuild>
                }
              >
                <Show when={computed(() => state.value.model !== null)}>{() => <Chip tone="plain">{computed(() => { const model = state.value.model; return model ? `${model.document.name} · ${model.document.kind}` : ""; })}</Chip>}</Show>
              </PaneHeader>
              <PaneBody padded>
                <Rebuild value={computed(() => { const current = state.value; return error.value || current.saveStatus === "error" ? { error: error.value, saveStatus: current.saveStatus, conflict: current.conflictRecovery, message: current.message } : null; })}>{(banner) => banner ? (
                  <Banner
                    tone="err"
                    action={banner.conflict ? (
                      banner.conflict.authoritativeReady ? <>
                        <Button size="sm" on:click={() => run(() => controller.discardConflictDraft())}>Use latest</Button>
                        <Button size="sm" disabled={!banner.conflict.canReapply} on:click={() => run(() => controller.reconcileConflictDraft())}>Reapply my draft</Button>
                      </> : <Button size="sm" on:click={() => run(() => controller.reloadConflictAuthoritative())}>Retry latest</Button>
                    ) : banner.saveStatus === "error" ? <Button size="sm" on:click={() => controller.retrySave()}>Retry save</Button> : undefined}
                  >
                    {banner.error ?? banner.conflict?.message ?? banner.message}
                  </Banner>
                ) : null}</Rebuild>
                <Show when={computed(() => notice.value !== null)}>{() => <Banner tone="info">{computed(() => notice.value ?? "")}</Banner>}</Show>
                <Keyed value={view} by={(kind) => kind}>{(kind) => {
                  switch (kind.value) {
                    case "directory": return <><p class="sg-content-hint">No model selected</p><ContentModelDirectory state={state} controller={controller} run={run} onAddModel={() => { addModelOpen.value = true; }} /></>;
                    case "schema": return (
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
                    );
                    case "relationships": return <ContentRelationshipsView state={state} />;
                    case "entries": return <ContentEntriesWorkspace state={state} controller={controller} run={run} />;
                    case "entry": return <EntryWorkspace />;
                  }
                }}</Keyed>
              </PaneBody>
            </Pane>
          }
          inspector={
            <ContentPreviewPane
              saveStatus={saveStatus}
              providerId={provider.descriptor.id}
              model={computed(() => state.value.model)}
              entry={computed(() => state.value.entry)}
              entryName={computed(() => entryName.value || "Entry")}
              componentProvider={componentProvider}
              createPreviewSource={createPreviewSource}
              rails={rails}
              integration={integration}
              assetStore={integration?.assetProvider?.store}
            />
          }
        />
        <ContentAddModelDialog
          open={addModelOpen}
          onSubmit={(name, kind) => {
            addModelOpen.value = false;
            run(async () => { await controller.createModel(name, kind); acceptVisibleSelection(); });
          }}
          onClose={() => { addModelOpen.value = false; }}
        />
        <ConfirmDialog {...confirm.dialogProps} />
      </EditorChrome>
    );
  };

  function EntryWorkspace() {
    const activeEntryTab = computed(() => entryTab.value === "fields" && state.value.viewId ? `view:${state.value.viewId}` : entryTab.value);
    const views = computed(() => JSON.stringify((state.value.model?.document.presentation?.views ?? []).map((view) => [view.id, view.label])));
    const incomingCount = computed(() => state.value.incoming.length);
    let lastEntry = state.value.entry!;
    const entry = computed(() => { const current = state.value.entry; if (current) lastEntry = current; return lastEntry; });
    let lastModel = state.value.model!;
    const model = computed(() => { const current = state.value.model; if (current) lastModel = current; return lastModel; });
    return (
      <div class="sg-content-entry-workspace">
        <Rebuild value={views}>{(serialized) => (
          <PaneTabs
            label="Entry workspace"
            class="sg-content-entry-tabs"
            tabs={[{ id: "fields", label: "Fields" }, { id: "raw", label: "Raw" }, { id: "used-by", label: "Used by", count: incomingCount }, ...(JSON.parse(serialized) as [string, string][]).map(([id, label]) => ({ id: `view:${id}`, label }))]}
            activeId={activeEntryTab}
            onSelect={(id) => { deepSelection.value = null; if (id.startsWith("view:")) { controller.selectView(id.slice(5)); entryTab.value = "fields"; } else { controller.selectView(null); entryTab.value = id as "fields" | "raw" | "used-by"; } }}
          />
        )}</Rebuild>
        <Keyed value={entryTab} by={(tab) => tab}>{(tab) => tab.value === "raw"
          ? <ContentRawView model={model} entry={entry} />
          : tab.value === "used-by"
            ? <ContentUsedByView state={state} controller={controller} />
            : <ContentEntryAuthor state={state} controller={controller} run={run} renderAssetPicker={renderAssetPicker} assetPickerCapabilities={assetPickerCapabilities} integration={integration} />}</Keyed>
      </div>
    );
  }

  return <Show when={computed(() => state.value.phase === "ready")} fallback={notReady}>{ready}</Show>;
}
