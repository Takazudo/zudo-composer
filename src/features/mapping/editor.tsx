import { computed, getScope, signal, type Child, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { bindBreadcrumb, type EditorStatus } from "../../app/chrome-context";
import type { AppServices } from "../../app/services";
import { formatIntent } from "../../app/route-intents";
import { createEditorChrome, createEditorRails, EditorBody, EditorChrome, RecordTitle } from "../../components/editor-chrome";
import type { EditorPane } from "../../components/editor-chrome";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ComposerIcon,
  ContentIcon,
  DuplicateIcon,
  EllipsisIcon,
  PlayIcon,
  SaveIcon,
  TrashIcon,
} from "../../components/icons";
import { createLibraryConfirm } from "../../components/library-page";
import { ConfirmDialog, createMenu, Menu, MenuItem, MenuSeparator } from "../../components/overlay";
import { liveSlot, Rebuild } from "../../components/rebuild";
import { Banner, Button } from "../../components/ui";
import type { MappingCollectionQuery } from "../../mapping";
import { formatComposerRoute } from "../composer/routing";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { BindingsPane } from "./bindings-pane";
import type { MappingEditorController, MappingEditorState, MappingSaveStatus } from "./controller";
import { MAPPING_ROUTE, mappingDeepLinkHref } from "./deep-link";
import { InspectorPane, type MappingInspectorTab } from "./inspector-pane";
import type { MappingRecord } from "../../mapping";
import { buildBindingRows, firstCompatibleProjection, firstCompatibleTransform, refKey } from "./presentation";
import { RecordPickerDialog } from "./record-picker-dialog";
import { SourcePane } from "./source-pane";
import { PinPickerDialog } from "./pin-picker-dialog";
import { derive, memo } from "../../components/reactive";

// The Mapping editor on the shared record chrome: back, an inline-editable
// name, the source/target pair in the centre, and Test + Save on the right.
// Test no longer opens a modal — it re-runs the evaluation and brings the
// Diagnostics tab forward, which is where the answer already lives.

type PickerKind = "content" | "composition";

export interface MappingEditorProps {
  state: ReadonlySignal<MappingEditorState>;
  controller: MappingEditorController;
  componentProvider: ComposerComponentProvider;
  /** Route transitions this editor owns: back, duplicate and delete. */
  navigate: (href: string) => void;
  /** Reports a rejected action without unmounting the editor. */
  error: ReadonlySignal<string | null>;
  run: (action: () => void | Promise<void>) => void;
  /** Publishes the breadcrumb and save state into the shell chrome. */
  services?: AppServices;
}

/** The queue's vocabulary translated into the chrome's four states. */
function statusOf(status: MappingSaveStatus, detail: string, onRetry: () => void): EditorStatus {
  switch (status) {
    case "saved": return { state: "saved" };
    case "saving": return { state: "saving" };
    case "error": return { state: "failed", detail, onRetry };
    case "dirty": return { state: "unsaved" };
  }
}

/**
 * The open record. The editor is mounted per record id, so `mapping` is set
 * for its whole life; the last record is kept across the one flush in which a
 * delete has cleared it and the route has not yet switched to the library.
 */
export function openMapping(state: ReadonlySignal<MappingEditorState>): ReadonlySignal<MappingRecord> {
  let last = state.value.mapping!;
  return computed(() => {
    const current = state.value.mapping;
    if (current) last = current;
    return last;
  });
}

