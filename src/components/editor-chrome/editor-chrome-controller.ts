/**
 * The two seams inside the editor chrome, as explicit controllers.
 *
 * `EditorChromeController` runs downwards from the toolbar: the narrow pane
 * switch lives in `EditorChrome`, the panes it switches live in `EditorBody`,
 * and the `editorKey` that names the persisted geometry is shared by both. The
 * route creates one with `createEditorChrome` and hands it to both components.
 *
 * `EditorRailsController` runs outwards from `EditorBody`: a consumer puts
 * `<RailCollapseButton rails={rails}>` in its own `PaneHeader`, so the collapse
 * control sits where the prototype draws it without `EditorBody` reaching into
 * a pane it does not own. `createEditorRails` owns the collapse state.
 *
 * Either component works on its own: without a controller each builds a
 * private one, which is the old inert-default behaviour.
 */

import { computed, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { read, toSignal, type MaybeSignal } from "../reactive";
import { readEditorCollapsed, writeEditorCollapsed } from "./resizer-contract";
import type { EditorRail, EditorRailCollapse } from "./resizer-contract";

/** The three regions of an editor body, in visual order. */
export type EditorPane = "nav" | "main" | "insp";

export const EDITOR_PANES: readonly EditorPane[] = Object.freeze(["nav", "main", "insp"] as const);

export interface EditorChromeController {
  /** Names the persisted rail geometry; one per editor surface, not per record. */
  readonly editorKey: ReadonlySignal<string>;
  /** The region shown when the body is too narrow for three columns. */
  readonly activePane: ReadonlySignal<EditorPane>;
  readonly setActivePane: (pane: EditorPane) => void;
}

export interface EditorChromeOptions {
  editorKey?: MaybeSignal<string>;
  /** Omit to let the controller own the narrow-screen pane selection. */
  activePane?: MaybeSignal<EditorPane>;
  onActivePaneChange?: (pane: EditorPane) => void;
}

export function createEditorChrome({ editorKey = "editor", activePane, onActivePaneChange }: EditorChromeOptions = {}): EditorChromeController {
  const internal = signal<EditorPane>("main");
  const pane = activePane === undefined ? internal : toSignal(activePane);
  return {
    editorKey: toSignal(editorKey),
    activePane: pane,
    setActivePane(next) {
      if (activePane === undefined) internal.value = next;
      onActivePaneChange?.(next);
    },
  };
}

export interface EditorRailsController {
  readonly navCollapsed: ReadonlySignal<boolean>;
  readonly inspCollapsed: ReadonlySignal<boolean>;
  /** Human names for the two rails, reused by the resizers and toggle buttons. */
  readonly navLabel: string;
  readonly inspLabel: string;
  readonly toggleRail: (rail: EditorRail) => void;
}

export interface EditorRailsOptions {
  /** The chrome whose `editorKey` names the persisted collapse state. */
  chrome?: EditorChromeController;
  navLabel?: string;
  inspectorLabel?: string;
  /** Pass to let the owning route drive a rail's collapse (nothing is persisted then). */
  navCollapsed?: MaybeSignal<boolean>;
  inspectorCollapsed?: MaybeSignal<boolean>;
  onNavCollapsedChange?: (collapsed: boolean) => void;
  onInspectorCollapsedChange?: (collapsed: boolean) => void;
}

/**
 * Collapse is persisted per editor and per rail: a rail an author put away is
 * still away after a reload. A route that drives the collapse itself owns its
 * own persistence, so nothing is written for a controlled rail. The stored
 * state is re-read whenever the chrome's `editorKey` changes.
 */
export function createEditorRails({
  chrome,
  navLabel = "Navigator",
  inspectorLabel = "Inspector",
  navCollapsed,
  inspectorCollapsed,
  onNavCollapsedChange,
  onInspectorCollapsedChange,
}: EditorRailsOptions = {}): EditorRailsController {
  const editorKey = chrome?.editorKey ?? toSignal("editor");
  const initialKey = editorKey.value;
  const own = signal<{ key: string; state: EditorRailCollapse }>({ key: initialKey, state: readEditorCollapsed(initialKey) });
  const stored = computed(() => {
    const key = editorKey.value;
    const current = own.value;
    return current.key === key ? current.state : readEditorCollapsed(key);
  });

  const rail = (
    id: EditorRail,
    controlled: MaybeSignal<boolean> | undefined,
    onChange: ((collapsed: boolean) => void) | undefined,
  ) => {
    const collapsed = computed(() => (controlled === undefined ? stored.value[id] : read(controlled)));
    const toggle = () => {
      const next = !collapsed.value;
      if (controlled === undefined) {
        const key = editorKey.value;
        own.value = { key, state: { ...stored.value, [id]: next } };
        writeEditorCollapsed(key, id, next);
      }
      onChange?.(next);
    };
    return { collapsed, toggle };
  };

  const nav = rail("nav", navCollapsed, onNavCollapsedChange);
  const insp = rail("insp", inspectorCollapsed, onInspectorCollapsedChange);
  return {
    navCollapsed: nav.collapsed,
    inspCollapsed: insp.collapsed,
    navLabel,
    inspLabel: inspectorLabel,
    toggleRail: (id) => (id === "nav" ? nav.toggle() : insp.toggle()),
  };
}

