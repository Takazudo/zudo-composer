/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// The Composer document shell: the shared editor chrome, filled in.
//
// Purely presentational — no state of its own. `tree`, `canvas`, `inspector`,
// `banner` and the toolbar slots are typed content seams driven by the app
// root; the geometry, the persisted rail widths, the narrow-screen pane switch
// and the save-status publication all belong to `EditorChrome`/`EditorBody`, so
// this file owns none of them.
//
// The banner sits inside the main region rather than above the panes: a
// provider or navigation failure is about what the canvas is showing, and a
// full-width strip between the toolbar and the rails would push both rails down
// every time one appeared.

import type { ComponentChildren, JSX } from "preact";
import { useState } from "preact/hooks";
import type { EditorStatus } from "../../../app/chrome-context";
import { EditorBody, EditorChrome, readEditorCollapsed, writeEditorCollapsed } from "../../../components/editor-chrome";
import type { EditorChromeBackLink, EditorRail } from "../../../components/editor-chrome";
import { ComposerPlaceholderPane } from "./composer-placeholder-pane";

/** Fresh-session rail widths. The structure rail is wider: it holds nested rows. */
const DEFAULT_TREE_WIDTH = 320;
const DEFAULT_INSPECTOR_WIDTH = 320;

const EDITOR_KEY = "composer";

export interface ComposerToolbarRails {
  toggleRail: (rail: EditorRail) => void;
}

export interface ComposerWorkspaceProps {
  back: EditorChromeBackLink;
  /** The composition's name; normally a `<RecordTitle>`. */
  title: ComponentChildren;
  /** Mode and viewport controls, centred and withdrawn on narrow screens. */
  center?: ComponentChildren;
  /**
   * History, Export and the overflow menu, pinned to the inline end. It is a
   * function because the toolbar sits ABOVE `EditorBody`, so the rails context
   * `RailCollapseButton` reads does not reach it — the overflow menu's two
   * rail toggles are handed down explicitly instead.
   */
  right?: (rails: ComposerToolbarRails) => ComponentChildren;
  /** Published to the app chrome, which decides where the save state is drawn. */
  status?: EditorStatus | null;
  dirty?: boolean;
  /** Current provider/navigation status, above the canvas. */
  banner?: ComponentChildren;
  /** Structure rail. Defaults to an explicit omitted-surface fallback. */
  tree?: ComponentChildren;
  /** Canvas / preview region. Defaults to an explicit omitted-surface fallback. */
  canvas?: ComponentChildren;
  /** Inspector rail. Defaults to an explicit omitted-surface fallback. */
  inspector?: ComponentChildren;
  /** Dialogs and menus mounted inside the chrome, so they share its context. */
  children?: ComponentChildren;
}

export function ComposerWorkspace({
  back,
  title,
  center,
  right,
  status = null,
  dirty = false,
  banner,
  tree,
  canvas,
  inspector,
  children,
}: ComposerWorkspaceProps): JSX.Element {
  // The collapse state is held here rather than inside `EditorBody` because the
  // toolbar needs to toggle it too; `EditorBody` writes nothing for a rail its
  // host controls, so this owns the same persistence it would have done.
  const [collapsed, setCollapsed] = useState(() => readEditorCollapsed(EDITOR_KEY));

  function applyCollapse(rail: EditorRail, next: boolean): void {
    setCollapsed((current) => ({ ...current, [rail]: next }));
    writeEditorCollapsed(EDITOR_KEY, rail, next);
  }

  return (
    <EditorChrome
      editorKey={EDITOR_KEY}
      class="sg-composer-editor"
      back={back}
      title={title}
      center={center}
      right={right?.({ toggleRail: (rail) => applyCollapse(rail, !collapsed[rail]) })}
      status={status}
      dirty={dirty}
      paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}
    >
      <EditorBody
        navLabel="Structure"
        inspectorLabel="Inspector"
        defaultNavWidth={DEFAULT_TREE_WIDTH}
        defaultInspectorWidth={DEFAULT_INSPECTOR_WIDTH}
        navCollapsed={collapsed.nav}
        inspectorCollapsed={collapsed.insp}
        onNavCollapsedChange={(value) => applyCollapse("nav", value)}
        onInspectorCollapsedChange={(value) => applyCollapse("insp", value)}
        nav={tree ?? <ComposerPlaceholderPane label="Structure" note="No structure surface was supplied." />}
        main={
          <div class="sg-composer-main">
            {banner}
            {canvas ?? <ComposerPlaceholderPane label="Canvas" note="No preview surface was supplied." />}
          </div>
        }
        inspector={inspector ?? <ComposerPlaceholderPane label="Inspector" note="No inspector surface was supplied." />}
      />
      {children}
    </EditorChrome>
  );
}
