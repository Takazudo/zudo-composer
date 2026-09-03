/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer toolbar's inline-end group: the two status chips the save state
// does not cover, history, Export, and the overflow menu.
//
// The save state itself is NOT here — `EditorChrome` publishes it through
// `useEditorStatus` and the app shell draws it, so every editor reports saving
// in one place. What remains is Composer-specific and belongs beside the
// commands: the session clipboard, and a generated-output block, which is a
// separate fact from "the record is saved" and must not soften it.

import type { JSX } from "preact";
import { useRef } from "preact/hooks";
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
import { Menu, MenuItem, MenuSeparator, useMenu } from "../../../../components/overlay";
import { Button, StatusChip } from "../../../../components/ui";

export interface ComposerToolbarActionsProps {
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onExport: () => void;
  exportLabel?: string;
  exportDisabled?: boolean;
  /** Kept separate from the save status so "Saved" stays truthful. */
  derivedOutput?: CompositionDerivedOutputOutcome | null;
  /** The session clipboard — a chip while it holds something. */
  clipboard?: CompositionNode | null;
  /** Friendly display name for a component id; required only alongside `clipboard`. */
  titleFor?: (componentId: string) => string | undefined;
  /** Record-level duplicate, distinct from duplicating a selected node. */
  onDuplicateComposition?: () => void;
  duplicatingComposition?: boolean;
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
}: ComposerToolbarActionsProps): JSX.Element {
  const overflowRef = useRef<HTMLButtonElement | null>(null);
  const overflow = useMenu(overflowRef, { align: "end" });
  const blocked = derivedOutput?.records.find((record) => record.status === "blocked");

  return (
    <>
      <ComposerClipboardChip clipboard={clipboard} titleFor={titleFor} />
      {blocked && (
        <StatusChip
          state="custom"
          label="Generated output blocked"
          tone="warn"
          icon={WarningIcon}
          class="sg-composer-output-blocked"
        />
      )}
      {onUndo && (
        <Button
          variant="ghost"
          iconOnly
          aria-label="Undo"
          title="Undo (Cmd+Z / Ctrl+Z)"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <UndoIcon size="sm" />
        </Button>
      )}
      {onRedo && (
        <Button
          variant="ghost"
          iconOnly
          aria-label="Redo"
          title="Redo (Cmd+Shift+Z / Ctrl+Shift+Z or Ctrl+Y)"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <RedoIcon size="sm" />
        </Button>
      )}
      <Button disabled={exportDisabled} aria-disabled={exportDisabled} onClick={onExport}>
        <DownloadIcon size="sm" />
        {exportLabel}
      </Button>
      {/* A raw button rather than `Button`: the menu measures its trigger
       * through a ref, and Preact strips `ref` from a function component. */}
      <button
        type="button"
        ref={overflowRef}
        class="cms-btn cms-btn--ghost cms-btn--icon"
        aria-label="More composition actions"
        {...overflow.triggerProps}
      >
        <EllipsisIcon size="sm" />
      </button>
      <Menu controller={overflow} label="Composition actions">
        {onDuplicateComposition && (
          <MenuItem icon={DuplicateIcon} disabled={duplicatingComposition} onSelect={onDuplicateComposition}>
            {duplicatingComposition ? "Duplicating composition…" : "Duplicate composition"}
          </MenuItem>
        )}
        {onRenameComposition && (
          <MenuItem icon={EditIcon} onSelect={onRenameComposition}>
            Rename…
          </MenuItem>
        )}
        {onToggleStructure && <MenuItem onSelect={onToggleStructure}>Toggle structure</MenuItem>}
        {onToggleInspector && <MenuItem onSelect={onToggleInspector}>Toggle inspector</MenuItem>}
        {onDeleteComposition && (
          <>
            <MenuSeparator />
            <MenuItem icon={TrashIcon} tone="danger" onSelect={onDeleteComposition}>
              Delete…
            </MenuItem>
          </>
        )}
      </Menu>
    </>
  );
}
