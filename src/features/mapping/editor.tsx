/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { useBreadcrumb, type EditorStatus } from "../../app/chrome-context";
import { formatIntent } from "../../app/route-intents";
import { EditorBody, EditorChrome, RecordTitle } from "../../components/editor-chrome";
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
import { useLibraryConfirm } from "../../components/library-page";
import { ConfirmDialog, Menu, MenuItem, MenuSeparator, useMenu } from "../../components/overlay";
import { Banner, Button } from "../../components/ui";
import { formatComposerRoute } from "../composer/routing";
import type { ComposerComponentProvider } from "../composer/component-provider";
import { BindingsPane } from "./bindings-pane";
import type { MappingEditorController, MappingEditorState, MappingSaveStatus } from "./controller";
import { MAPPING_ROUTE, mappingDeepLinkHref } from "./deep-link";
import { InspectorPane, type MappingInspectorTab } from "./inspector-pane";
import { buildBindingRows, firstCompatibleTransform, refKey } from "./presentation";
import { RecordPickerDialog } from "./record-picker-dialog";
import { SourcePane } from "./source-pane";

// The Mapping editor on the shared record chrome: back, an inline-editable
// name, the source/target pair in the centre, and Test + Save on the right.
// Test no longer opens a modal — it re-runs the evaluation and brings the
// Diagnostics tab forward, which is where the answer already lives.

type PickerKind = "content" | "composition";

