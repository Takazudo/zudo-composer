import "./cleanup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signal, type Child } from "@takazudo/zfb/zudo-react";
import { fireEvent, render, screen, settle } from "../../../test/render";
import { EditorBody, RailCollapseButton } from "../editor-body";
import { createEditorChrome, createEditorRails } from "../editor-chrome-controller";
import type { EditorPane, EditorRailsController } from "../editor-chrome-controller";
import type { MaybeSignal } from "../../reactive";
import {
  CSS_VAR_INSP_W,
  CSS_VAR_NAV_W,
  DEFAULT_INSP_W,
  DEFAULT_NAV_W,
  MAX_RAIL_W,
  MIN_RAIL_W,
  RAIL_STEP_W,
  railStorageKey,
  readEditorCollapsed,
  writeEditorCollapsed,
} from "../resizer-contract";

const EDITOR_KEY = "composer";

interface HarnessProps {
  editorKey?: MaybeSignal<string>;
  activePane?: MaybeSignal<EditorPane>;
  nav?: (rails: EditorRailsController) => Child;
  inspector?: (rails: EditorRailsController) => Child;
  navCollapsed?: MaybeSignal<boolean>;
  onNavCollapsedChange?: (collapsed: boolean) => void;
  defaultNavWidth?: number;
}

function Harness({
  editorKey = EDITOR_KEY,
  activePane = "main",
  nav = (rails) => <RailCollapseButton rail="nav" rails={rails} />,
  inspector = (rails) => <RailCollapseButton rail="insp" rails={rails} />,
  navCollapsed,
  onNavCollapsedChange,
  defaultNavWidth,
}: HarnessProps) {
  const chrome = createEditorChrome({ editorKey, activePane });
  const rails = createEditorRails({
    chrome,
    navLabel: "Structure",
    inspectorLabel: "Inspector",
    ...(navCollapsed === undefined ? {} : { navCollapsed }),
    ...(onNavCollapsedChange ? { onNavCollapsedChange } : {}),
  });
  return (
    <EditorBody
      chrome={chrome}
      rails={rails}
      nav={nav(rails)}
      main={<p>Canvas</p>}
      inspector={inspector(rails)}
      {...(defaultNavWidth === undefined ? {} : { defaultNavWidth })}
    />
  );
}

function body(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".cms-editor__body");
  if (!element) throw new Error("no editor body rendered");
  return element;
}

function region(pane: EditorPane): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-pane="${pane}"]`);
  if (!element) throw new Error(`no ${pane} region rendered`);
  return element;
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("innerWidth", 1600);
});

describe("EditorBody layout", () => {
  it("lays out nav, main and inspector as one grid with a separator between each", async () => {
    render(<Harness />);

    expect(region("nav")).toBeInTheDocument();
    expect(region("main")).toBeInTheDocument();
    expect(region("insp")).toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("drops a rail's column and separator when the editor has no such rail", async () => {
    render(
      <EditorBody chrome={createEditorChrome({ editorKey: EDITOR_KEY })} nav={<p>Pages</p>} main={<p>Canvas</p>} />,
    );

    expect(document.querySelector('[data-pane="insp"]')).toBeNull();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(body()).toHaveClass("cms-editor__body--no-insp");
  });

  it("treats a dropped rail branch as no rail at all", async () => {
    render(
      <EditorBody chrome={createEditorChrome({ editorKey: EDITOR_KEY })} nav={null} main={<p>Canvas</p>} inspector={false} />,
    );

    expect(document.querySelector('[data-pane="nav"]')).toBeNull();
    expect(document.querySelector('[data-pane="insp"]')).toBeNull();
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(body()).toHaveClass("cms-editor__body--no-nav", "cms-editor__body--no-insp");
  });

  it("marks exactly the active pane, so the narrow single-column layout can pick one", async () => {
    render(<Harness activePane="insp" />);

    expect(region("nav")).toHaveAttribute("data-pane-active", "false");
    expect(region("main")).toHaveAttribute("data-pane-active", "false");
    expect(region("insp")).toHaveAttribute("data-pane-active", "true");
  });
});

describe("EditorBody geometry", () => {
  // Ported from the Composer `restoreComposerWidths` case: the persisted widths
  // now land on the editor body rather than on `document.documentElement`.
  it("restores both persisted widths into the body's custom properties", async () => {
    localStorage.setItem(railStorageKey(EDITOR_KEY, "nav"), "312");
    localStorage.setItem(railStorageKey(EDITOR_KEY, "insp"), "344");

    render(<Harness />);

    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe("312px");
    expect(body().style.getPropertyValue(CSS_VAR_INSP_W)).toBe("344px");
  });

  it("starts from the shared defaults, or the fresh-session width the editor asks for", async () => {
    const { unmount } = render(<Harness />);
    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${DEFAULT_NAV_W}px`);
    expect(body().style.getPropertyValue(CSS_VAR_INSP_W)).toBe(`${DEFAULT_INSP_W}px`);
    unmount();

    render(<Harness defaultNavWidth={320} />);
    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe("320px");
  });

  it("declares the resizers as keyboard-operable window splitters", async () => {
    render(<Harness />);
    const [nav, insp] = screen.getAllByRole("separator");

    expect(nav).toHaveAccessibleName("Resize Structure");
    expect(nav).toHaveAttribute("aria-orientation", "vertical");
    expect(nav).toHaveAttribute("tabindex", "0");
    expect(nav).toHaveAttribute("aria-valuenow", String(DEFAULT_NAV_W));
    expect(nav).toHaveAttribute("aria-valuemin", String(MIN_RAIL_W));
    expect(nav).toHaveAttribute("aria-valuemax", String(MAX_RAIL_W));
    expect(insp).toHaveAccessibleName("Resize Inspector");
    expect(insp).toHaveAttribute("aria-valuenow", String(DEFAULT_INSP_W));
  });

  it("resizes from the keyboard and persists the result under the editor's key", async () => {
    render(<Harness />);
    const [nav] = screen.getAllByRole("separator");

    fireEvent.keyDown(nav, { key: "ArrowRight" });
    await settle();

    const expected = DEFAULT_NAV_W + RAIL_STEP_W;
    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${expected}px`);
    expect(nav).toHaveAttribute("aria-valuenow", String(expected));
    expect(localStorage.getItem(railStorageKey(EDITOR_KEY, "nav"))).toBe(String(expected));
    expect(localStorage.getItem(railStorageKey("sitemapper", "nav"))).toBeNull();
  });

  it("keeps a dragged width across an unrelated re-render", async () => {
    const activePane = signal<EditorPane>("main");
    render(<Harness activePane={activePane} />);
    const [nav] = screen.getAllByRole("separator");

    fireEvent.keyDown(nav, { key: "ArrowRight" });
    await settle();
    activePane.value = "nav";
    await settle();

    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${DEFAULT_NAV_W + RAIL_STEP_W}px`);
  });
});

