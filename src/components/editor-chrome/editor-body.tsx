import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ArrowLeftIcon, ArrowRightIcon } from "../icons";
import { Button } from "../ui/button";
import { cx } from "../ui/class-names";
import { EditorRailsContext, useEditorChrome, useEditorRails } from "./editor-chrome-context";
import type { EditorPane } from "./editor-chrome-context";
import {
  CSS_VAR_INSP_W,
  CSS_VAR_NAV_W,
  MAX_RAIL_W,
  MIN_RAIL_W,
  railCollapsedStorageKey,
  readEditorCollapsed,
  readEditorWidths,
  setPersistedCollapsed,
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
      onClick={onToggle}
    >
      <Icon size="sm" />
    </Button>
  );
}

export interface RailCollapseButtonProps {
  rail: EditorRail;
  class?: string;
}

/**
 * The collapse control for one rail. It reads `EditorBody`'s context rather
 * than taking props so a consumer can drop it into its own `PaneHeader`, which
 * is where the prototype draws it — `EditorBody` never reaches into a pane it
 * does not own.
 *
 * It renders nothing once its rail is collapsed: the pane holding it is hidden
 * by then, and the collapsed rail's stub owns the restore control. A surface
 * that needs a toggle regardless of state (an overflow menu, a shortcut) calls
 * `useEditorRails().toggleRail` instead.
 *
 * `cms-editor__rail-toggle` is the hook the stylesheet uses to withdraw the
 * control at one column, where the stub that would restore the rail is hidden
 * too — offering a collapse with no way back is a dead end at phone width.
 */
export function RailCollapseButton({ rail, class: className }: RailCollapseButtonProps) {
  const { navCollapsed, inspCollapsed, navLabel, inspLabel, toggleRail } = useEditorRails();
  if (rail === "nav" ? navCollapsed : inspCollapsed) return null;
  return (
    <RailButton
      rail={rail}
      collapsed={false}
      label={rail === "nav" ? navLabel : inspLabel}
      onToggle={() => toggleRail(rail)}
      class={cx("cms-editor__rail-toggle", className)}
    />
  );
}

