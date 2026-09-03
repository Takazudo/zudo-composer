/**
 * The two seams inside the editor chrome.
 *
 * `EditorChromeContext` runs downwards from the toolbar: the narrow pane switch
 * lives in `EditorChrome`, the panes it switches live in `EditorBody`, and the
 * `editorKey` that names the persisted geometry is published once for both.
 *
 * `EditorRailsContext` runs outwards from `EditorBody`: a consumer puts
 * `<RailToggleButton>` in its own `PaneHeader`, so the collapse control sits
 * where the prototype draws it without `EditorBody` reaching into a pane it
 * does not own.
 *
 * Both defaults are inert, so either component renders on its own.
 */

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { EditorRail } from "./resizer-contract";

/** The three regions of an editor body, in visual order. */
export type EditorPane = "nav" | "main" | "insp";

export const EDITOR_PANES: readonly EditorPane[] = Object.freeze(["nav", "main", "insp"] as const);

export interface EditorChromeContextValue {
  /** Names the persisted rail geometry; one per editor surface, not per record. */
  readonly editorKey: string;
  /** The region shown when the body is too narrow for three columns. */
  readonly activePane: EditorPane;
  readonly setActivePane: (pane: EditorPane) => void;
}

const DEFAULT_CHROME: EditorChromeContextValue = Object.freeze({
  editorKey: "editor",
  activePane: "main",
  setActivePane: () => {},
});

export const EditorChromeContext = createContext<EditorChromeContextValue>(DEFAULT_CHROME);

export function useEditorChrome(): EditorChromeContextValue {
  return useContext(EditorChromeContext);
}

export interface EditorRailsContextValue {
  readonly navCollapsed: boolean;
  readonly inspCollapsed: boolean;
  /** Human names for the two rails, reused by the resizers and toggle buttons. */
  readonly navLabel: string;
  readonly inspLabel: string;
  readonly toggleRail: (rail: EditorRail) => void;
}

const DEFAULT_RAILS: EditorRailsContextValue = Object.freeze({
  navCollapsed: false,
  inspCollapsed: false,
  navLabel: "Navigator",
  inspLabel: "Inspector",
  toggleRail: () => {},
});

export const EditorRailsContext = createContext<EditorRailsContextValue>(DEFAULT_RAILS);

export function useEditorRails(): EditorRailsContextValue {
  return useContext(EditorRailsContext);
}
