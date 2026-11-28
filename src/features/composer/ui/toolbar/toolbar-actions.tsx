// The Composer toolbar's inline-end group: the two status chips the save state
// does not cover, history, Export, and the overflow menu.
//
// The save state itself is NOT here — `EditorChrome` publishes it through
// `bindEditorStatus` and the app shell draws it, so every editor reports saving
// in one place. What remains is Composer-specific and belongs beside the
// commands: the session clipboard, and a generated-output block, which is a
// separate fact from "the record is saved" and must not soften it.

import { computed, Show, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import type { CompositionDerivedOutputOutcome, CompositionNode } from "../../../../composer/browser";
import { ComposerClipboardChip } from "../../app/composer-clipboard-chip";
import {
  DownloadIcon,
  DuplicateIcon,
  EditIcon,
  EllipsisIcon,
  RedoIcon,
  TrashIcon,
  UndoIcon,
  WarningIcon,
} from "../../../../components/icons";
import { createMenu, Menu, MenuItem, MenuSeparator } from "../../../../components/overlay";
import { read, type MaybeSignal } from "../../../../components/reactive";
import { Button, StatusChip } from "../../../../components/ui";

export interface ComposerToolbarActionsProps {
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: MaybeSignal<boolean>;
  canRedo?: MaybeSignal<boolean>;
  onExport: () => void;
  exportLabel?: string;
  exportDisabled?: MaybeSignal<boolean>;
  /** Kept separate from the save status so "Saved" stays truthful. */
  derivedOutput?: MaybeSignal<CompositionDerivedOutputOutcome | null>;
  /** The session clipboard — a chip while it holds something. */
  clipboard?: MaybeSignal<CompositionNode | null>;
  /** Friendly display name for a component id; required only alongside `clipboard`. */
  titleFor?: (componentId: string) => string | undefined;
  /** Record-level duplicate, distinct from duplicating a selected node. */
  onDuplicateComposition?: () => void;
  duplicatingComposition?: MaybeSignal<boolean>;
  onRenameComposition?: () => void;
  onDeleteComposition?: () => void;
  /** Toggles for the two rails, mirroring the overflow menu's entries. */
  onToggleStructure?: () => void;
  onToggleInspector?: () => void;
}

export function ComposerToolbarActions({
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  onExport,
  exportLabel = "Export JSX",
  exportDisabled = false,
  derivedOutput = null,
  clipboard = null,
  titleFor = () => undefined,
  onDuplicateComposition,
  duplicatingComposition = false,
  onRenameComposition,
  onDeleteComposition,
  onToggleStructure,
  onToggleInspector,
}: ComposerToolbarActionsProps): Child {
  const overflowRef: Ref<HTMLButtonElement> = { current: null };
  const overflow = createMenu(overflowRef, { align: "end" });
  const blocked = computed(() => read(derivedOutput)?.records.some((record) => record.status === "blocked") ?? false);
  const duplicating = computed(() => read(duplicatingComposition));

  return (
    <>
      <ComposerClipboardChip clipboard={clipboard} titleFor={titleFor} />
      <Show when={blocked}>
        {() => (
          <StatusChip
            state="custom"
            label="Generated output blocked"
            tone="warn"
            icon={WarningIcon}
          />
        )}
      </Show>
      {onUndo ? (
        <Button
          variant="ghost"
          iconOnly
          aria-label="Undo"
          title="Undo (Cmd+Z / Ctrl+Z)"
          disabled={computed(() => !read(canUndo))}
          on:click={() => onUndo()}
        >
          <UndoIcon size="sm" />
        </Button>
      ) : null}
      {onRedo ? (
        <Button
          variant="ghost"
          iconOnly
          aria-label="Redo"
          title="Redo (Cmd+Shift+Z / Ctrl+Shift+Z or Ctrl+Y)"
          disabled={computed(() => !read(canRedo))}
          on:click={() => onRedo()}
        >
          <RedoIcon size="sm" />
        </Button>
      ) : null}
      <Button disabled={exportDisabled} aria-disabled={computed(() => read(exportDisabled))} on:click={() => onExport()}>
        <DownloadIcon size="sm" />
        {exportLabel}
      </Button>
      <Button
        variant="ghost"
        iconOnly
        elementRef={overflowRef}
        aria-label="More composition actions"
        {...overflow.triggerProps}
      >
        <EllipsisIcon size="sm" />
      </Button>
      <Menu controller={overflow} label="Composition actions">
        {onDuplicateComposition ? (
          <MenuItem icon={DuplicateIcon} disabled={duplicating} onSelect={onDuplicateComposition}>
            {computed(() => (duplicating.value ? "Duplicating composition…" : "Duplicate composition"))}
          </MenuItem>
        ) : null}
        {onRenameComposition ? (
          <MenuItem icon={EditIcon} onSelect={onRenameComposition}>
            Rename…
          </MenuItem>
        ) : null}
        {onToggleStructure ? <MenuItem onSelect={onToggleStructure}>Toggle structure</MenuItem> : null}
        {onToggleInspector ? <MenuItem onSelect={onToggleInspector}>Toggle inspector</MenuItem> : null}
        {onDeleteComposition ? (
          <>
            <MenuSeparator />
            <MenuItem icon={TrashIcon} tone="danger" onSelect={onDeleteComposition}>
              Delete…
            </MenuItem>
          </>
        ) : null}
      </Menu>
    </>
  );
}
