/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer inspector: three tabs over one selection.
//
// Purely presentational over the shared document model and controller
// contracts — it reads `document`/`manifest`/`selectedId`/`mode` and reports
// every mutation through typed callbacks, never touching commands or storage.
//
// The tabs exist because the three things this pane carries answer different
// questions and used to be stacked: reuse guidance is document-scoped and was
// pushing the props an author came to edit below the fold, and the slot list is
// navigation rather than editing. Properties is what opens.
//
// Layered behaviour:
//  - identity, parent and position are derived, read-only views built with the
//    headless traversal/diagnostics API (`findLocation`, `classifyNode`,
//    `orderedSlotIds`) — never a second tree or index implementation;
//  - editable fields are declared ONLY by the selected node's manifest entry.
//    A node blocked solely by invalid persisted prop values keeps its fields as
//    a recovery path; any other opaque node renders its diagnostics and its raw
//    identity alone. Copy/Duplicate/Delete stay available for an opaque node —
//    they act on the slot array, not on the node's own props;
//  - Preview keeps the same selection and values on screen with every control
//    disabled, so switching back to Edit never loses what was selected.

import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import type {
  ComponentCatalog,
  CompositionDocument,
  GlobalTemplateOutletTarget,
  JsonObject,
  LinkedEditorLifecycleActions,
  LinkedEditorPresentation,
} from "../../../../composer/browser";
import { canRepairNodeProps, classifyNode, findLocation, orderedSlotIds } from "../../../../composer/browser";
import { RailCollapseButton } from "../../../../components/editor-chrome";
import { CopyIcon, DuplicateIcon, PlusIcon, SlotIcon, TrashIcon } from "../../../../components/icons";
import {
  Banner,
  Button,
  Chip,
  EmptyState,
  Pane,
  PaneBody,
  PaneHeader,
  PaneSection,
  PaneTabs,
} from "../../../../components/ui";
import type { PaneTab } from "../../../../components/ui";
import type { ComposerMode } from "../../chrome/controller-model";
import type { PropPath, PropCoalescing } from "../../chrome/history-model";
import type { SelectedSlot } from "../tree/structure-pane";
import { InspectorField, seedValue } from "./inspector-field";
import { ReuseControls } from "./reuse-controls";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";

type InspectorTab = "props" | "slots" | "reuse";

export interface InspectorPanelProps {
  document: CompositionDocument;
  manifest: ComponentCatalog;
  selectedId: string | null;
  /** The slot chosen in Structure, when the selected row is a slot. */
  selectedSlot?: SelectedSlot | null;
  mode: ComposerMode;
  onUpdateProps: (
    nodeId: string,
    patch: JsonObject,
    coalescePaths?: PropCoalescing,
    removeProps?: readonly string[],
  ) => void;
  /**
   * Debounced commit channel for PER-KEYSTREAM fields — text/color/number.
   * When absent, those fields fall back to `onUpdateProps` (immediate), so
   * presentational usage and tests need no extra wiring. Discrete controls
   * (checkbox/select) always commit through `onUpdateProps`.
   */
  onUpdatePropsDebounced?: (nodeId: string, patch: JsonObject, coalescePaths?: PropCoalescing) => void;
  /** Synchronously land any debounce-pending commit — fields call it on blur. */
  onFlushPendingProps?: () => void;
  onRemove: (nodeId: string) => void;
  onCopy?: (nodeId: string) => void;
  onDuplicate?: (nodeId: string) => void;
  /** Select one of the selected node's slots in Structure. */
  onJumpToSlot?: (slot: SelectedSlot) => void;
  /** Publish the current non-empty document as a saved Pattern. */
  onPublishPattern?: () => void;
  /** Provider-guarded source-role removal. The caller must not clear optimistically. */
  onClearPublication?: () => Promise<ReuseAuthoringActionResult>;
  /** Provider-checked publish/reassign for a real empty component slot. */
  onSetGlobalTemplateOutlet?: (
    target: GlobalTemplateOutletTarget,
    label: string,
  ) => Promise<ReuseAuthoringActionResult>;
  /** Latest typed controller error (e.g. protected outlet-owner removal). */
  lastError?: string | null;
  /**
   * Optional friendlier display name for a component id — e.g. from the host's
   * richer catalog, which this component's `ComponentCatalog` does not carry.
   * Falls back to the raw, stable `componentId`.
   */
  titleFor?: (componentId: string) => string | undefined;
  /** Document-level link state; selection and fields remain local-only. */
  linkedPresentation?: LinkedEditorPresentation;
  linkedActions?: LinkedEditorLifecycleActions;
}

/** The chain of `Component › slot` steps down to the selected node. */
function parentPath(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  selectedId: string,
  titleFor: ((componentId: string) => string | undefined) | undefined,
): string {
  const steps: string[] = [];
  let location = findLocation(document, manifest, selectedId);
  while (location && location.parentId !== null) {
    const parent = findLocation(document, manifest, location.parentId);
    if (!parent) break;
    const entry = manifest.get(parent.node.componentId);
    const slot = entry?.slots.find((candidate) => candidate.id === location!.slotId);
    steps.push(`${titleFor?.(parent.node.componentId) ?? parent.node.componentId} › ${slot?.label ?? location.slotId}`);
    location = parent;
  }
  steps.reverse();
  return steps.length === 0 ? "Document root" : steps.join(" / ");
}

