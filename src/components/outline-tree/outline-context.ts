import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { OutlineInsertTarget, OutlineNode } from "./types";

/**
 * Rows render recursively, so everything they share travels in context rather
 * than through every level of the recursion.
 */
export interface OutlineTreeContextValue {
  selectedId?: string;
  expandedIds: ReadonlySet<string>;
  setExpanded: (id: string, expanded: boolean) => void;
  select: (id: string) => void;
  open: (id: string) => void;
  renderActions?: (node: OutlineNode) => ComponentChildren;
  canInsert: (target: OutlineInsertTarget) => boolean;
  /** `originId` is the row focus returns to when the editor closes. */
  requestInsert: (target: OutlineInsertTarget, originId?: string | null) => void;
  commitAdd: (target: OutlineInsertTarget, title: string) => void;
  /** The insert point whose inline editor is open, if any. */
  editing: OutlineInsertTarget | null;
  cancelEdit: () => void;
  addLabel: (parent: OutlineNode | null) => string;
  registerRow: (id: string, element: HTMLElement | null) => void;
  handleRowKeyDown: (event: KeyboardEvent, id: string) => void;
  /** The single row in the tab order — roving tabindex. */
  tabStopId: string | null;
  /** Moves the tab stop with the focus, however the focus got there. */
  noteFocus: (id: string) => void;
}

const OutlineTreeContext = createContext<OutlineTreeContextValue | null>(null);

export const OutlineTreeProvider = OutlineTreeContext.Provider;

export function useOutlineTree(): OutlineTreeContextValue {
  const value = useContext(OutlineTreeContext);
  if (value === null) throw new Error("Outline tree rows must render inside <OutlineTree>.");
  return value;
}
