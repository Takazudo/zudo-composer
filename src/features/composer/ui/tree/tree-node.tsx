/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// One recursive structure-rail row (issue Takazudo/zudo-sg#250): the component itself, its
// declared/preserved slots (in canonical model order — see
// `orderedSlotIds`), each slot's children, and empty-slot placeholders.
//
// Plain nested `<ul>`/`<li>` + real `<button>`s — deliberately NOT
// `role="tree"` (that would require full arrow-key navigation + roving
// tabindex, which this issue does not implement; see Takazudo/zudo-sg#250's acceptance
// criteria). Disclosure and selection are two separate buttons so both stay
// independently keyboard-operable via native Tab/Enter/Space.

import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import type {
  ComponentCatalog,
  CompositionDocument,
  CompositionNode,
  DocumentIndex,
  GlobalTemplateOutletTarget,
  InsertionTarget,
} from "../../../../composer/browser";
import { isPublishedOutletTarget, orderedSlotIds } from "../../../../composer/browser";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ContainerIcon,
  EditIcon,
  EllipsisIcon,
  LeafIcon,
  PlusIcon,
  SaveIcon,
  SlotIcon,
  XMarkIcon,
} from "../../../../components/icons";
import type { ComponentDefinition } from "../../active-pack";
import { countDescendants, siblingBounds, summarizeNode } from "./tree-helpers";
import { TreeRowActions } from "./tree-row-actions";
import type { ReuseAuthoringActionResult } from "../shared/reuse-authoring-contract";

export interface TreeNodeCallbacks {
  onReveal: (nodeId: string) => void;
  onToggleExpanded: (nodeId: string) => void;
  onOpenChooser: (target: InsertionTarget) => void;
  onReorder: (nodeId: string, direction: "up" | "down") => void;
  onRemove: (nodeId: string) => void;
  registerRowRef: (nodeId: string, element: HTMLButtonElement | null) => void;
  /** Opens the node context menu (Copy/Cut/Duplicate/Delete — issue Takazudo/zudo-sg#256). */
  onOpenNodeMenu: (nodeId: string, trigger: HTMLElement) => void;
  /** Opens the insert menu (Add component…/Paste here — issue Takazudo/zudo-sg#256), alongside the direct "+Add". */
  onOpenInsertMenu: (target: InsertionTarget, trigger: HTMLElement) => void;
  onSetGlobalTemplateOutlet?: (
    target: GlobalTemplateOutletTarget,
    label: string,
  ) => Promise<ReuseAuthoringActionResult>;
}

export interface TreeNodeProps extends TreeNodeCallbacks {
  node: CompositionNode;
  document: CompositionDocument;
  manifest: ComponentCatalog;
  catalogById: ReadonlyMap<string, ComponentDefinition>;
  index: DocumentIndex;
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  readOnly: boolean;
}

function childListId(nodeId: string): string {
  return `sg-composer-tree-children-${nodeId}`;
}

