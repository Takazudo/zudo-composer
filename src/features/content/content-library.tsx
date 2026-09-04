import type { JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { RailCollapseButton, useEditorChrome } from "../../components/editor-chrome";
import { CopyIcon, DuplicateIcon, EllipsisIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { OutlineTree, type OutlineInsertTarget, type OutlineNode } from "../../components/outline-tree";
import { Menu, MenuItem, MenuSeparator, useMenu } from "../../components/overlay";
import { Button, Pane, PaneBody, PaneHeader } from "../../components/ui";
import { buildContentOutline, isContentMoreRowId } from "./content-outline";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";

export interface ContentNavigatorProps {
  state: ContentAuthoringState;
  controller: ContentAuthoringController;
  run(action: () => void | Promise<void>): void;
  onAddModel(): void;
  onDeleteModel(id: string, label: string): void;
  onDeleteEntry(id: string, label: string): void;
  onCopyEntryId(id: string): void;
}

interface RowMenuProps {
  node: OutlineNode;
  kind: "model" | "entry";
  canHoldAnotherEntry: boolean;
  onOpen(): void;
  onAddEntry(): void;
  onDuplicate(): void;
  onCopyId(): void;
  onDelete(): void;
}

function ContentRowMenu({ node, kind, canHoldAnotherEntry, onOpen, onAddEntry, onDuplicate, onCopyId, onDelete }: RowMenuProps): JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menu = useMenu(triggerRef, { align: "end" });
  const noun = kind === "model" ? "model" : "entry";
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        iconOnly
        elementRef={triggerRef}
        aria-label={`More actions for ${node.title}`}
        {...menu.triggerProps}
      >
        <EllipsisIcon size="xs" />
      </Button>
      <Menu controller={menu} label={`${node.title} actions`}>
        <MenuItem onSelect={onOpen}>Open {noun}</MenuItem>
        {kind === "model" ? (
          <MenuItem icon={PlusIcon} disabled={!canHoldAnotherEntry} onSelect={onAddEntry}>Add entry</MenuItem>
        ) : (
          <MenuItem icon={DuplicateIcon} disabled={!canHoldAnotherEntry} onSelect={onDuplicate}>Duplicate entry</MenuItem>
        )}
        {kind === "entry" ? <MenuItem icon={CopyIcon} onSelect={onCopyId}>Copy entry ID</MenuItem> : null}
        <MenuSeparator />
        <MenuItem icon={TrashIcon} tone="danger" onSelect={onDelete}>Delete {noun}…</MenuItem>
      </Menu>
    </>
  );
}

/**
 * The Content navigator: the library, rendered as the editor's left rail.
 *
 * There is no separate library page any more — a model is a `»` category and
 * its Entries hang off it, so choosing what to author and seeing what exists
 * are the same act. Only the open model has children, because the controller
 * holds one model's Entries at a time; every other category is childless, and
 * selecting one is what loads it.
 */
export function ContentNavigator({ state, controller, run, onAddModel, onDeleteModel, onDeleteEntry, onCopyEntryId }: ContentNavigatorProps): JSX.Element {
  const { setActivePane } = useEditorChrome();
  const openModel = state.model;
  const openModelId = openModel?.id ?? null;

  const nodes = useMemo(() => buildContentOutline({
    models: state.models,
    entryCounts: state.entryCounts,
    incompleteCounts: state.incompleteCounts,
    openModel,
    entries: state.entries,
    hasMoreEntries: state.nextCursor !== undefined,
    isEntryIncomplete: (entry) => controller.completeness(entry).length > 0,
  }), [controller, openModel, state.entries, state.entryCounts, state.incompleteCounts, state.models, state.nextCursor]);

  // Opening a model must reveal it. Adjusted during render rather than in an
  // effect: an effect runs after paint, so the model would flash closed on the
  // frame that loaded it.
  const [expandedIds, setExpandedIds] = useState<readonly string[]>([]);
  const lastOpenId = useRef<string | null>(null);
  if (openModelId !== lastOpenId.current) {
    lastOpenId.current = openModelId;
    if (openModelId !== null && !expandedIds.includes(openModelId)) setExpandedIds([...expandedIds, openModelId]);
  }

  const openChildCount = openModelId === null ? 0 : nodes.find((node) => node.id === openModelId)?.children?.length ?? 0;
  // A Single holds exactly one Entry, so its add row withdraws once it has one.
  const canAddEntry = openModel !== null && !(openModel.document.kind === "single" && state.entries.length > 0);

  // Entries carry no authored order: they are listed newest first by
  // `createdAt` and creation prepends, so a position between two of them cannot
  // be persisted without an order field. Only the terminal rows insert.
  function canInsert(target: OutlineInsertTarget): boolean {
    if (target.parentId === null) return target.index === state.models.length;
    if (target.parentId !== openModelId) return false;
    return canAddEntry && target.index === openChildCount;
  }

  function selectRow(id: string): void {
    if (isContentMoreRowId(id)) {
      run(() => controller.loadMoreEntries());
      return;
    }
    if (state.models.some((model) => model.id === id)) {
      run(async () => {
        await controller.openModel(id);
        controller.browseEntries();
      });
      return;
    }
    run(() => controller.openEntry(id));
  }

  const selectedId = state.entry?.id ?? openModelId ?? undefined;

  return (
    <Pane label="Content">
      <PaneHeader as="h1" title="Content" count={state.models.length} actions={<RailCollapseButton rail="nav" />} />
      <PaneBody>
        <OutlineTree
          label="Content"
          nodes={nodes}
          prefKey="content"
          selectedId={selectedId}
          onSelect={selectRow}
          onOpen={(id) => { if (!isContentMoreRowId(id)) setActivePane("main"); }}
          expandedIds={expandedIds}
          onExpandedChange={setExpandedIds}
          canInsert={canInsert}
          onRequestInsert={(target) => {
            if (target.parentId === null) onAddModel();
            else run(() => controller.createEntry());
          }}
          addLabel={(parent) => (parent === null ? "Add model" : "Add entry")}
          legend={
            <>
              <span><span class="cms-tree-dot cms-tree-dot--ok" />Complete</span>
              <span><span class="cms-tree-dot cms-tree-dot--warn" />Incomplete</span>
              <span class="cms-tree__hint">Click = select · ↵ = open</span>
            </>
          }
          renderActions={(node) => {
            if (isContentMoreRowId(node.id)) return null;
            const model = state.models.find((candidate) => candidate.id === node.id) ?? null;
            // Judged against the row's own model, not the open one: a Single is
            // full once it holds its single Entry, whichever model is loaded.
            const rowCanAdd = model === null
              ? canAddEntry
              : model.kind === "collection" || (state.entryCounts[model.id] ?? 0) === 0;
            return (
              <ContentRowMenu
                node={node}
                kind={model === null ? "entry" : "model"}
                canHoldAnotherEntry={rowCanAdd}
                onOpen={() => { selectRow(node.id); setActivePane("main"); }}
                onAddEntry={() => run(async () => {
                  await controller.openModel(node.id);
                  await controller.createEntry();
                })}
                onDuplicate={() => run(() => controller.duplicateEntry(node.id))}
                onCopyId={() => onCopyEntryId(node.id)}
                onDelete={() => (model === null ? onDeleteEntry(node.id, node.title) : onDeleteModel(node.id, node.title))}
              />
            );
          }}
        />
      </PaneBody>
    </Pane>
  );
}
