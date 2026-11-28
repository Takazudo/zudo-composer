import { computed, getScope, Show, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { ArrowLeftIcon, ArrowRightIcon } from "../icons";
import { Rebuild } from "../rebuild";
import { Button } from "../ui/button";
import { cx } from "../ui/class-names";
import { createEditorChrome, createEditorRails } from "./editor-chrome-controller";
import type { EditorChromeController, EditorPane, EditorRailsController } from "./editor-chrome-controller";
import {
  CSS_VAR_INSP_W,
  CSS_VAR_NAV_W,
  MAX_RAIL_W,
  MIN_RAIL_W,
  readEditorWidths,
} from "./resizer-contract";
import type { EditorRail, EditorRailWidths } from "./resizer-contract";
import { installRailResizer } from "./resizer-dom";

interface RailButtonProps {
  rail: EditorRail;
  collapsed: boolean;
  label: string;
  onToggle: () => void;
  class?: string;
}

function RailButton({ rail, collapsed, label, onToggle, class: className }: RailButtonProps) {
  // The arrow points the way the rail is about to move.
  const pointsRight = rail === "nav" ? collapsed : !collapsed;
  const Icon = pointsRight ? ArrowRightIcon : ArrowLeftIcon;
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      class={className}
      aria-label={`${collapsed ? "Show" : "Hide"} ${label}`}
      aria-expanded={!collapsed}
      on:click={onToggle}
    >
      <Icon size="sm" />
    </Button>
  );
}

export interface RailCollapseButtonProps {
  rail: EditorRail;
  /** The rails controller the matching `EditorBody` was given. */
  rails: EditorRailsController;
  class?: string;
}

/**
 * The collapse control for one rail. It takes the rails controller rather than
 * collapse props so a consumer can drop it into its own `PaneHeader`, which is
 * where the prototype draws it — `EditorBody` never reaches into a pane it
 * does not own.
 *
 * It renders nothing once its rail is collapsed: the pane holding it is hidden
 * by then, and the collapsed rail's stub owns the restore control. A surface
 * that needs a toggle regardless of state (an overflow menu, a shortcut) calls
 * `rails.toggleRail` instead.
 *
 * `cms-editor__rail-toggle` is the hook the stylesheet uses to withdraw the
 * control at one column, where the stub that would restore the rail is hidden
 * too — offering a collapse with no way back is a dead end at phone width.
 */
export function RailCollapseButton({ rail, rails, class: className }: RailCollapseButtonProps) {
  const collapsed = rail === "nav" ? rails.navCollapsed : rails.inspCollapsed;
  return (
    <Show when={computed(() => !collapsed.value)}>
      {() => (
        <RailButton
          rail={rail}
          collapsed={false}
          label={rail === "nav" ? rails.navLabel : rails.inspLabel}
          onToggle={() => rails.toggleRail(rail)}
          class={cx("cms-editor__rail-toggle", className)}
        />
      )}
    </Show>
  );
}

export interface EditorBodyProps {
  /** The controller shared with the `EditorChrome` toolbar; a private inert one otherwise. */
  chrome?: EditorChromeController;
  /**
   * The rails controller shared with any `RailCollapseButton`. When given, it
   * owns the labels and collapse state, and the label/collapse props below are
   * ignored; otherwise `EditorBody` builds one from them.
   */
  rails?: EditorRailsController;
  /** Left rail. Omitted for an editor with no navigator. */
  nav?: Child;
  main: Child;
  /** Right rail. Omitted for a two-column editor. */
  inspector?: Child;
  /** Human names for the rails; they name the resizers and toggle buttons. */
  navLabel?: string;
  inspectorLabel?: string;
  /** Fresh-session widths, used until the editor's geometry is persisted. */
  defaultNavWidth?: number;
  defaultInspectorWidth?: number;
  /** Omit to let `EditorBody` own the collapse state. */
  navCollapsed?: boolean;
  inspectorCollapsed?: boolean;
  onNavCollapsedChange?: (collapsed: boolean) => void;
  onInspectorCollapsedChange?: (collapsed: boolean) => void;
  class?: string;
}

function hasSlot(children: Child): boolean {
  return children !== undefined && children !== null && children !== false;
}

interface ResizerProps {
  rail: EditorRail;
  label: string;
  editorKey: string;
  widths: EditorRailWidths;
  bodyRef: Ref<HTMLDivElement>;
  onToggleCollapse: () => void;
}

