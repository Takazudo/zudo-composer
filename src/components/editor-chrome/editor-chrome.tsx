import { computed, getScope, type Child } from "@takazudo/zfb/zudo-react";
import { bindEditorStatus } from "../../app/chrome-context";
import type { ChromeStore, EditorStatus } from "../../app/chrome-context";
import type { MaybeSignal } from "../reactive";
import { ArrowLeftIcon } from "../icons";
import { cx } from "../ui/class-names";
import { SegmentedControl } from "../ui/segmented-control";
import type { SegmentedOption } from "../ui/segmented-control";
import { createEditorChrome, EDITOR_PANES } from "./editor-chrome-controller";
import type { EditorChromeController, EditorPane } from "./editor-chrome-controller";
import { guardBeforeUnload } from "./use-before-unload-guard";

const DEFAULT_PANE_LABELS: Readonly<Record<EditorPane, string>> = Object.freeze({
  nav: "Navigator",
  main: "Main",
  insp: "Inspector",
});

export interface EditorChromeBackLink {
  href: string;
  /** Accessible name, e.g. "Back to Compositions". */
  label: string;
}

export interface EditorChromeProps {
  /**
   * The controller shared with this toolbar's `EditorBody`. Omit it and the
   * toolbar builds a private one from `editorKey` / `activePane` /
   * `onActivePaneChange` (a body then cannot follow its pane switch).
   */
  chrome?: EditorChromeController;
  /** Names the persisted rail geometry — one per editor surface, not per record. Ignored with `chrome`. */
  editorKey?: string;
  back?: EditorChromeBackLink;
  /** The record's name; normally a `<RecordTitle>`. */
  title?: Child;
  /** Mode and viewport style controls, centred and hidden on narrow screens. */
  center?: Child;
  /** Record actions, pinned to the inline end. */
  right?: Child;
  /** The app chrome store (`services.chrome`) the save state is published into. */
  appChrome?: ChromeStore | null;
  /** Published to the app chrome: Saved / Unsaved changes / Saving… / Save failed. */
  status?: MaybeSignal<EditorStatus | null>;
  /** Arms the unload guard while the record has unsaved changes. */
  dirty?: MaybeSignal<boolean>;
  /** One entry per region the body renders; the switch appears from two upwards. Static. */
  paneLabels?: Partial<Record<EditorPane, string>>;
  /** Omit to let the controller own the narrow-screen pane selection. Ignored with `chrome`. */
  activePane?: MaybeSignal<EditorPane>;
  onActivePaneChange?: (pane: EditorPane) => void;
  class?: string;
  /** The `<EditorBody>` this toolbar belongs to. */
  children?: Child;
}

/**
 * The toolbar every record editor shares.
 *
 * It publishes the save state into the app chrome store rather than drawing
 * it: the app shell owns where the status is shown, and an editor should not
 * have to know. The pane switch lives here because it belongs in the toolbar,
 * but the panes it switches live in `EditorBody`, so the selection travels
 * through the shared `EditorChromeController`.
 */
export function EditorChrome({
  chrome: givenChrome,
  editorKey = "editor",
  back,
  title,
  center,
  right,
  appChrome = null,
  status = null,
  dirty = false,
  paneLabels,
  activePane,
  onActivePaneChange,
  class: className,
  children,
}: EditorChromeProps) {
  const chrome = givenChrome ?? createEditorChrome({
    editorKey,
    ...(activePane === undefined ? {} : { activePane }),
    ...(onActivePaneChange ? { onActivePaneChange } : {}),
  });
  const scope = getScope();
  bindEditorStatus(scope, appChrome, status);
  guardBeforeUnload(scope, dirty);

  const labels = paneLabels ?? DEFAULT_PANE_LABELS;
  const paneOptions: SegmentedOption<EditorPane>[] = [];
  for (const id of EDITOR_PANES) {
    const label = labels[id];
    if (label !== undefined) paneOptions.push({ value: id, label });
  }

  return (
    <div class={cx("cms-editor", className)}>
      <div class="cms-editor__toolbar">
        {back ? (
          <a class="cms-btn cms-btn--ghost cms-btn--icon" href={back.href} aria-label={back.label}>
            <ArrowLeftIcon />
          </a>
        ) : null}
        {title}
        {paneOptions.length > 1 ? (
          <div class="cms-editor__pane-switch">
            <SegmentedControl
              label="Pane"
              size="sm"
              options={paneOptions}
              value={computed(() => chrome.activePane.value)}
              onChange={(next) => chrome.setActivePane(next)}
            />
          </div>
        ) : null}
        {center ? <div class="cms-editor__center">{center}</div> : null}
        {right ? <div class="cms-editor__right">{right}</div> : null}
      </div>
      {children}
    </div>
  );
}
