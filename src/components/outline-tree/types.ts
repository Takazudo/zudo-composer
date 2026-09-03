import type { ComponentChildren } from "preact";

/**
 * `category` is the root level: a `»` mark, no connectors, and a caret flush
 * against the pane edge. `group` and `leaf` hang off the dashed connectors.
 */
export type OutlineNodeKind = "category" | "group" | "leaf";

export type OutlineStatusTone = "ok" | "warn" | "accent";

export interface OutlineStatus {
  tone: OutlineStatusTone;
  /** Names the dot for pointer and screen-reader users, e.g. "Unassigned". */
  label: string;
}

export interface OutlineNode {
  id: string;
  kind: OutlineNodeKind;
  title: string;
  /** Right-aligned mono column: a route, a slug, or the literal "slot". */
  slug?: string;
  count?: number;
  status?: OutlineStatus;
  tag?: string;
  /** Quiet trailing note, e.g. "72 more entries…". */
  hint?: string;
  /** `slot` renders the quiet group the Composer uses for a composition slot. */
  variant?: "slot";
  children?: readonly OutlineNode[];
}

/**
 * Where a new node would go: `index` is its position in `parentId`'s children,
 * so `index === children.length` is the terminal "Add …" row and
 * `parentId === null` is the root list.
 */
export interface OutlineInsertTarget {
  parentId: string | null;
  index: number;
}

export interface OutlineAddRequest extends OutlineInsertTarget {
  title: string;
}

export interface OutlineTreeProps {
  nodes: readonly OutlineNode[];
  /** Accessible name of the tree. */
  label?: string;
  selectedId?: string;
  onSelect?: (id: string) => void;
  /** Enter and double-click; the row is selected first, as a click would. */
  onOpen?: (id: string) => void;
  /**
   * Controlled expansion. Omit it and the tree keeps its own state with every
   * node open, which is what a freshly rendered outline shows.
   */
  expandedIds?: readonly string[];
  onExpandedChange?: (ids: string[]) => void;
  /** Hover-only actions slot; it reserves no width while it is hidden. */
  renderActions?: (node: OutlineNode) => ComponentChildren;
  /** Gates every insert point, terminal "Add …" row and the root button. */
  canInsert?: (target: OutlineInsertTarget) => boolean;
  /**
   * The host decides what an insert means: open a chooser of its own, or
   * return `"inline"` for the tree's inline title editor. With no handler at
   * all the tree edits inline, which is the useful default.
   */
  onRequestInsert?: (target: OutlineInsertTarget) => "inline" | void;
  onAdd?: (request: OutlineAddRequest) => void;
  /** Label for the terminal add row; `null` is the root list. */
  addLabel?: (parent: OutlineNode | null) => string;
  showToolbar?: boolean;
  /** localStorage namespace for the Show slug / Show count preferences. */
  prefKey?: string;
  legend?: ComponentChildren;
  class?: string;
}
