import type { Child, ReadonlySignal } from "@takazudo/zfb/zudo-react";
import type { OutlineInsertTarget, OutlineNode } from "./types";

/**
 * Rows render recursively; everything they share travels down as this one
 * explicit `tree` prop (there is no context). Values that change are signals,
 * so a row binds them where it renders them and never re-runs as a whole.
 */
export interface OutlineTreeState {
  selectedId: ReadonlySignal<string | undefined>;
  expandedIds: ReadonlySignal<ReadonlySet<string>>;
  setExpanded: (id: string, expanded: boolean) => void;
  select: (id: string) => void;
  open: (id: string) => void;
  renderActions?: (node: OutlineNode) => Child;
  /** Reads the tree's node list, so a `computed` that calls it follows the outline. */
  canInsert: (target: OutlineInsertTarget) => boolean;
  /** `originId` is the row focus returns to when the editor closes. */
  requestInsert: (target: OutlineInsertTarget, originId?: string | null) => void;
  commitAdd: (target: OutlineInsertTarget, title: string) => void;
  /** The insert point whose inline editor is open, if any. */
  editing: ReadonlySignal<OutlineInsertTarget | null>;
  pending: ReadonlySignal<OutlineInsertTarget | null>;
  renamingId: ReadonlySignal<string | null>;
  commitRename: (id: string, title: string) => void;
  cancelRename: () => void;
  cancelEdit: () => void;
  addLabel: (parent: OutlineNode | null) => string;
  /** Registers a mounted row element; the returned function unregisters exactly it. */
  registerRow: (id: string, element: HTMLElement) => () => void;
  registerTerminal: (parentId: string | null, element: HTMLElement) => () => void;
  handleRowKeyDown: (event: KeyboardEvent, id: string) => void;
  /** The single row in the tab order — roving tabindex. */
  tabStopId: ReadonlySignal<string | null>;
  /** Moves the tab stop with the focus, however the focus got there. */
  noteFocus: (id: string) => void;
}