export interface MappingEditorProps {
  state: MappingEditorState;
  controller: MappingEditorController;
  componentProvider: ComposerComponentProvider;
  /** Route transitions this editor owns: back, duplicate and delete. */
  navigate: (href: string) => void;
  /** Reports a rejected action without unmounting the editor. */
  error: string | null;
  run: (action: () => void | Promise<void>) => void;
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

export function MappingEditor({
  state,
  controller,
  componentProvider,
  navigate,
  error,
  run,
}: MappingEditorProps): JSX.Element {
  const mapping = state.mapping!;
  const [pane, setPane] = useState<EditorPane>("main");
  const [tab, setTab] = useState<MappingInspectorTab>("preview");
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const confirm = useLibraryConfirm();
  const overflowRef = useRef<HTMLButtonElement | null>(null);
  const overflow = useMenu(overflowRef, { align: "end" });

  useBreadcrumb([{ label: "Mappings", href: MAPPING_ROUTE }, { label: mapping.document.name }]);

  const rows = useMemo(() => buildBindingRows(mapping, state.definition), [mapping, state.definition]);
  const modelName = state.definition?.contentModel?.document.name
    ?? state.contentModels.find((entry) => refKey(entry.ref) === refKey(mapping.document.contentModel))?.summary.name
    ?? mapping.document.contentModel.recordId;
  const compositionName = state.definition?.composition?.document.name
    ?? state.compositions.find((entry) => refKey(entry.ref) === refKey(mapping.document.composition))?.summary.name
    ?? mapping.document.composition.recordId;

  /** Show the answer where it lives: re-evaluate, then bring Diagnostics forward. */
  const test = () => run(async () => {
    await controller.testDefinition();
    setTab("diagnostics");
    setPane("insp");
  });

  const bind = (sourceFieldId: string, target: { nodeId: string; prop: string }) =>
    run(() => controller.addBinding(sourceFieldId, target));

  const rebind = (bindingId: string, sourceFieldId: string) => run(() => {
    const row = rows.find((candidate) => candidate.binding.id === bindingId);
    const field = state.definition?.contentModel?.document.fields.find((candidate) => candidate.id === sourceFieldId);
    // The menu only ever offers compatible sources, so a transform exists;
    // keeping the stored one would leave the row broken in a new way.
    const transform = row?.target && field ? firstCompatibleTransform(field.kind, row.target) : null;
    return controller.updateBinding(bindingId, { sourceFieldId, ...(transform ? { transform } : {}) });
  });

  const askDelete = () => confirm.request({
    title: `Delete ${mapping.document.name}?`,
    message: "Its bindings go with it. The Content model and the Composition are untouched. This cannot be undone.",
    confirmLabel: "Delete",
    tone: "danger",
    onConfirm: () => run(async () => {
      await controller.delete(mapping.id);
      navigate(MAPPING_ROUTE);
    }),
  });

  return (
    <EditorChrome
      editorKey="mapping"
      class="cms-mapping-editor"
      back={{ href: MAPPING_ROUTE, label: "Back to Mappings" }}
      title={<RecordTitle value={mapping.document.name} label="Mapping name" onCommit={(name) => controller.rename(name)} />}
      status={statusOf(state.saveStatus, state.message, () => run(() => controller.retrySave()))}
      dirty={state.saveStatus !== "saved"}
      paneLabels={{ nav: "Fields", main: "Bindings", insp: "Inspector" }}
      activePane={pane}
      onActivePaneChange={setPane}
      center={
        <>
          <Button size="sm" aria-label={`Content model: ${modelName}`} onClick={() => setPicker("content")}>
            <ContentIcon size="sm" />
            <span class="cms-mapping-pick__name">{modelName}</span>
            <ChevronDownIcon size="xs" />
          </Button>
          <ArrowRightIcon size="sm" class="cms-mapping-pick__arrow" aria-hidden="true" />
          <Button size="sm" aria-label={`Composition: ${compositionName}`} onClick={() => setPicker("composition")}>
            <ComposerIcon size="sm" />
            <span class="cms-mapping-pick__name">{compositionName}</span>
            <ChevronDownIcon size="xs" />
          </Button>
        </>
      }
      right={
        <>
          <Button onClick={test}>
            <PlayIcon size="sm" />
            Test
          </Button>
          <Button
            variant="primary"
            disabled={state.saveStatus === "saved" || state.saveStatus === "saving"}
            onClick={() => run(() => controller.flush())}
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
            <MenuItem
              icon={DuplicateIcon}
              onSelect={() => run(async () => {
                const id = await controller.duplicate(mapping.id);
                navigate(mappingDeepLinkHref({ providerId: controller.provider.descriptor.id, mappingId: id }));
              })}
            >
              Duplicate mapping
            </MenuItem>
            <MenuItem icon={ContentIcon} href={formatIntent({ route: "content", modelId: mapping.document.contentModel.recordId })}>
              Open in Content
            </MenuItem>
            <MenuItem
              icon={ComposerIcon}
              href={formatComposerRoute({ kind: "detail", providerId: mapping.document.composition.providerId, recordId: mapping.document.composition.recordId })}
            >
              Open composition
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={TrashIcon} tone="danger" onSelect={askDelete}>
              Delete…
            </MenuItem>
          </Menu>
        </>
      }
    >
      <EditorBody
        navLabel="Source fields"
        inspectorLabel="Inspector"
        nav={
          <SourcePane
            state={state}
            rows={rows}
            onBind={bind}
            onSelectEntry={(entryId) => run(() => controller.selectEntry(entryId))}
          />
        }
        main={
          <BindingsPane
            state={state}
            rows={rows}
            notice={error ? <Banner tone="err">{error}</Banner> : null}
            onBind={bind}
            onRebind={rebind}
            onTransform={(bindingId, transform) => run(() => controller.updateBinding(bindingId, { transform }))}
            onMove={(bindingId, direction) => run(() => controller.moveBinding(bindingId, direction))}
            onRemove={(bindingId) => run(() => controller.removeBinding(bindingId))}
          />
        }
        inspector={
          <InspectorPane
            state={state}
            componentProvider={componentProvider}
            tab={tab}
            onTabChange={setTab}
            onPreviewCurrent={() => controller.setPreviewCurrent()}
            onPreviewError={(message) => controller.setPreviewError(message)}
          />
        }
      />
      <RecordPickerDialog
        open={picker === "content"}
        title="Choose a Content model"
        description="Bindings keep their source field ids; any that the new model does not carry are reported rather than dropped."
        searchLabel="Filter Content models"
        currentKey={refKey(mapping.document.contentModel)}
        emptyMessage="No Content models are available."
        entries={state.contentModels.map((entry) => ({
          key: refKey(entry.ref),
          name: entry.summary.name,
          detail: `${entry.summary.kind} · ${entry.providerLabel} · ${entry.ref.recordId}`,
          icon: ContentIcon,
        }))}
        onSelect={(key) => run(() => {
          const entry = state.contentModels.find((candidate) => refKey(candidate.ref) === key);
          return entry ? controller.selectContentModel(entry.ref) : Promise.resolve();
        })}
        onClose={() => setPicker(null)}
      />
      <RecordPickerDialog
        open={picker === "composition"}
        title="Choose a Composition"
        description="Bindings keep their target props; any the new Composition does not carry are reported rather than dropped."
        searchLabel="Filter Compositions"
        currentKey={refKey(mapping.document.composition)}
        emptyMessage="No Compositions are available."
        entries={state.compositions.map((entry) => ({
          key: refKey(entry.ref),
          name: entry.summary.name,
          detail: `${entry.providerLabel} · ${entry.ref.recordId}`,
          icon: ComposerIcon,
        }))}
        onSelect={(key) => run(() => {
          const entry = state.compositions.find((candidate) => refKey(candidate.ref) === key);
          return entry ? controller.selectComposition(entry.ref) : Promise.resolve();
        })}
        onClose={() => setPicker(null)}
      />
      <ConfirmDialog {...confirm.dialogProps} />
    </EditorChrome>
  );
}