describe("EditorBody collapse", () => {
  it("collapses a rail to a stub carrying the control that restores it", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Structure" }));
    await settle();

    expect(body()).toHaveClass("nav-collapsed");
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Hide Structure" })).toBeNull();

    const restore = screen.getByRole("button", { name: "Show Structure" });
    expect(restore).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(restore);
    await settle();
    expect(body()).not.toHaveClass("nav-collapsed");
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("marks the in-pane control so the one-column layout can withdraw it", async () => {
    render(<Harness />);

    // At one column there is nothing to collapse and the stub that restores a
    // rail is hidden, so the stylesheet hides this control by the same class.
    expect(screen.getByRole("button", { name: "Hide Structure" })).toHaveClass("cms-editor__rail-toggle");
    expect(screen.getByRole("button", { name: "Hide Inspector" })).toHaveClass("cms-editor__rail-toggle");
  });

  it("collapses the two rails independently", async () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Inspector" }));
    await settle();

    expect(body()).toHaveClass("insp-collapsed");
    expect(body()).not.toHaveClass("nav-collapsed");
    expect(screen.getByRole("button", { name: "Hide Structure" })).toBeInTheDocument();
  });

  it("collapses from the separator itself, per the ARIA splitter pattern", async () => {
    render(<Harness />);
    const [nav] = screen.getAllByRole("separator");

    fireEvent.keyDown(nav, { key: "Enter" });
    await settle();

    expect(body()).toHaveClass("nav-collapsed");
  });

  it("lets the owning route drive the collapse state instead", async () => {
    const onNavCollapsedChange = vi.fn();
    const navCollapsed = signal(false);
    render(<Harness navCollapsed={navCollapsed} onNavCollapsedChange={onNavCollapsedChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Structure" }));
    await settle();

    expect(onNavCollapsedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(body()).not.toHaveClass("nav-collapsed");

    navCollapsed.value = true;
    await settle();
    expect(body()).toHaveClass("nav-collapsed");
  });

  it("remembers a self-owned collapse, so a rail put away stays away across a reload", async () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Hide Structure" }));
    await settle();
    expect(readEditorCollapsed(EDITOR_KEY)).toEqual({ nav: true, insp: false });
    first.unmount();

    render(<Harness />);

    expect(body()).toHaveClass("nav-collapsed");
    expect(screen.getByRole("button", { name: "Show Structure" })).toBeInTheDocument();
  });

  it("restores a rail again, so the collapse is remembered in both directions", async () => {
    writeEditorCollapsed(EDITOR_KEY, "nav", true);
    const first = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Show Structure" }));
    await settle();
    expect(readEditorCollapsed(EDITOR_KEY).nav).toBe(false);
    first.unmount();

    render(<Harness />);

    expect(body()).not.toHaveClass("nav-collapsed");
  });

  it("leaves persistence to a route that drives the collapse itself", async () => {
    render(<Harness navCollapsed={false} onNavCollapsedChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Structure" }));
    await settle();

    expect(readEditorCollapsed(EDITOR_KEY).nav).toBe(false);
  });

  it("re-reads the collapse state when the editor identity changes", async () => {
    writeEditorCollapsed("mapping", "insp", true);
    const editorKey = signal(EDITOR_KEY);
    render(<Harness editorKey={editorKey} />);
    expect(body()).not.toHaveClass("insp-collapsed");

    editorKey.value = "mapping";
    await settle();

    expect(body()).toHaveClass("insp-collapsed");
  });
});