export interface EditorBodyProps {
  /** Left rail. Omitted for an editor with no navigator. */
  nav?: ComponentChildren;
  main: ComponentChildren;
  /** Right rail. Omitted for a two-column editor. */
  inspector?: ComponentChildren;
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

function hasSlot(children: ComponentChildren): boolean {
  return children !== undefined && children !== null && children !== false;
}

/**
 * The three-pane editor body: `nav | resizer | main | resizer | inspector`.
 *
 * Rail widths live in the `--nav-w` / `--insp-w` custom properties on this
 * element and in `localStorage` under the `editorKey` published by
 * `EditorChrome`; they are held in a ref rather than state so a drag repaints
 * one grid track instead of re-rendering both rails on every pointer move.
 *
 * Below 64rem the grid becomes one column and `EditorChrome`'s pane switch
 * decides which region is shown, through `data-pane-active`.
 */
export function EditorBody({
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
  const { editorKey, activePane } = useEditorChrome();
  const bodyRef = useRef<HTMLDivElement>(null);
  const navHandleRef = useRef<HTMLDivElement>(null);
  const inspHandleRef = useRef<HTMLDivElement>(null);

  // Re-read whenever the editor identity changes; a record change inside one
  // editor deliberately keeps the geometry the author last chose.
  const geometry = useRef<{ key: string; widths: EditorRailWidths } | null>(null);
  if (geometry.current === null || geometry.current.key !== editorKey) {
    geometry.current = {
      key: editorKey,
      widths: readEditorWidths(editorKey, { nav: defaultNavWidth, insp: defaultInspectorWidth }),
    };
  }
  const widths = geometry.current.widths;

  // Collapse is persisted per editor and per rail, exactly as the widths above
  // are: a rail an author put away is still away after a reload. A route that
  // drives the collapse itself owns its own persistence, so nothing is written
  // for a controlled rail.
  const [collapse, setCollapse] = useState(() => readEditorCollapsed(editorKey));
  const collapseKey = useRef(editorKey);
  useEffect(() => {
    if (collapseKey.current === editorKey) return;
    collapseKey.current = editorKey;
    setCollapse(readEditorCollapsed(editorKey));
  }, [editorKey]);

  function railCollapse(
    rail: EditorRail,
    controlled: boolean | undefined,
    onChange: ((collapsed: boolean) => void) | undefined,
  ): readonly [boolean, () => void] {
    const collapsed = controlled ?? collapse[rail];
    return [
      collapsed,
      () => {
        if (controlled === undefined) {
          setCollapse((current) => ({ ...current, [rail]: !collapsed }));
          setPersistedCollapsed(railCollapsedStorageKey(editorKey, rail), !collapsed);
        }
        onChange?.(!collapsed);
      },
    ];
  }

  const [navOff, toggleNav] = railCollapse("nav", navCollapsed, onNavCollapsedChange);
  const [inspOff, toggleInsp] = railCollapse("insp", inspectorCollapsed, onInspectorCollapsedChange);
  // The resizers are installed once per rail, so they reach the current toggle
  // through a ref instead of re-installing on every render.
  const toggles = useRef({ nav: toggleNav, insp: toggleInsp });
  toggles.current = { nav: toggleNav, insp: toggleInsp };

  // A route expresses "this editor has no such rail" by passing nothing, and
  // Preact spells a dropped branch as null or false just as often as undefined.
  const hasNav = hasSlot(nav);
  const hasInspector = hasSlot(inspector);
  const navResizer = hasNav && !navOff;
  const inspResizer = hasInspector && !inspOff;

  useEffect(() => {
    const host = bodyRef.current;
    const handle = navHandleRef.current;
    if (!host || !handle) return undefined;
    return installRailResizer(handle, {
      host,
      rail: "nav",
      editorKey,
      onChange: (width) => { widths.nav = width; },
      onToggleCollapse: () => toggles.current.nav(),
    });
  }, [editorKey, navResizer, widths]);

  useEffect(() => {
    const host = bodyRef.current;
    const handle = inspHandleRef.current;
    if (!host || !handle) return undefined;
    return installRailResizer(handle, {
      host,
      rail: "insp",
      editorKey,
      onChange: (width) => { widths.insp = width; },
      onToggleCollapse: () => toggles.current.insp(),
    });
  }, [editorKey, inspResizer, widths]);

  const paneActive = (pane: EditorPane) => String(activePane === pane);

  // The separators advertise the contract range, not the live joint clamp: the
  // effective maximum moves with the other rail and the viewport on every
  // commit, and those commits deliberately do not re-render the editor.
  const range = { "aria-valuemin": MIN_RAIL_W, "aria-valuemax": MAX_RAIL_W };

  return (
    <EditorRailsContext.Provider
      value={{
        navCollapsed: navOff,
        inspCollapsed: inspOff,
        navLabel,
        inspLabel: inspectorLabel,
        toggleRail: (rail) => toggles.current[rail](),
      }}
    >
      <div
        ref={bodyRef}
        class={cx(
          "cms-editor__body",
          !hasNav && "cms-editor__body--no-nav",
          !hasInspector && "cms-editor__body--no-insp",
          hasNav && navOff && "nav-collapsed",
          hasInspector && inspOff && "insp-collapsed",
          className,
        )}
        style={`${CSS_VAR_NAV_W}:${widths.nav}px;${CSS_VAR_INSP_W}:${widths.insp}px`}
      >
        {hasNav ? (
          <div class="cms-editor__region cms-editor__region--nav" data-pane="nav" data-pane-active={paneActive("nav")}>
            {nav}
          </div>
        ) : null}
        {hasNav && navOff ? (
          <div class="cms-editor__stub cms-editor__stub--nav">
            <RailButton rail="nav" collapsed label={navLabel} onToggle={() => toggles.current.nav()} />
          </div>
        ) : null}
        {navResizer ? (
          <div
            ref={navHandleRef}
            class="cms-editor__resizer cms-editor__resizer--nav"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${navLabel}`}
            aria-valuenow={Math.round(widths.nav)}
            {...range}
            tabIndex={0}
          />
        ) : null}
        <div class="cms-editor__region cms-editor__region--main" data-pane="main" data-pane-active={paneActive("main")}>
          {main}
        </div>
        {inspResizer ? (
          <div
            ref={inspHandleRef}
            class="cms-editor__resizer cms-editor__resizer--insp"
            role="separator"
            aria-orientation="vertical"
            aria-label={`Resize ${inspectorLabel}`}
            aria-valuenow={Math.round(widths.insp)}
            {...range}
            tabIndex={0}
          />
        ) : null}
        {hasInspector && inspOff ? (
          <div class="cms-editor__stub cms-editor__stub--insp">
            <RailButton rail="insp" collapsed label={inspectorLabel} onToggle={() => toggles.current.insp()} />
          </div>
        ) : null}
        {hasInspector ? (
          <div class="cms-editor__region cms-editor__region--insp" data-pane="insp" data-pane-active={paneActive("insp")}>
            {inspector}
          </div>
        ) : null}
      </div>
    </EditorRailsContext.Provider>
  );
}
