import "./cleanup";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import { EditorBody, RailCollapseButton } from "../editor-body";
import { EditorChromeContext } from "../editor-chrome-context";
import type { EditorPane } from "../editor-chrome-context";
import {
  CSS_VAR_INSP_W,
  CSS_VAR_NAV_W,
  DEFAULT_INSP_W,
  DEFAULT_NAV_W,
  MAX_RAIL_W,
  MIN_RAIL_W,
  RAIL_STEP_W,
  railStorageKey,
} from "../resizer-contract";

const EDITOR_KEY = "composer";

interface HarnessProps {
  activePane?: EditorPane;
  nav?: ComponentChildren;
  inspector?: ComponentChildren;
  navCollapsed?: boolean;
  onNavCollapsedChange?: (collapsed: boolean) => void;
  defaultNavWidth?: number;
}

function Harness({
  activePane = "main",
  nav = <RailCollapseButton rail="nav" />,
  inspector = <RailCollapseButton rail="insp" />,
  ...rest
}: HarnessProps) {
  return (
    <EditorChromeContext.Provider value={{ editorKey: EDITOR_KEY, activePane, setActivePane: () => {} }}>
      <EditorBody
        navLabel="Structure"
        inspectorLabel="Inspector"
        nav={nav}
        main={<p>Canvas</p>}
        inspector={inspector}
        {...rest}
      />
    </EditorChromeContext.Provider>
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
  it("lays out nav, main and inspector as one grid with a separator between each", () => {
    render(<Harness />);

    expect(region("nav")).toBeInTheDocument();
    expect(region("main")).toBeInTheDocument();
    expect(region("insp")).toBeInTheDocument();
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("drops a rail's column and separator when the editor has no such rail", () => {
    render(
      <EditorChromeContext.Provider value={{ editorKey: EDITOR_KEY, activePane: "main", setActivePane: () => {} }}>
        <EditorBody nav={<p>Pages</p>} main={<p>Canvas</p>} />
      </EditorChromeContext.Provider>,
    );

    expect(document.querySelector('[data-pane="insp"]')).toBeNull();
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(body()).toHaveClass("cms-editor__body--no-insp");
  });

  it("treats a dropped rail branch as no rail at all", () => {
    render(
      <EditorChromeContext.Provider value={{ editorKey: EDITOR_KEY, activePane: "main", setActivePane: () => {} }}>
        <EditorBody nav={null} main={<p>Canvas</p>} inspector={false} />
      </EditorChromeContext.Provider>,
    );

    expect(document.querySelector('[data-pane="nav"]')).toBeNull();
    expect(document.querySelector('[data-pane="insp"]')).toBeNull();
    expect(screen.queryAllByRole("separator")).toHaveLength(0);
    expect(body()).toHaveClass("cms-editor__body--no-nav", "cms-editor__body--no-insp");
  });

  it("marks exactly the active pane, so the narrow single-column layout can pick one", () => {
    render(<Harness activePane="insp" />);

    expect(region("nav")).toHaveAttribute("data-pane-active", "false");
    expect(region("main")).toHaveAttribute("data-pane-active", "false");
    expect(region("insp")).toHaveAttribute("data-pane-active", "true");
  });
});

describe("EditorBody geometry", () => {
  // Ported from the Composer `restoreComposerWidths` case: the persisted widths
  // now land on the editor body rather than on `document.documentElement`.
  it("restores both persisted widths into the body's custom properties", () => {
    localStorage.setItem(railStorageKey(EDITOR_KEY, "nav"), "312");
    localStorage.setItem(railStorageKey(EDITOR_KEY, "insp"), "344");

    render(<Harness />);

    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe("312px");
    expect(body().style.getPropertyValue(CSS_VAR_INSP_W)).toBe("344px");
  });

  it("starts from the shared defaults, or the fresh-session width the editor asks for", () => {
    const { unmount } = render(<Harness />);
    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${DEFAULT_NAV_W}px`);
    expect(body().style.getPropertyValue(CSS_VAR_INSP_W)).toBe(`${DEFAULT_INSP_W}px`);
    unmount();

    render(<Harness defaultNavWidth={320} />);
    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe("320px");
  });

  it("declares the resizers as keyboard-operable window splitters", () => {
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

  it("resizes from the keyboard and persists the result under the editor's key", () => {
    render(<Harness />);
    const [nav] = screen.getAllByRole("separator");

    fireEvent.keyDown(nav, { key: "ArrowRight" });

    const expected = DEFAULT_NAV_W + RAIL_STEP_W;
    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${expected}px`);
    expect(nav).toHaveAttribute("aria-valuenow", String(expected));
    expect(localStorage.getItem(railStorageKey(EDITOR_KEY, "nav"))).toBe(String(expected));
    expect(localStorage.getItem(railStorageKey("sitemapper", "nav"))).toBeNull();
  });

  it("keeps a dragged width across an unrelated re-render", () => {
    const { rerender } = render(<Harness />);
    const [nav] = screen.getAllByRole("separator");

    fireEvent.keyDown(nav, { key: "ArrowRight" });
    rerender(<Harness activePane="nav" />);

    expect(body().style.getPropertyValue(CSS_VAR_NAV_W)).toBe(`${DEFAULT_NAV_W + RAIL_STEP_W}px`);
  });
});

describe("EditorBody collapse", () => {
  it("collapses a rail to a stub carrying the control that restores it", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Structure" }));

    expect(body()).toHaveClass("nav-collapsed");
    expect(screen.getAllByRole("separator")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Hide Structure" })).toBeNull();

    const restore = screen.getByRole("button", { name: "Show Structure" });
    expect(restore).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(restore);
    expect(body()).not.toHaveClass("nav-collapsed");
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("collapses the two rails independently", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Inspector" }));

    expect(body()).toHaveClass("insp-collapsed");
    expect(body()).not.toHaveClass("nav-collapsed");
    expect(screen.getByRole("button", { name: "Hide Structure" })).toBeInTheDocument();
  });

  it("collapses from the separator itself, per the ARIA splitter pattern", () => {
    render(<Harness />);
    const [nav] = screen.getAllByRole("separator");

    fireEvent.keyDown(nav, { key: "Enter" });

    expect(body()).toHaveClass("nav-collapsed");
  });

  it("lets the owning route drive the collapse state instead", () => {
    const onNavCollapsedChange = vi.fn();
    const { rerender } = render(<Harness navCollapsed={false} onNavCollapsedChange={onNavCollapsedChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Hide Structure" }));

    expect(onNavCollapsedChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(body()).not.toHaveClass("nav-collapsed");

    rerender(<Harness navCollapsed onNavCollapsedChange={onNavCollapsedChange} />);
    expect(body()).toHaveClass("nav-collapsed");
  });
});
