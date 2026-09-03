/**
 * Shared record-editor chrome (epic #156).
 *
 * The stylesheet is imported here rather than from `src/style.css` so the
 * chrome and its CSS ship as one unit; `src/styles/app-tokens.css` owns the
 * tokens it reads and `src/components/ui` owns the controls it composes.
 *
 * Typical shape:
 *
 * ```tsx
 * <EditorChrome
 *   editorKey="composer"
 *   back={{ href: "/composer", label: "Back to Compositions" }}
 *   title={<RecordTitle value={name} onCommit={rename} label="Composition name" />}
 *   status={{ state: "unsaved" }}
 *   dirty={dirty}
 *   paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}
 *   right={<Button variant="primary">Save</Button>}
 * >
 *   <EditorBody nav={<StructurePane />} main={<Canvas />} inspector={<Inspector />} />
 * </EditorChrome>
 * ```
 */
import "./editor-chrome.css";

export { EditorChrome } from "./editor-chrome";
export type { EditorChromeBackLink, EditorChromeProps } from "./editor-chrome";

export { EditorBody, RailCollapseButton } from "./editor-body";
export type { EditorBodyProps, RailCollapseButtonProps } from "./editor-body";

export { RecordTitle } from "./record-title";
export type { RecordTitleProps } from "./record-title";

export { useBeforeUnloadGuard } from "./use-before-unload-guard";

export { EDITOR_PANES, EditorChromeContext, EditorRailsContext, useEditorChrome, useEditorRails } from "./editor-chrome-context";
export type { EditorChromeContextValue, EditorPane, EditorRailsContextValue } from "./editor-chrome-context";

export {
  CSS_VAR_INSP_W,
  CSS_VAR_NAV_W,
  DEFAULT_INSP_W,
  DEFAULT_NAV_W,
  MAX_RAIL_W,
  MIN_MAIN_W,
  MIN_RAIL_W,
  RAIL_STEP_W,
  RESIZER_TRACK_W,
  WIDTH_CHANGE_EVENT,
  clampRailWidth,
  cssVarForRail,
  getPersistedWidth,
  maxRailWidth,
  railCollapsedStorageKey,
  railStorageKey,
  readEditorCollapsed,
  readEditorWidths,
  setPersistedCollapsed,
  setPersistedWidth,
} from "./resizer-contract";
export type {
  EditorRail,
  EditorRailCollapse,
  EditorRailWidths,
  EditorWidthChangeDetail,
} from "./resizer-contract";

export { installRailResizer } from "./resizer-dom";
export type { RailResizerOptions } from "./resizer-dom";