/** One separator, with its resizer installed for as long as it is mounted. */
function Resizer({ rail, label, editorKey, widths, bodyRef, onToggleCollapse }: ResizerProps) {
  const handleRef: Ref<HTMLDivElement> = { current: null };
  getScope().onActivate(() => {
    const host = bodyRef.current;
    const handle = handleRef.current;
    if (!host || !handle) return undefined;
    return installRailResizer(handle, {
      host,
      rail,
      editorKey,
      onChange: (width) => { widths[rail] = width; },
      onToggleCollapse,
    });
  });
  // The separators advertise the contract range, not the live joint clamp: the
  // effective maximum moves with the other rail and the viewport on every
  // commit, and those commits deliberately do not re-render the editor.
  return (
    <div
      ref={handleRef}
      class={`cms-editor__resizer cms-editor__resizer--${rail}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      aria-valuenow={Math.round(widths[rail])}
      aria-valuemin={MIN_RAIL_W}
      aria-valuemax={MAX_RAIL_W}
      tabindex={0}
    />
  );
}

/**
 * The three-pane editor body: `nav | resizer | main | resizer | inspector`.
 *
 * Rail widths live in the `--nav-w` / `--insp-w` custom properties on this
 * element and in `localStorage` under the chrome's `editorKey`; the resizer
 * writes them straight to the element, so a drag repaints one grid track
 * without touching either rail's subtree.
 *
 * Below 64rem the grid becomes one column and `EditorChrome`'s pane switch
 * decides which region is shown, through `data-pane-active`.
 */
export function EditorBody({
  chrome = createEditorChrome(),
  rails: givenRails,
  nav,
  main,
  inspector,
  navLabel = "Navigator",
  inspectorLabel = "Inspector",
  defaultNavWidth,
  defaultInspectorWidth,
  navCollapsed,
  inspectorCollapsed,
  onNavCollapsedChange,
  onInspectorCollapsedChange,
  class: className,
}: EditorBodyProps) {
  const rails = givenRails ?? createEditorRails({
    chrome,
    navLabel,
    inspectorLabel,
    ...(navCollapsed === undefined ? {} : { navCollapsed }),
    ...(inspectorCollapsed === undefined ? {} : { inspectorCollapsed }),
    ...(onNavCollapsedChange ? { onNavCollapsedChange } : {}),
    ...(onInspectorCollapsedChange ? { onInspectorCollapsedChange } : {}),
  });
  const bodyRef: Ref<HTMLDivElement> = { current: null };

  // Re-read whenever the editor identity changes; a record change inside one
  // editor deliberately keeps the geometry the author last chose.
  const geometry = computed(() => {
    const key = chrome.editorKey.value;
    return { key, widths: readEditorWidths(key, { nav: defaultNavWidth, insp: defaultInspectorWidth }) };
  });

  // A route expresses "this editor has no such rail" by passing nothing, and
  // a dropped branch is spelled null or false just as often as undefined.
  const hasNav = hasSlot(nav);
  const hasInspector = hasSlot(inspector);
  const navOff = rails.navCollapsed;
  const inspOff = rails.inspCollapsed;
  const navResizer = computed(() => hasNav && !navOff.value);
  const inspResizer = computed(() => hasInspector && !inspOff.value);
  const navStub = computed(() => hasNav && navOff.value);
  const inspStub = computed(() => hasInspector && inspOff.value);

  const paneActive = (pane: EditorPane) => computed(() => String(chrome.activePane.value === pane));

  return (
    <div
      ref={bodyRef}
      class={computed(() => cx(
        "cms-editor__body",
        !hasNav && "cms-editor__body--no-nav",
        !hasInspector && "cms-editor__body--no-insp",
        navStub.value && "nav-collapsed",
        inspStub.value && "insp-collapsed",
        className,
      ))}
      style={computed(() => `${CSS_VAR_NAV_W}:${geometry.value.widths.nav}px;${CSS_VAR_INSP_W}:${geometry.value.widths.insp}px`)}
    >
      {hasNav ? (
        <div class="cms-editor__region cms-editor__region--nav" data-pane="nav" data-pane-active={paneActive("nav")}>
          {nav}
        </div>
      ) : null}
      <Show when={navStub}>
        {() => (
          <div class="cms-editor__stub cms-editor__stub--nav">
            <RailButton rail="nav" collapsed label={rails.navLabel} onToggle={() => rails.toggleRail("nav")} />
          </div>
        )}
      </Show>
      <Show when={navResizer}>
        {() => (
          <Rebuild value={geometry}>
            {({ key, widths }) => <Resizer rail="nav" label={rails.navLabel} editorKey={key} widths={widths} bodyRef={bodyRef} onToggleCollapse={() => rails.toggleRail("nav")} />}
          </Rebuild>
        )}
      </Show>
      <div class="cms-editor__region cms-editor__region--main" data-pane="main" data-pane-active={paneActive("main")}>
        {main}
      </div>
      <Show when={inspResizer}>
        {() => (
          <Rebuild value={geometry}>
            {({ key, widths }) => <Resizer rail="insp" label={rails.inspLabel} editorKey={key} widths={widths} bodyRef={bodyRef} onToggleCollapse={() => rails.toggleRail("insp")} />}
          </Rebuild>
        )}
      </Show>
      <Show when={inspStub}>
        {() => (
          <div class="cms-editor__stub cms-editor__stub--insp">
            <RailButton rail="insp" collapsed label={rails.inspLabel} onToggle={() => rails.toggleRail("insp")} />
          </div>
        )}
      </Show>
      {hasInspector ? (
        <div class="cms-editor__region cms-editor__region--insp" data-pane="insp" data-pane-active={paneActive("insp")}>
          {inspector}
        </div>
      ) : null}
    </div>
  );
}
