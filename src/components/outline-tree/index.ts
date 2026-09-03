/**
 * Outline tree (epic #156, issue #162).
 *
 * The stylesheet is imported here rather than from `src/style.css` so the tree
 * and its CSS ship as one unit, matching `src/components/ui`.
 */
import "./outline-tree.css";

export { OutlineTree } from "./outline-tree";
export type {
  OutlineAddRequest,
  OutlineInsertTarget,
  OutlineNode,
  OutlineNodeKind,
  OutlineStatus,
  OutlineStatusTone,
  OutlineTreeProps,
} from "./types";
export {
  collectExpandableIds,
  collectNodeIds,
  childrenOf,
  findRowIndex,
  flattenVisibleRows,
  insertTargetAfter,
  isExpandable,
  isLastInList,
  isSameTarget,
} from "./tree-model";
export type { OutlineRowPosition } from "./tree-model";
export {
  DEFAULT_OUTLINE_PREFS,
  outlinePrefsStorageKey,
  readOutlinePrefs,
  writeOutlinePrefs,
} from "./prefs";
export type { OutlinePrefs } from "./prefs";