function InspectorShell({
  title,
  version,
  tabs,
  activeTab,
  onSelectTab,
  children,
}: {
  title: ComponentChildren;
  version?: string | number;
  tabs: readonly PaneTab<InspectorTab>[];
  activeTab: InspectorTab;
  onSelectTab: (tab: InspectorTab) => void;
  children: ComponentChildren;
}): JSX.Element {
  return (
    <Pane label="Inspector">
      <PaneHeader
        title={title}
        actions={<RailCollapseButton rail="insp" />}
      >
        {version ? <Chip tone="plain">v{version}</Chip> : null}
      </PaneHeader>
      <PaneTabs label="Inspector" tabs={tabs} activeId={activeTab} onSelect={onSelectTab} />
      <PaneBody>{children}</PaneBody>
    </Pane>
  );
}

export function InspectorPanel({
  document,
  manifest,
  selectedId,
  selectedSlot = null,
  mode,
  onUpdateProps,
  onUpdatePropsDebounced,
  onFlushPendingProps,
  onRemove,
  onCopy,
  onDuplicate,
  onJumpToSlot,
  onPublishPattern = () => undefined,
  onClearPublication = async () => ({
    status: "unavailable" as const,
    message: "Publication changes need a current relationship check before they can be cleared.",
  }),
  onSetGlobalTemplateOutlet,
  lastError = null,
  titleFor,
  linkedPresentation = { state: "local" },
  linkedActions,
}: InspectorPanelProps): JSX.Element {
  const [requestedTab, setRequestedTab] = useState<InspectorTab>("props");
  const readOnly = mode === "preview";
  const location = selectedId !== null ? findLocation(document, manifest, selectedId) : undefined;
  const node = location?.node;
  const entry = node ? manifest.get(node.componentId) : undefined;
  const slotIds = node ? orderedSlotIds(node, entry) : [];

  const reuse = (
    <ReuseControls
      document={document}
      manifest={manifest}
      mode={mode}
      lastError={lastError}
      onPublishPattern={onPublishPattern}
      onClearPublication={onClearPublication}
      onSetGlobalTemplateOutlet={onSetGlobalTemplateOutlet}
      selectedSlot={
        selectedSlot && node
          ? {
            ...selectedSlot,
            label: entry?.slots.find((slot) => slot.id === selectedSlot.slotId)?.label ?? selectedSlot.slotId,
            empty: (node.slots[selectedSlot.slotId] ?? []).length === 0,
          }
          : null
      }
      linkedPresentation={linkedPresentation}
      linkedActions={linkedActions}
    />
  );

  // Resolved during render, not repaired in an effect: an effect runs after
  // paint, so a tab that no longer exists for the new selection would be shown
  // for a frame before it moved.
  const tabs: PaneTab<InspectorTab>[] = [
    { id: "props", label: "Properties" },
    { id: "slots", label: "Slots", count: slotIds.length, disabled: slotIds.length === 0 },
    { id: "reuse", label: "Reuse" },
  ];
  const activeTab: InspectorTab = requestedTab === "slots" && slotIds.length === 0 ? "props" : requestedTab;

  if (!node || !location) {
    return (
      <InspectorShell title="Inspector" tabs={tabs} activeTab={activeTab} onSelectTab={setRequestedTab}>
        <div data-sg-inspector-state="empty">
          {activeTab === "reuse" ? (
            reuse
          ) : (
            <EmptyState
              inline
              title="Nothing selected"
              description={
                document.root.length === 0
                  ? "The composition is empty. Add a component from Structure to start editing."
                  : "Select a component in the canvas or in Structure to edit its properties."
              }
            />
          )}
        </div>
      </InspectorShell>
    );
  }

  const diagnostic = classifyNode(node, manifest);
  const canRepairProps = entry !== undefined && canRepairNodeProps(diagnostic);
  const fieldsEditable = !diagnostic.opaque || canRepairProps;
  const fields = fieldsEditable && entry ? entry.fields : [];
  const present = fields.filter((field) => Object.hasOwn(node.props, field.prop) || field.required === true);
  const absentOptional = fields.filter((field) => !Object.hasOwn(node.props, field.prop) && field.required !== true);
  const title = titleFor?.(node.componentId) ?? node.componentId;

  const siblings =
    location.parentId === null
      ? document.root
      : (findLocation(document, manifest, location.parentId)?.node.slots[location.slotId] ?? []);

  return (
    <InspectorShell
      title={title}
      version={node.componentVersion}
      tabs={tabs}
      activeTab={activeTab}
      onSelectTab={setRequestedTab}
    >
      <div data-sg-inspector-state={canRepairProps ? "recoverable" : diagnostic.opaque ? "opaque" : "editable"}>
        {activeTab === "props" && (
          <>
            {readOnly && (
              <PaneSection title="Preview">
                <p class="sg-composer-inspector-note" role="status">
                  Preview mode — properties are read-only.
                </p>
              </PaneSection>
            )}

            {diagnostic.opaque && (
              <PaneSection title="Diagnostics">
                <Banner
                  tone="err"
                  title={
                    canRepairProps
                      ? "This component has invalid properties."
                      : "This component can't be edited."
                  }
                >
                  <ul class="sg-composer-inspector-diagnostics">
                    {diagnostic.reasons.map((reason, index) => (
                      <li key={`${reason.code}-${index}`}>{reason.message}</li>
                    ))}
                  </ul>
                </Banner>
              </PaneSection>
            )}

            {present.length > 0 && (
              <PaneSection title="Properties" class="sg-composer-inspector-props">
                {present.map((field) => (
                  <InspectorField
                    key={`${selectedId}:${field.prop}`}
                    field={field}
                    value={Object.hasOwn(node.props, field.prop) ? node.props[field.prop] : undefined}
                    disabled={readOnly}
                    onRemove={() => onUpdateProps(node.id, {}, null, [field.prop])}
                    onCommit={(value, path, structural) => {
                      const coalescePaths = structural ? null : path && path.length > 0 ? [path as PropPath] : undefined;
                      if (coalescePaths === undefined) onUpdateProps(node.id, { [field.prop]: value });
                      else onUpdateProps(node.id, { [field.prop]: value }, coalescePaths);
                    }}
                    onCommitDebounced={
                      onUpdatePropsDebounced &&
                      ((value, path, structural) => {
                        const coalescePaths = structural ? null : path && path.length > 0 ? [path as PropPath] : undefined;
                        if (coalescePaths === undefined) onUpdatePropsDebounced(node.id, { [field.prop]: value });
                        else onUpdatePropsDebounced(node.id, { [field.prop]: value }, coalescePaths);
                      })
                    }
                    onFlushPending={onFlushPendingProps}
                  />
                ))}
              </PaneSection>
            )}

            {absentOptional.length > 0 && (
              <PaneSection title="Optional props">
                <div class="sg-composer-inspector-optional">
                  {absentOptional.map((field) => {
                    const seed = seedValue(field);
                    return (
                      <Button
                        key={field.prop}
                        size="xs"
                        disabled={readOnly || seed === undefined}
                        aria-label={`Add ${field.label}`}
                        title={
                          seed === undefined
                            ? "This value has required fields with no deterministic seed."
                            : undefined
                        }
                        data-sg-inspector-optional-field={field.prop}
                        onClick={() => {
                          if (seed !== undefined) onUpdateProps(node.id, { [field.prop]: seed });
                        }}
                      >
                        <PlusIcon size="xs" />
                        {field.label}
                      </Button>
                    );
                  })}
                </div>
              </PaneSection>
            )}

            <PaneSection title="Node">
              <dl class="sg-composer-inspector-node">
                <dt>Component</dt>
                <dd><code>{node.componentId}</code></dd>
                <dt>ID</dt>
                <dd><code>{node.id}</code></dd>
                <dt>Parent</dt>
                <dd>{parentPath(document, manifest, node.id, titleFor)}</dd>
                <dt>Position</dt>
                <dd>{location.index + 1} of {siblings.length}</dd>
              </dl>
              <div class="sg-composer-inspector-node-actions">
                {onDuplicate && (
                  <Button size="sm" disabled={readOnly} onClick={() => onDuplicate(node.id)}>
                    <DuplicateIcon size="sm" />
                    Duplicate
                  </Button>
                )}
                {onCopy && (
                  <Button size="sm" disabled={readOnly} onClick={() => onCopy(node.id)}>
                    <CopyIcon size="sm" />
                    Copy
                  </Button>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  class="sg-composer-inspector-remove"
                  disabled={readOnly}
                  onClick={() => onRemove(node.id)}
                >
                  <TrashIcon size="sm" />
                  Delete
                </Button>
              </div>
              {lastError && (
                <p class="sg-composer-inspector-note" role="alert">{lastError}</p>
              )}
            </PaneSection>
          </>
        )}

        {activeTab === "slots" && (
          <PaneSection title="Slots">
            <ul class="sg-composer-inspector-slots" data-sg-inspector-slots>
              {slotIds.map((slotId) => {
                const slot = entry?.slots.find((candidate) => candidate.id === slotId);
                const count = (node.slots[slotId] ?? []).length;
                const label = slot?.label ?? slotId;
                return (
                  <li key={slotId} class="sg-composer-inspector-slot">
                    <SlotIcon size="sm" />
                    <span class="sg-composer-inspector-slot-name">{label}</span>
                    <span class="sg-composer-inspector-slot-meta">
                      {count} {count === 1 ? "child" : "children"}
                      {slot?.cardinality === "single" ? " · single" : ""}
                    </span>
                    {onJumpToSlot && (
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={`Jump to ${label}`}
                        onClick={() => onJumpToSlot({ parentId: node.id, slotId })}
                      >
                        Jump
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </PaneSection>
        )}

        {activeTab === "reuse" && reuse}
      </div>
    </InspectorShell>
  );
}
