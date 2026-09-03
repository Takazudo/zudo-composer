import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { useEditorStatus } from "../../app/chrome-context";
import type { EditorStatus } from "../../app/chrome-context";
import { ArrowLeftIcon } from "../icons";
import { cx } from "../ui/class-names";
import { SegmentedControl } from "../ui/segmented-control";
import type { SegmentedOption } from "../ui/segmented-control";
import { EDITOR_PANES, EditorChromeContext } from "./editor-chrome-context";
import type { EditorPane } from "./editor-chrome-context";
import { useBeforeUnloadGuard } from "./use-before-unload-guard";

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
  /** Names the persisted rail geometry — one per editor surface, not per record. */
  editorKey: string;
  back?: EditorChromeBackLink;
  /** The record's name; normally a `<RecordTitle>`. */
  title?: ComponentChildren;
  /** Mode and viewport style controls, centred and hidden on narrow screens. */
  center?: ComponentChildren;
  /** Record actions, pinned to the inline end. */
  right?: ComponentChildren;
  /** Published to the app chrome: Saved / Unsaved changes / Saving… / Save failed. */
  status?: EditorStatus | null;
  /** Arms the unload guard while the record has unsaved changes. */
  dirty?: boolean;
  /** One entry per region the body renders; the switch appears from two upwards. */
  paneLabels?: Partial<Record<EditorPane, string>>;
  /** Omit to let `EditorChrome` own the narrow-screen pane selection. */
  activePane?: EditorPane;
  onActivePaneChange?: (pane: EditorPane) => void;
  class?: string;
  /** The `<EditorBody>` this toolbar belongs to. */
  children?: ComponentChildren;
}

/**
 * The toolbar every record editor shares, plus the context its body reads.
 *
 * It publishes the save state through `useEditorStatus` rather than drawing it:
 * the app shell owns where the status is shown, and an editor should not have
 * to know. The pane switch lives here because it belongs in the toolbar, but
 * the panes it switches live in `EditorBody`, so the selection travels down
 * through `EditorChromeContext`.
 */
export function EditorChrome({
  editorKey,
  back,
  title,
  center,
  right,
  status,
  dirty = false,
  paneLabels,
  activePane,
  onActivePaneChange,
  class: className,
  children,
}: EditorChromeProps) {
  const [internalPane, setInternalPane] = useState<EditorPane>("main");
  const pane = activePane ?? internalPane;

  useEditorStatus(status ?? null);
  useBeforeUnloadGuard(dirty);

  function selectPane(next: EditorPane) {
    if (activePane === undefined) setInternalPane(next);
    onActivePaneChange?.(next);
  }

  const labels = paneLabels ?? DEFAULT_PANE_LABELS;
  const paneOptions: SegmentedOption<EditorPane>[] = [];
  for (const id of EDITOR_PANES) {
    const label = labels[id];
    if (label !== undefined) paneOptions.push({ value: id, label });
  }

  return (
    <EditorChromeContext.Provider value={{ editorKey, activePane: pane, setActivePane: selectPane }}>
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
                value={pane}
                onChange={selectPane}
              />
            </div>
          ) : null}
          {center ? <div class="cms-editor__center">{center}</div> : null}
          {right ? <div class="cms-editor__right">{right}</div> : null}
        </div>
        {children}
      </div>
    </EditorChromeContext.Provider>
  );
}