export function MappingEditor({
  state,
  controller,
  componentProvider,
  navigate,
  error,
  run,
  services,
}: MappingEditorProps): Child {
  const scope = getScope();
  const mapping = openMapping(state);
  const pane = signal<EditorPane>("main");
  const tab = signal<MappingInspectorTab>("preview");
  const picker = signal<PickerKind | null>(null);
  const pinPickerOpen = signal(false);
  const confirm = createLibraryConfirm();
  const overflowRef: Ref<HTMLButtonElement> = { current: null };
  const overflow = createMenu(overflowRef, { align: "end" });
  const chrome = createEditorChrome({ editorKey: "mapping", activePane: pane, onActivePaneChange: (next) => { pane.value = next; } });
  const rails = createEditorRails({ chrome, navLabel: "Source fields", inspectorLabel: "Inspector" });

  bindBreadcrumb(scope, services?.chrome ?? null, computed(() => [{ label: "Mappings", href: MAPPING_ROUTE }, { label: mapping.value.document.name }]));

  const definition = computed(() => state.value.definition);
  const rows = derive(() => [mapping.value, definition.value] as const, buildBindingRows);
  const modelName = computed(() => definition.value?.contentModel?.document.name
    ?? state.value.contentModels.find((entry) => refKey(entry.ref) === refKey(mapping.value.document.contentModel))?.summary.name
    ?? mapping.value.document.contentModel.recordId);
  const compositionName = computed(() => definition.value?.composition?.document.name
    ?? state.value.compositions.find((entry) => refKey(entry.ref) === refKey(mapping.value.document.composition))?.summary.name
    ?? mapping.value.document.composition.recordId);

  /** Show the answer where it lives: re-evaluate, then bring Diagnostics forward. */
  const test = () => run(async () => {
    await controller.testDefinition();
    tab.value = "diagnostics";
    pane.value = "insp";
  });

  const bind = (sourceFieldId: string, target: { nodeId: string; prop: string }) =>
    run(() => sourceFieldId === "entry:identity" ? controller.bindEntryIdentity(target) : controller.addBinding(sourceFieldId, target));

  const rebind = (bindingId: string, sourceFieldId: string) => run(() => {
    const row = rows.value.find((candidate) => candidate.binding.id === bindingId);
    if (sourceFieldId === "entry:identity" && row) return controller.bindEntryIdentity(row.binding.target, bindingId);
    const field = definition.value?.contentModel?.document.fields.find((candidate) => candidate.id === sourceFieldId);
    // The menu only ever offers compatible sources, so a transform exists;
    // keeping the stored one would leave the row broken in a new way.
    const projection = row?.target && field ? firstCompatibleProjection(field, row.target) : null;
    const transform = projection && row?.target ? firstCompatibleTransform(projection.kind, row.target) : null;
    return controller.updateBinding(bindingId, { sourceFieldId, ...(projection ? { projection: projection.projection } : {}), ...(transform ? { transform } : {}) });
  });

  const askDelete = () => confirm.request({
    title: `Delete ${mapping.value.document.name}?`,
    message: "Its bindings go with it. The Content model and the Composition are untouched. This cannot be undone.",
    confirmLabel: "Delete",
    tone: "danger",
    onConfirm: () => run(async () => {
      await controller.delete(mapping.value.id);
      navigate(MAPPING_ROUTE);
    }),
  });

  const referenceEntries = (target: { providerId: string; recordId: string }) => controller.referenceQueryEntries(target);
  const recordLinks = memo(() => [mapping.value.document.contentModel, mapping.value.document.composition] as const);
  const collectionQuery = computed(() => mapping.value.document.mode.kind === "collection" ? mapping.value.document.mode.query : null);
  return (
    <EditorChrome
      chrome={chrome}
      appChrome={services?.chrome ?? null}
      class="cms-mapping-editor"
      back={{ href: MAPPING_ROUTE, label: "Back to Mappings" }}
      title={<RecordTitle value={computed(() => mapping.value.document.name)} label="Mapping name" onCommit={(name) => controller.rename(name)} />}
      status={computed(() => statusOf(state.value.saveStatus, state.value.message, () => run(() => controller.retrySave())))}
      dirty={computed(() => state.value.saveStatus !== "saved")}
      paneLabels={{ nav: "Fields", main: "Bindings", insp: "Inspector" }}
      center={
        <>
          <Button size="sm" aria-label={computed(() => `Content model: ${modelName.value}`)} on:click={() => { picker.value = "content"; }}>
            <ContentIcon size="sm" />
            <span class="cms-mapping-pick__name">{modelName}</span>
            <ChevronDownIcon size="xs" />
          </Button>
          <ArrowRightIcon size="sm" class="cms-mapping-pick__arrow" aria-hidden="true" />
          <Button size="sm" aria-label={computed(() => `Composition: ${compositionName.value}`)} on:click={() => { picker.value = "composition"; }}>
            <ComposerIcon size="sm" />
            <span class="cms-mapping-pick__name">{compositionName}</span>
            <ChevronDownIcon size="xs" />
          </Button>
        </>
      }
      right={
        <>
          <Button on:click={test}>
            <PlayIcon size="sm" />
            Test
          </Button>
          <Button
            variant="primary"
            disabled={computed(() => state.value.saveStatus === "saved" || state.value.saveStatus === "saving")}
            on:click={() => run(() => controller.flush())}
          >
            <SaveIcon size="sm" />
            Save
          </Button>
          {/* A raw ref is what the menu measures its trigger with, so this one
           * takes `elementRef` rather than being wrapped in a positioned div. */}
          <Button elementRef={overflowRef} variant="ghost" iconOnly aria-label="More Mapping actions" {...overflow.triggerProps}>
            <EllipsisIcon size="sm" />
          </Button>
          <Menu controller={overflow} label="Mapping actions">
            {/* `.cms-editor__center` is hidden below 64rem, so the two picker
             * buttons are unreachable there. Repairing a drifted Mapping is
             * exactly what a narrow screen must still be able to do. */}
            <MenuItem icon={ContentIcon} onSelect={() => { picker.value = "content"; }}>Change Content model…</MenuItem>
            <MenuItem icon={ComposerIcon} onSelect={() => { picker.value = "composition"; }}>Change Composition…</MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={DuplicateIcon}
              onSelect={() => run(async () => {
                const id = await controller.duplicate(mapping.value.id);
                navigate(mappingDeepLinkHref({ providerId: controller.provider.descriptor.id, mappingId: id }));
              })}
            >
              Duplicate mapping
            </MenuItem>
            {/* The two links follow the record's current source and target. */}
            <Rebuild value={recordLinks}>{([contentModel, composition]) => (
              <>
                <MenuItem icon={ContentIcon} href={formatIntent({ route: "content", providerId: contentModel.providerId, modelId: contentModel.recordId })}>
                  Open in Content
                </MenuItem>
                <MenuItem
                  icon={ComposerIcon}
                  href={formatComposerRoute({ kind: "detail", providerId: composition.providerId, recordId: composition.recordId })}
                >
                  Open composition
                </MenuItem>
              </>
            )}</Rebuild>
            <MenuSeparator />
            <MenuItem icon={TrashIcon} tone="danger" onSelect={askDelete}>
              Delete…
            </MenuItem>
          </Menu>
        </>
      }
    >
      <EditorBody
        chrome={chrome}
        rails={rails}
        nav={
          <SourcePane
            state={state}
            rows={rows}
            rails={rails}
            onBind={bind}
            onSelectEntry={(entryId) => run(() => controller.selectEntry(entryId))}
            onModeChange={(kind) => run(() => controller.setMode(kind))}
            onQueryChange={(change: Partial<MappingCollectionQuery> | ((query: MappingCollectionQuery) => MappingCollectionQuery)) => run(() => controller.updateCollectionQuery(change))}
            referenceEntries={referenceEntries}
            onOpenPins={() => { pinPickerOpen.value = true; }}
          />
        }
        main={
          <BindingsPane
            state={state}
            rows={rows}
            notice={liveSlot(computed(() => (error.value ? <Banner tone="err">{error.value}</Banner> : null)))}
            onBind={bind}
            onRebind={rebind}
            onProjection={(bindingId, projection) => run(() => {
              const row = rows.value.find((candidate) => candidate.binding.id === bindingId);
              const transform = row?.target ? firstCompatibleTransform(row.projections.find((candidate) => JSON.stringify(candidate.projection) === JSON.stringify(projection))?.kind ?? "text", row.target) : null;
              return controller.updateBinding(bindingId, { projection, ...(transform ? { transform } : {}) });
            })}
            onTransform={(bindingId, transform) => run(() => controller.updateBinding(bindingId, { transform }))}
            onMove={(bindingId, direction) => run(() => controller.moveBinding(bindingId, direction))}
            onRemove={(bindingId) => run(() => controller.removeBinding(bindingId))}
          />
        }
        inspector={
          <InspectorPane
            state={state}
            componentProvider={componentProvider}
            rails={rails}
            tab={tab}
            onTabChange={(next) => { tab.value = next; }}
            onPreviewCurrent={() => controller.setPreviewCurrent()}
            onPreviewError={(message) => controller.setPreviewError(message)}
            controller={controller}
            run={run}
          />
        }
      />
      <RecordPickerDialog
        open={computed(() => picker.value === "content")}
        title="Choose a Content model"
        description="Bindings keep their source field ids; any that the new model does not carry are reported rather than dropped."
        searchLabel="Filter Content models"
        currentKey={computed(() => refKey(mapping.value.document.contentModel))}
        emptyMessage="No Content models are available."
        entries={derive(() => [state.value.contentModels] as const, (contentModels) => contentModels.map((entry) => ({
          key: refKey(entry.ref),
          name: entry.summary.name,
          detail: `${entry.summary.kind} · ${entry.providerLabel} · ${entry.ref.recordId}`,
          icon: ContentIcon,
        })))}
        onSelect={(key) => run(() => {
          const entry = state.value.contentModels.find((candidate) => refKey(candidate.ref) === key);
          return entry ? controller.selectContentModel(entry.ref) : Promise.resolve();
        })}
        onClose={() => { picker.value = null; }}
      />
      <RecordPickerDialog
        open={computed(() => picker.value === "composition")}
        title="Choose a Composition"
        description="Bindings keep their target props; any the new Composition does not carry are reported rather than dropped."
        searchLabel="Filter Compositions"
        currentKey={computed(() => refKey(mapping.value.document.composition))}
        emptyMessage="No Compositions are available."
        entries={derive(() => [state.value.compositions] as const, (compositions) => compositions.map((entry) => ({
          key: refKey(entry.ref),
          name: entry.summary.name,
          detail: `${entry.providerLabel} · ${entry.ref.recordId}`,
          icon: ComposerIcon,
        })))}
        onSelect={(key) => run(() => {
          const entry = state.value.compositions.find((candidate) => refKey(candidate.ref) === key);
          return entry ? controller.selectComposition(entry.ref) : Promise.resolve();
        })}
        onClose={() => { picker.value = null; }}
      />
      <PinPickerDialog
        open={pinPickerOpen}
        entries={computed(() => state.value.entries)}
        model={computed(() => definition.value?.contentModel ?? null)}
        providerId={computed(() => mapping.value.document.contentModel.providerId)}
        currentPins={computed(() => collectionQuery.value?.pins ?? [])}
        publication={computed(() => collectionQuery.value?.publication ?? "published-only")}
        onSave={(pins) => run(() => controller.setCollectionPins(pins))}
        onClose={() => { pinPickerOpen.value = false; }}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </EditorChrome>
  );
}
