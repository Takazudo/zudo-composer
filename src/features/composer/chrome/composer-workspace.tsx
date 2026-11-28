// The Composer document shell: the shared editor chrome, filled in.
//
// Purely presentational — no state of its own. `tree`, `canvas`, `inspector`,
// `banner` and the toolbar slots are typed content seams driven by the app
// root; the geometry, the persisted rail widths, the narrow-screen pane switch
// and the save-status publication all belong to `EditorChrome`/`EditorBody`
// and the controllers they share, so this file owns none of them.
//
// The banner sits inside the main region rather than above the panes: a
// provider or navigation failure is about what the canvas is showing, and a
// full-width strip between the toolbar and the rails would push both rails down
// every time one appeared.

import type { Child } from "@takazudo/zfb/zudo-react";
import type { ChromeStore, EditorStatus } from "../../../app/chrome-context";
import {
  createEditorChrome,
  createEditorRails,
  EditorBody,
  EditorChrome,
  type EditorChromeBackLink,
  type EditorChromeController,
  type EditorRail,
  type EditorRailsController,
} from "../../../components/editor-chrome";
import type { MaybeSignal } from "../../../components/reactive";
import { liveSlot, type LiveChild } from "../../../components/rebuild";
import { ComposerPlaceholderPane } from "./composer-placeholder-pane";

/** Fresh-session rail widths. The structure rail is wider: it holds nested rows. */
const DEFAULT_TREE_WIDTH = 320;
const DEFAULT_INSPECTOR_WIDTH = 320;

export const COMPOSER_EDITOR_KEY = "composer";

export interface ComposerToolbarRails {
  toggleRail: (rail: EditorRail) => void;
}

export interface ComposerWorkspaceProps {
  back: EditorChromeBackLink;
  /** The composition's name; normally a `<RecordTitle>`. */
  title: Child;
  /** Mode and viewport controls, centred and withdrawn on narrow screens. */
  center?: Child;
  /** History, Export and the overflow menu, pinned to the inline end; handed the rail toggles. */
  right?: (rails: ComposerToolbarRails) => Child;
  /** Shared with the structure pane, so Enter there switches the narrow-screen pane. */
  chrome?: EditorChromeController;
  /** Shared with the panes' own collapse buttons. */
  rails?: EditorRailsController;
  /** The app chrome store the save state is published into. */
  appChrome?: ChromeStore | null;
  /** Published to the app chrome, which decides where the save state is drawn. */
  status?: MaybeSignal<EditorStatus | null>;
  dirty?: MaybeSignal<boolean>;
  /** Current provider/navigation status, above the canvas. */
  banner?: LiveChild;
  /** Structure rail. Defaults to an explicit omitted-surface fallback. */
  tree?: Child;
  /** Canvas / preview region. Defaults to an explicit omitted-surface fallback. */
  canvas?: Child;
  /** Inspector rail. Defaults to an explicit omitted-surface fallback. */
  inspector?: Child;
  /** Dialogs and menus mounted inside the chrome. */
  children?: Child;
}

/** The chrome and rails one Composer editor shares between its toolbar, body and panes. */
export function createComposerEditorChrome(): { chrome: EditorChromeController; rails: EditorRailsController } {
  const chrome = createEditorChrome({ editorKey: COMPOSER_EDITOR_KEY });
  const rails = createEditorRails({ chrome, navLabel: "Structure", inspectorLabel: "Inspector" });
  return { chrome, rails };
}

export function ComposerWorkspace({
  back,
  title,
  center,
  right,
  chrome: givenChrome,
  rails: givenRails,
  appChrome = null,
  status = null,
  dirty = false,
  banner,
  tree,
  canvas,
  inspector,
  children,
}: ComposerWorkspaceProps): Child {
  const own = givenChrome && givenRails ? null : createComposerEditorChrome();
  const chrome = givenChrome ?? own!.chrome;
  const rails = givenRails ?? (givenChrome
    ? createEditorRails({ chrome, navLabel: "Structure", inspectorLabel: "Inspector" })
    : own!.rails);

  return (
    <EditorChrome
      chrome={chrome}
      class="sg-composer-editor"
      back={back}
      title={title}
      center={center}
      right={right?.({ toggleRail: (rail) => rails.toggleRail(rail) })}
      appChrome={appChrome}
      status={status}
      dirty={dirty}
      paneLabels={{ nav: "Structure", main: "Canvas", insp: "Inspect" }}
    >
      <EditorBody
        chrome={chrome}
        rails={rails}
        defaultNavWidth={DEFAULT_TREE_WIDTH}
        defaultInspectorWidth={DEFAULT_INSPECTOR_WIDTH}
        nav={tree ?? <ComposerPlaceholderPane label="Structure" note="No structure surface was supplied." />}
        main={
          <div class="sg-composer-main">
            {/* Always a real element, even with nothing in it: the canvas has to
                stay in the second grid row, and a conditional child would slide
                it into the first (auto) one and collapse its height. */}
            <div class="sg-composer-main__banner">{liveSlot(banner)}</div>
            {canvas ?? <ComposerPlaceholderPane label="Canvas" note="No preview surface was supplied." />}
          </div>
        }
        inspector={inspector ?? <ComposerPlaceholderPane label="Inspector" note="No inspector surface was supplied." />}
      />
      {children}
    </EditorChrome>
  );
}
