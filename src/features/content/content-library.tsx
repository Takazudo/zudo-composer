import { computed, getScope, signal, type ReadonlySignal, type Ref } from "@takazudo/zfb/zudo-react";
import { RailCollapseButton, type EditorChromeController, type EditorRailsController } from "../../components/editor-chrome";
import { CopyIcon, DuplicateIcon, EllipsisIcon, PlusIcon, TrashIcon } from "../../components/icons";
import { OutlineTree, type OutlineInsertTarget, type OutlineNode } from "../../components/outline-tree";
import { createMenu, Menu, MenuItem, MenuSeparator } from "../../components/overlay";
import { Button, Pane, PaneBody, PaneHeader } from "../../components/ui";
import { buildContentOutline, isContentMoreRowId } from "./content-outline";
import type { ContentAuthoringController, ContentAuthoringState } from "./controller";

export interface ContentNavigatorProps {
  state: ReadonlySignal<ContentAuthoringState>;
  controller: ContentAuthoringController;
  chrome: EditorChromeController;
  rails: EditorRailsController;
  run(action: () => void | Promise<void>): void;
  onAddModel(): void;
  onDeleteModel(id: string, label: string): void;
  onDeleteEntry(id: string, label: string): void;
  onCopyEntryId(id: string): void;
  onSelectionAccepted?(): void;
}

interface RowMenuProps {
  node: OutlineNode;
  kind: "model" | "entry";
  canHoldAnotherEntry: ReadonlySignal<boolean>;
  onOpen(): void;
  onAddEntry(): void;
  onDuplicate(): void;
  onCopyId(): void;
  onDelete(): void;
}

function ContentRowMenu({ node, kind, canHoldAnotherEntry, onOpen, onAddEntry, onDuplicate, onCopyId, onDelete }: RowMenuProps) {
  const triggerRef: Ref<HTMLButtonElement> = { current: null };
  const menu = createMenu(triggerRef, { align: "end" });
  const unavailable = computed(() => !canHoldAnotherEntry.value);
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
          <MenuItem icon={PlusIcon} disabled={unavailable} onSelect={onAddEntry}>Add entry</MenuItem>
        ) : (
          <MenuItem icon={DuplicateIcon} disabled={unavailable} onSelect={onDuplicate}>Duplicate entry</MenuItem>
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
export function ContentNavigator({ state, controller, chrome, rails, run, onAddModel, onDeleteModel, onDeleteEntry, onCopyEntryId, onSelectionAccepted }: ContentNavigatorProps) {
  const scope = getScope();
  const { setActivePane } = chrome;
  const openModel = computed(() => state.value.model);
  const openModelId = computed(() => openModel.value?.id ?? null);

  const nodes = computed(() => {
    const current = state.value;
    return buildContentOutline({
      models: current.models,
      entryCounts: current.entryCounts,
      incompleteCounts: current.incompleteCounts,
      openModel: current.model,
      entries: current.entries,
      hasMoreEntries: current.nextCursor !== undefined,
      isEntryIncomplete: (entry) => controller.completeness(entry).length > 0,
    });
  });

  // Opening a model must reveal it, in the same flush that loads it.
  const expandedIds = signal<readonly string[]>(openModelId.value === null ? [] : [openModelId.value]);
  let lastOpenId = openModelId.value;
  scope.effect(() => {
    const id = openModelId.value;
    if (id === lastOpenId) return;
    lastOpenId = id;
    if (id !== null && !expandedIds.value.includes(id)) expandedIds.value = [...expandedIds.value, id];
  });

  const openChildCount = () => { const id = openModelId.value; return id === null ? 0 : nodes.value.find((node) => node.id === id)?.children?.length ?? 0; };
  // A Single holds exactly one Entry, so its add row withdraws once it has one.
  const entryActionPending = computed(() => state.value.modelSelectionPending || state.value.entryCreationPending);
  const canAddEntry = computed(() => { const model = openModel.value; return !entryActionPending.value && model !== null && !(model.document.kind === "single" && state.value.entries.length > 0); });

  // Entries carry no authored order: they are listed newest first by
  // `createdAt` and creation prepends, so a position between two of them cannot
  // be persisted without an order field. Only the terminal rows insert.
  function canInsert(target: OutlineInsertTarget): boolean {
    if (target.parentId === null) return target.index === state.value.models.length;
    if (target.parentId !== openModelId.value) return false;
    return canAddEntry.value && target.index === openChildCount();
  }

  function selectRow(id: string): void {
    if (isContentMoreRowId(id)) {
      run(() => controller.loadMoreEntries());
      return;
    }
    if (state.value.models.some((model) => model.id === id)) {
      run(async () => {
        await controller.openModel(id);
        controller.browseEntries();
        onSelectionAccepted?.();
      });
      return;
    }
    run(async () => { await controller.openEntry(id); onSelectionAccepted?.(); });
  }

  const selectedId = computed(() => state.value.entry?.id ?? openModelId.value ?? undefined);

  return (
    <Pane label="Content">
      <PaneHeader as="h1" title="Content" count={computed(() => state.value.models.length)} actions={<RailCollapseButton rail="nav" rails={rails} />} />
      <PaneBody>
        <OutlineTree
          label="Content"
          nodes={nodes}
          prefKey="content"
          selectedId={selectedId}
          onSelect={selectRow}
          onOpen={(id) => { if (!isContentMoreRowId(id)) setActivePane("main"); }}
          expandedIds={expandedIds}
          onExpandedChange={(ids) => { expandedIds.value = ids; }}
          canInsert={canInsert}
          onRequestInsert={(target) => {
            if (target.parentId === null) onAddModel();
            else run(async () => { await controller.createEntry(); onSelectionAccepted?.(); });
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
            const isModel = state.value.models.some((candidate) => candidate.id === node.id);
            // Judged against the row's own model, not the open one: a Single is
            // full once it holds its single Entry, whichever model is loaded.
            const canHold = computed(() => {
              const model = state.value.models.find((candidate) => candidate.id === node.id) ?? null;
              const rowCanAdd = model === null
                ? canAddEntry.value
                : model.kind === "collection" || (state.value.entryCounts[model.id] ?? 0) === 0;
              return !entryActionPending.value && rowCanAdd;
            });
            return (
              <ContentRowMenu
                node={node}
                kind={isModel ? "model" : "entry"}
                canHoldAnotherEntry={canHold}
                onOpen={() => { selectRow(node.id); setActivePane("main"); }}
                onAddEntry={() => run(async () => {
                  await controller.openModel(node.id);
                  await controller.createEntry();
                  onSelectionAccepted?.();
                })}
                onDuplicate={() => run(async () => { await controller.duplicateEntry(node.id); onSelectionAccepted?.(); })}
                onCopyId={() => onCopyEntryId(node.id)}
                onDelete={() => (isModel ? onDeleteModel(node.id, node.title) : onDeleteEntry(node.id, node.title))}
              />
            );
          }}
        />
      </PaneBody>
    </Pane>
  );
}