export function TreeNode(props: TreeNodeProps): JSX.Element {
  const { node, document, manifest, catalogById, index, selectedId, expandedIds, readOnly } = props;
  const { onReveal, onToggleExpanded, onOpenChooser, onReorder, onRemove, registerRowRef } = props;
  const { onOpenNodeMenu, onOpenInsertMenu } = props;
  const { onSetGlobalTemplateOutlet } = props;

  const [outletDraft, setOutletDraft] = useState<{ slotId: string; label: string } | null>(null);
  const [outletBusy, setOutletBusy] = useState(false);
  const [outletFeedback, setOutletFeedback] = useState<string | null>(null);
  const [outletLabelError, setOutletLabelError] = useState<string | null>(null);
  const [returnFocusSlot, setReturnFocusSlot] = useState<string | null>(null);
  const outletInputRef = useRef<HTMLInputElement | null>(null);
  const outletTriggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const entry = manifest.get(node.componentId);
  const summary = summarizeNode(node, manifest, catalogById);
  // The title alone collides across duplicate component instances (e.g. two
  // "Box" leaves) — every accessible name below uses this combined form so
  // assistive tech (and stable-id-keyed tests) can tell rows apart.
  const displayName = summary.subtitle ? `${summary.title} ${summary.subtitle}` : summary.title;
  const slotIds = orderedSlotIds(node, entry);
  const hasSlots = slotIds.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isSelected = selectedId === node.id;
  const bounds = siblingBounds(document, index, node.id);
  const descendantCount = countDescendants(node);
  const publication = document.publication;
  const isGlobalTemplate = publication?.kind === "global-template";

  useEffect(() => {
    if (outletDraft) outletInputRef.current?.focus();
  }, [outletDraft?.slotId]);

  useEffect(() => {
    if (outletDraft || returnFocusSlot === null) return;
    const timeout = setTimeout(() => {
      outletTriggerRefs.current.get(returnFocusSlot)?.focus();
      setReturnFocusSlot(null);
    }, 0);
    return () => clearTimeout(timeout);
  }, [outletDraft, returnFocusSlot]);

  function closeOutletEditor(): void {
    setReturnFocusSlot(outletDraft?.slotId ?? null);
    setOutletDraft(null);
    setOutletLabelError(null);
  }

  function outletTriggerRef(slotId: string) {
    return (element: HTMLButtonElement | null) => {
      if (element) outletTriggerRefs.current.set(slotId, element);
    };
  }

  async function saveOutlet(target: GlobalTemplateOutletTarget, label: string): Promise<void> {
    if (!onSetGlobalTemplateOutlet) return;
    if (label.trim().length === 0) {
      setOutletLabelError("Enter an outlet label before publishing.");
      outletInputRef.current?.focus();
      return;
    }
    setOutletBusy(true);
    setOutletFeedback(null);
    try {
      const result = await onSetGlobalTemplateOutlet(target, label.trim());
      if (result.status === "applied") {
        setOutletDraft(null);
        setOutletLabelError(null);
        if (result.message) setOutletFeedback(result.message);
      } else {
        setOutletFeedback(result.message);
      }
    } finally {
      setOutletBusy(false);
    }
  }

  return (
    <li class="sg-composer-tree-node" data-sg-tree-node-id={node.id}>
      <div
        class={`sg-composer-tree-row ${
          hasSlots ? "sg-composer-tree-row-container" : "sg-composer-tree-row-leaf"
        }`}
        data-sg-selected={isSelected}
        data-sg-tree-branch-open={hasSlots && isExpanded ? "true" : undefined}
      >
        {hasSlots ? (
          <button
            type="button"
            class="sg-composer-tree-disclosure"
            aria-expanded={isExpanded}
            aria-controls={childListId(node.id)}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${displayName}`}
            onClick={() => onToggleExpanded(node.id)}
          >
            {isExpanded ? <ChevronDownIcon size="xs" /> : <ChevronRightIcon size="xs" />}
          </button>
        ) : (
          <span class="sg-composer-tree-disclosure-spacer" aria-hidden="true" />
        )}

        <button
          ref={(el) => registerRowRef(node.id, el)}
          type="button"
          class="sg-composer-tree-select"
          aria-pressed={isSelected}
          data-sg-opaque={summary.opaque}
          title={summary.reasonText ?? undefined}
          onClick={() => onReveal(node.id)}
        >
          {hasSlots ? (
            <ContainerIcon size="xs" class="sg-composer-tree-node-icon" />
          ) : (
            <LeafIcon size="xs" class="sg-composer-tree-node-icon" />
          )}
          <span class="sg-composer-tree-select-title">{summary.title}</span>
          {summary.subtitle && (
            <>
              {" "}
              <span class="sg-composer-tree-select-subtitle">{summary.subtitle}</span>
            </>
          )}
          {summary.opaque && (
            <>
              {" "}
              <span class="sg-composer-tree-badge" data-sg-tree-badge="unavailable">
                Unavailable
              </span>
            </>
          )}
          {descendantCount > 0 && (
            <span class="sg-composer-tree-count" aria-hidden="true">
              {descendantCount}
            </span>
          )}
        </button>

        <TreeRowActions
          nodeTitle={displayName}
          descendantCount={descendantCount}
          canMoveUp={bounds.canMoveUp}
          canMoveDown={bounds.canMoveDown}
          readOnly={readOnly}
          onMoveUp={() => onReorder(node.id, "up")}
          onMoveDown={() => onReorder(node.id, "down")}
          onRemove={() => onRemove(node.id)}
        />

        {!readOnly && (
          <button
            type="button"
            class="sg-composer-tree-action sg-composer-tree-menu-trigger"
            aria-label={`Open menu for ${displayName}`}
            title="More actions"
            onClick={(event) => onOpenNodeMenu(node.id, event.currentTarget as HTMLElement)}
          >
            <EllipsisIcon size="xs" />
          </button>
        )}
      </div>

      {hasSlots && isExpanded && (
        <div class="sg-composer-tree-slots">
          {slotIds.map((slotId) => {
            const slotMeta = entry?.slots.find((s) => s.id === slotId);
            const children = node.slots[slotId] ?? [];
            const label = slotMeta?.label ?? `${slotId} (unavailable)`;
            const cardinalityLabel =
              slotMeta === undefined ? null : slotMeta.cardinality === "single" ? "Single" : "Multiple";
            const outletTarget = { parentId: node.id, slotId };
            const isTemplateOutlet = isPublishedOutletTarget(document, node.id, slotId);
            const canAdd =
              !readOnly &&
              !summary.opaque &&
              slotMeta !== undefined &&
              !isTemplateOutlet &&
              !(slotMeta.cardinality === "single" && children.length >= 1);
            const canAuthorOutlet =
              !readOnly &&
              onSetGlobalTemplateOutlet !== undefined &&
              document.binding === undefined &&
              publication?.kind !== "pattern" &&
              !summary.opaque &&
              slotMeta !== undefined &&
              children.length === 0 &&
              !isTemplateOutlet;
            const canRenameOutlet =
              !readOnly &&
              onSetGlobalTemplateOutlet !== undefined &&
              isTemplateOutlet &&
              isGlobalTemplate;
            const editingOutlet = outletDraft?.slotId === slotId;

            return (
              <div class="sg-composer-tree-slot" key={slotId} data-sg-tree-slot-id={slotId}>
                <div
                  class="sg-composer-tree-slot-header"
                  data-sg-tree-branch-open={children.length > 0 ? "true" : undefined}
                >
                  <span
                    class="sg-composer-tree-disclosure-spacer sg-composer-tree-slot-spacer"
                    aria-hidden="true"
                  />
                  <span class="sg-composer-tree-slot-label">
                    <SlotIcon size="xs" class="sg-composer-tree-node-icon" />
                    <span class="sg-composer-tree-slot-kind">Slot</span>
                    <span class="sg-composer-tree-slot-name">{label}</span>
                    {cardinalityLabel && (
                      <span class="sg-composer-tree-slot-cardinality">{cardinalityLabel}</span>
                    )}
                  </span>
                  <span class="sg-composer-tree-slot-controls">
                    <span
                      class="sg-composer-tree-count"
                      aria-label={`${children.length} component${children.length === 1 ? "" : "s"}`}
                    >
                      {children.length}
                    </span>
                    {isTemplateOutlet && isGlobalTemplate && (
                      <>
                        <span class="sg-composer-tree-badge" data-sg-tree-badge="template-outlet">
                          Template outlet{publication!.outlet.label ? `: ${publication!.outlet.label}` : ""}
                        </span>
                        {canRenameOutlet && !editingOutlet && (
                          <button
                            type="button"
                            ref={outletTriggerRef(slotId)}
                            class="sg-composer-tree-action"
                            aria-label={`Rename ${label} template outlet`}
                            onClick={() => {
                              setOutletFeedback(null);
                              setOutletLabelError(null);
                              setOutletDraft({ slotId, label: publication!.outlet.label });
                            }}
                          >
                            <EditIcon size="xs" class="sg-composer-button-icon" />
                            Rename outlet
                          </button>
                        )}
                      </>
                    )}
                    {canAuthorOutlet && !editingOutlet && (
                      <button
                        type="button"
                        ref={outletTriggerRef(slotId)}
                        class="sg-composer-tree-action"
                        aria-label={`${isGlobalTemplate ? "Reassign" : "Use"} ${label} as template outlet`}
                        onClick={() => {
                          setOutletFeedback(null);
                          setOutletLabelError(null);
                          setOutletDraft({ slotId, label: isGlobalTemplate ? publication!.outlet.label : label });
                        }}
                      >
                        <PlusIcon size="xs" class="sg-composer-button-icon" />
                        {isGlobalTemplate ? "Reassign template outlet" : "Use as template outlet"}
                      </button>
                    )}
                    {canAdd && (
                      <span class="sg-composer-tree-slot-add-group">
                        <button
                          type="button"
                          class="sg-composer-tree-action sg-composer-tree-add"
                          aria-label={`Add component to ${label} in ${displayName}`}
                          onClick={() => onOpenChooser({ parentId: node.id, slotId, index: children.length })}
                        >
                          <PlusIcon size="xs" class="sg-composer-button-icon" />
                          <span>Add</span>
                        </button>
                        <button
                          type="button"
                          class="sg-composer-tree-action sg-composer-tree-insert-menu"
                          aria-label={`Insert options for ${label} in ${displayName}`}
                          title="Insert options"
                          onClick={(event) =>
                            onOpenInsertMenu(
                              { parentId: node.id, slotId, index: children.length },
                              event.currentTarget as HTMLElement,
                            )
                          }
                        >
                          <EllipsisIcon size="xs" />
                        </button>
                      </span>
                    )}
                  </span>
                </div>

                {editingOutlet && (
                  <div class="flex flex-wrap items-end gap-hsp-2xs px-hsp-sm pb-vsp-3xs" data-sg-template-outlet-control>
                    <label class="flex flex-col gap-vsp-3xs text-caption text-muted">
                      <span>Outlet label</span>
                      <input
                        ref={outletInputRef}
                        class="sg-composer-inspector-control border border-border rounded-md bg-surface px-hsp-xs py-vsp-3xs text-fg"
                        type="text"
                        value={outletDraft.label}
                        disabled={outletBusy}
                        aria-invalid={outletLabelError ? "true" : undefined}
                        aria-describedby={outletLabelError ? `sg-template-outlet-error-${node.id}` : undefined}
                        onInput={(event) => {
                          setOutletLabelError(null);
                          setOutletDraft({ slotId, label: event.currentTarget.value });
                        }}
                      />
                    </label>
                    {outletLabelError && (
                      <p id={`sg-template-outlet-error-${node.id}`} class="text-caption text-danger" role="alert">
                        {outletLabelError}
                      </p>
                    )}
                    <button
                      type="button"
                      class="sg-composer-tree-action"
                      disabled={outletBusy}
                      onClick={() => void saveOutlet(outletTarget, outletDraft.label)}
                    >
                      <SaveIcon size="xs" class="sg-composer-button-icon" />
                      {outletBusy
                        ? "Saving outlet…"
                        : isTemplateOutlet
                          ? "Save outlet label"
                          : isGlobalTemplate
                            ? "Save reassignment"
                            : "Publish template"}
                    </button>
                    <button
                      type="button"
                      class="sg-composer-tree-action"
                      disabled={outletBusy}
                      onClick={closeOutletEditor}
                    >
                      <XMarkIcon size="xs" class="sg-composer-button-icon" />
                      Cancel
                    </button>
                  </div>
                )}

                {children.length === 0 ? (
                  <p class="sg-composer-tree-empty">Empty slot</p>
                ) : (
                  <ul id={childListId(node.id)} class="sg-composer-tree-list sg-composer-tree-list-nested">
                    {children.map((child) => (
                      <TreeNode
                        key={child.id}
                        node={child}
                        document={document}
                        manifest={manifest}
                        catalogById={catalogById}
                        index={index}
                        selectedId={selectedId}
                        expandedIds={expandedIds}
                        readOnly={readOnly}
                        onReveal={onReveal}
                        onToggleExpanded={onToggleExpanded}
                        onOpenChooser={onOpenChooser}
                        onReorder={onReorder}
                        onRemove={onRemove}
                        registerRowRef={registerRowRef}
                        onOpenNodeMenu={onOpenNodeMenu}
                        onOpenInsertMenu={onOpenInsertMenu}
                        onSetGlobalTemplateOutlet={onSetGlobalTemplateOutlet}
                      />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {outletFeedback && (
            <p class="sg-composer-tree-empty" role="status" data-sg-template-outlet-feedback>{outletFeedback}</p>
          )}
        </div>
      )}
    </li>
  );
}
