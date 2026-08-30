/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Schema-driven Composer inspector panel (issue Takazudo/zudo-sg#249) — the presentational
// component that plugs into Takazudo/zudo-sg#247's `ComposerWorkspace` `inspector` slot.
// Purely presentational over the shared Takazudo/zudo-sg#245 document model + Takazudo/zudo-sg#247
// controller contracts: it reads `document`/`manifest`/`selectedId`/`mode`
// and reports every mutation through typed callbacks, never touching
// commands/storage itself.
//
// Layered behaviour:
//  - identity + breadcrumb + slot counts are derived, read-only views over
//    the document, built with the headless traversal/diagnostics
//    API (`findLocation`, `classifyNode`, `orderedSlotIds`) — never a second
//    tree/index implementation;
//  - editable fields are declared ONLY by the selected node's manifest entry
//    (`entry.fields`). Nodes blocked solely by invalid persisted prop values
//    retain those fields as a recovery path; every other opaque/unknown node
//    renders zero fields and only its diagnostics + raw identity. Sibling
//    move/remove stay available for opaque nodes (they act on the SLOT
//    array, not the node's own props);
//  - Preview/read-only mode keeps the same selection/values on screen but
//    disables every control, so switching back to Edit never loses what was
//    selected.

import type { JSX } from "preact";
import type {
  ComponentCatalog,
  CompositionDocument,
  CompositionNode,
  JsonObject,
  LinkedEditorLifecycleActions,
  LinkedEditorPresentation,
} from "../../../../composer/browser";
import { canRepairNodeProps, classifyNode, findLocation, orderedSlotIds } from "../../../../composer/browser";
import {
  ArrowRightIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  RefreshIcon,
  TrashIcon,
  XMarkIcon,
} from "../../../../components/icons";
import type { ComposerMode } from "../../chrome/controller-model";
import type { PropPath, PropCoalescing } from "../../chrome/history-model";
import { InspectorField } from "./inspector-field";
import { ReuseControls } from "./reuse-controls";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";

export interface InspectorPanelProps {
  document: CompositionDocument;
  manifest: ComponentCatalog;
  selectedId: string | null;
  mode: ComposerMode;
  onUpdateProps: (
    nodeId: string,
    patch: JsonObject,
    coalescePaths?: PropCoalescing,
    removeProps?: readonly string[],
  ) => void;
  /**
   * Debounced commit channel for PER-KEYSTREAM fields — text/color/number
   * (issue Takazudo/zudo-sg#291). When absent, those fields fall back to `onUpdateProps`
   * (immediate), so presentational usage/tests need no extra wiring. Discrete
   * controls (checkbox/select) always commit through `onUpdateProps` — they
   * are single commit points with nothing to coalesce, per the resizer's
   * live-vs-commit philosophy.
   */
  onUpdatePropsDebounced?: (nodeId: string, patch: JsonObject, coalescePaths?: PropCoalescing) => void;
  /** Synchronously land any debounce-pending commit (issue Takazudo/zudo-sg#291) — fields call it on blur. */
  onFlushPendingProps?: () => void;
  onReorder: (nodeId: string, direction: "up" | "down") => void;
  onRemove: (nodeId: string) => void;
  /** Publish the current non-empty document as a saved Pattern. */
  onPublishPattern?: () => void;
  /** Provider-guarded source-role removal. The caller must not clear optimistically. */
  onClearPublication?: () => Promise<ReuseAuthoringActionResult>;
  /** Latest typed controller error (e.g. protected outlet-owner removal). */
  lastError?: string | null;
  /**
   * Optional friendlier display name for a component id — e.g. sourced from
   * the host's richer `activeComponentManifest` (title/category/description), which
   * this component's own `ComponentCatalog` contract does not carry. Falls
   * back to the raw, stable `componentId`.
   */
  titleFor?: (componentId: string) => string | undefined;
  /** Document-level link state; selection and fields remain local-only. */
  linkedPresentation?: LinkedEditorPresentation;
  /** Lifecycle callbacks are injected by the provider-owning app. */
  linkedActions?: LinkedEditorLifecycleActions;
}

interface BreadcrumbStep {
  key: string;
  label: string;
}

function buildBreadcrumb(
  document: CompositionDocument,
  manifest: ComponentCatalog,
  selectedId: string,
  titleFor: ((componentId: string) => string | undefined) | undefined,
): BreadcrumbStep[] {
  const chain: { node: CompositionNode; slotId: string }[] = [];
  let loc = findLocation(document, manifest, selectedId);
  while (loc && loc.parentId !== null) {
    const parentLoc = findLocation(document, manifest, loc.parentId);
    if (!parentLoc) break;
    chain.push({ node: parentLoc.node, slotId: loc.slotId });
    loc = parentLoc;
  }
  chain.reverse();
  const steps = chain.map(({ node, slotId }) => {
    const entry = manifest.get(node.componentId);
    const slot = entry?.slots.find((s) => s.id === slotId);
    const title = titleFor?.(node.componentId) ?? node.componentId;
    return { key: node.id, label: `${title} › ${slot?.label ?? slotId}` };
  });
  return [{ key: "root", label: "Root" }, ...steps];
}

function LinkedInspectorStatus({
  presentation,
  actions,
}: {
  presentation: LinkedEditorPresentation;
  actions?: LinkedEditorLifecycleActions;
}): JSX.Element | null {
  if (presentation.state === "local") return null;
  if (presentation.state === "resolved") {
    return (
      <section class="sg-composer-linked-frame sg-composer-inspector-section" data-sg-linked-frame="resolved">
        <p class="text-small font-semibold text-fg">Linked Global template</p>
        <p class="text-caption text-muted">
          {presentation.sourceName} · Outlet: {presentation.outletLabel || presentation.outletId} · Locked
        </p>
        <div class="mt-vsp-3xs flex flex-wrap gap-hsp-2xs">
          {actions?.onOpenSource && (
            <button type="button" class="sg-composer-toolbar-button" onClick={() => actions.onOpenSource?.(presentation.sourceRecordId)}>
              <ArrowRightIcon size="sm" class="sg-composer-button-icon" />
              Open source
            </button>
          )}
          {actions?.onDetach && (
            <button type="button" class="sg-composer-toolbar-button" onClick={() => actions.onDetach?.()}>
              <XMarkIcon size="sm" class="sg-composer-button-icon" />
              Detach
            </button>
          )}
        </div>
      </section>
    );
  }
  return (
    <section class="sg-composer-linked-frame sg-composer-inspector-section" data-sg-linked-frame="blocked" role="status">
      <p class="text-small font-semibold text-fg">Linked template unavailable</p>
      <p class="text-caption text-muted">{presentation.message}</p>
      <div class="mt-vsp-3xs flex flex-wrap gap-hsp-2xs">
        {actions?.onRetry && (
          <button type="button" class="sg-composer-toolbar-button" onClick={() => actions.onRetry?.()}>
            <RefreshIcon size="sm" class="sg-composer-button-icon" />
            Retry
          </button>
        )}
        {actions?.onOpenSource && (
          <button type="button" class="sg-composer-toolbar-button" onClick={() => actions.onOpenSource?.(presentation.sourceRecordId)}>
            <ArrowRightIcon size="sm" class="sg-composer-button-icon" />
            Open source
          </button>
        )}
        {actions?.onRemoveBrokenBinding && (
          <button type="button" class="sg-composer-toolbar-button sg-composer-inspector-remove" onClick={() => actions.onRemoveBrokenBinding?.()}>
            <TrashIcon size="sm" class="sg-composer-button-icon" />
            Remove broken binding
          </button>
        )}
      </div>
    </section>
  );
}

export function InspectorPanel({
  document,
  manifest,
  selectedId,
  mode,
  onUpdateProps,
  onUpdatePropsDebounced,
  onFlushPendingProps,
  onReorder,
  onRemove,
  onPublishPattern = () => undefined,
  onClearPublication = async () => ({
    status: "unavailable" as const,
    message: "Publication changes need a current relationship check before they can be cleared.",
  }),
  lastError = null,
  titleFor,
  linkedPresentation = { state: "local" },
  linkedActions,
}: InspectorPanelProps): JSX.Element {
  const readOnly = mode === "preview";
  const location = selectedId !== null ? findLocation(document, manifest, selectedId) : undefined;

  if (selectedId === null || !location) {
    return (
      <div class="flex h-full flex-col gap-vsp-2xs p-hsp-md py-[10px]" data-sg-inspector-state="empty">
        <LinkedInspectorStatus presentation={linkedPresentation} actions={linkedActions} />
        <ReuseControls
          document={document}
          manifest={manifest}
          mode={mode}
          lastError={lastError}
          onPublishPattern={onPublishPattern}
          onClearPublication={onClearPublication}
        />
        <p class="text-small font-semibold text-fg">Nothing selected</p>
        <p class="text-small text-muted">
          {document.root.length === 0
            ? "The composition is empty. Add a component from the structure panel to start editing."
            : "Select a component in the canvas or structure tree to edit its properties."}
        </p>
      </div>
    );
  }

  const node = location.node;
  const diagnostic = classifyNode(node, manifest);
  const entry = manifest.get(node.componentId);
  const canRepairProps = entry !== undefined && canRepairNodeProps(diagnostic);
  const fieldsEditable = !diagnostic.opaque || canRepairProps;
  const breadcrumb = buildBreadcrumb(document, manifest, selectedId, titleFor);
  const title = titleFor?.(node.componentId) ?? node.componentId;

  const siblingArray =
    location.parentId === null
      ? document.root
      : (findLocation(document, manifest, location.parentId)?.node.slots[location.slotId] ?? []);
  const canMoveUp = location.index > 0;
  const canMoveDown = location.index < siblingArray.length - 1;
  const slotIds = orderedSlotIds(node, entry);

  return (
    <div
      class="flex h-full flex-col overflow-y-auto p-hsp-md py-[10px]"
      data-sg-inspector-state={canRepairProps ? "recoverable" : diagnostic.opaque ? "opaque" : "editable"}
    >
      <LinkedInspectorStatus presentation={linkedPresentation} actions={linkedActions} />
      <ReuseControls
        document={document}
        manifest={manifest}
        mode={mode}
        lastError={lastError}
        onPublishPattern={onPublishPattern}
        onClearPublication={onClearPublication}
      />
      <nav class="sg-composer-inspector-section" aria-label="Selected component location">
        <ol class="flex flex-wrap items-center gap-hsp-3xs text-caption text-muted">
          {breadcrumb.map((step, i) => (
            <li key={step.key} class="flex items-center gap-hsp-3xs">
              {i > 0 && <span aria-hidden="true">/</span>}
              {step.label}
            </li>
          ))}
        </ol>
      </nav>

      <div class="sg-composer-inspector-section flex flex-col gap-vsp-3xs" data-sg-inspector-identity>
        <p class="truncate text-small font-semibold text-fg">{title}</p>
        <p class="text-caption text-muted">
          {node.componentId} · v{node.componentVersion}
        </p>

        {readOnly && (
          <p class="text-caption text-muted" role="status">
            Preview mode — properties are read-only.
          </p>
        )}

        {diagnostic.opaque && (
          <div class="sg-composer-inspector-diagnostics" role="alert">
            <p class="sg-composer-inspector-diagnostics-title">
              {canRepairProps ? "This component has invalid properties. Review the declared fields below; output stays blocked until every listed issue is corrected." : "This component can't be edited."}
            </p>
            <ul class="list-disc pl-hsp-md">
              {diagnostic.reasons.map((reason, i) => (
                <li key={`${reason.code}-${i}`}>{reason.message}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div class="sg-composer-inspector-section flex flex-wrap items-center gap-hsp-xs">
        <button
          type="button"
          class="sg-composer-toolbar-button gap-hsp-3xs"
          disabled={readOnly || !canMoveUp}
          onClick={() => onReorder(node.id, "up")}
        >
          <ChevronUpIcon size="sm" />
          Move up
        </button>
        <button
          type="button"
          class="sg-composer-toolbar-button gap-hsp-3xs"
          disabled={readOnly || !canMoveDown}
          onClick={() => onReorder(node.id, "down")}
        >
          <ChevronDownIcon size="sm" />
          Move down
        </button>
        <button
          type="button"
          class="sg-composer-toolbar-button sg-composer-inspector-remove gap-hsp-3xs"
          disabled={readOnly}
          onClick={() => onRemove(node.id)}
        >
          <TrashIcon size="sm" />
          Remove
        </button>
      </div>

      {fieldsEditable && entry && entry.fields.length > 0 && (
        <div class="sg-composer-inspector-section flex flex-col gap-vsp-xs">
          {entry.fields.map((field) => (
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
        </div>
      )}

      {slotIds.length > 0 && (
        <div class="sg-composer-inspector-section" data-sg-inspector-slots>
          <p class="sg-composer-inspector-slots-heading text-small font-semibold text-fg">Slots</p>
          <ul class="mt-vsp-xs flex flex-col gap-vsp-3xs text-small text-fg">
            {slotIds.map((slotId) => {
              const slot = entry?.slots.find((s) => s.id === slotId);
              const count = (node.slots[slotId] ?? []).length;
              return (
                <li key={slotId}>
                  {slot?.label ?? slotId} — {count} {count === 1 ? "child" : "children"}
                  {slot?.cardinality === "single" ? " (single)" : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
