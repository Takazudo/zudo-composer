import "./cleanup";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/preact";
import { Button } from "../../ui";
import { OutlineTree } from "../index";
import { outlinePrefsStorageKey } from "../prefs";
import type { OutlineNode } from "../types";
import { NODES, ROW_ORDER } from "./nodes";

afterEach(() => {
  localStorage.clear();
});

/** DOM order equals the visible row order, so a row is found by its id. */
/** Focus is what moves the roving tab stop, so it must settle before asserting. */
function focus(element: HTMLElement) {
  act(() => {
    element.focus();
  });
}

function item(id: string): HTMLElement {
  const items = screen.getAllByRole("treeitem");
  const index = ROW_ORDER.indexOf(id);
  expect(index, `${id} is not a row of the open fixture`).toBeGreaterThan(-1);
  return items[index];
}

function addLabel(parent: OutlineNode | null): string {
  return parent === null ? "Add root page" : `Add under ${parent.title}`;
}

describe("structure", () => {
  it("names the tree and exposes level, position and set size on every row", () => {
    render(<OutlineTree nodes={NODES} label="Site pages" />);
    const tree = screen.getByRole("tree", { name: "Site pages" });
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(ROW_ORDER.length);

    expect(item("home")).toHaveAttribute("aria-level", "1");
    expect(item("home")).toHaveAttribute("aria-setsize", "2");
    expect(item("pricing")).toHaveAttribute("aria-level", "3");
    expect(item("pricing")).toHaveAttribute("aria-posinset", "2");
    expect(item("pricing")).toHaveAttribute("aria-setsize", "2");
    expect(item("pricing")).not.toHaveAttribute("aria-expanded");
    expect(item("products")).toHaveAttribute("aria-expanded", "true");
  });

  it("labels each children list as a group so the levels are navigable", () => {
    render(<OutlineTree nodes={NODES} />);
    expect(screen.getByRole("group", { name: "Products" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Products" })).getAllByRole("treeitem")).toHaveLength(2);
  });

  it("puts the title first — a row carries a » mark, never a leading icon", () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    const leaf = container.querySelector(".cms-tree-leaf");
    expect(leaf?.firstElementChild).toHaveClass("cms-tree-title");
    expect(leaf?.querySelector("svg")).toBeNull();
    expect(container.querySelector(".cms-tree-cat__link")?.firstElementChild?.textContent).toBe("»");
  });

  it("renders the quiet slot variant, the tag and the status dot from the node", () => {
    const nodes: readonly OutlineNode[] = [
      {
        id: "doc",
        kind: "category",
        title: "Document",
        children: [
          {
            id: "content",
            kind: "group",
            title: "content",
            slug: "slot",
            variant: "slot",
            children: [{ id: "heading", kind: "leaf", title: "SectionHeading", hint: "Build a clear…" }],
          },
        ],
      },
    ];
    const { container } = render(<OutlineTree nodes={nodes} />);
    expect(container.querySelector(".cms-tree-group__row--slot")?.textContent).toContain("content");
    expect(container.querySelector(".cms-tree-hint")?.textContent).toBe("Build a clear…");

    const withStatus = render(<OutlineTree nodes={NODES} />);
    expect(withStatus.container.querySelector(".cms-tree-dot--warn")).toHaveAttribute("title", "Unassigned");
    expect(withStatus.container.querySelector(".cms-tree-tag")?.textContent).toBe("single");
  });

  it("renders the hover-only actions slot only when the host fills it", () => {
    const { container, rerender } = render(<OutlineTree nodes={NODES} />);
    expect(container.querySelectorAll(".cms-tree-acts")).toHaveLength(0);
    rerender(<OutlineTree nodes={NODES} renderActions={(node) => <Button size="xs">{node.title}</Button>} />);
    expect(container.querySelectorAll(".cms-tree-acts")).toHaveLength(ROW_ORDER.length);
  });
});

describe("connectors", () => {
  it("sets --depth on every connected element so the dashes line up", () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    const products = container.querySelector<HTMLElement>(".cms-tree-group__header");
    expect(products?.style.getPropertyValue("--depth")).toBe("1");
    expect(container.querySelector<HTMLElement>(".cms-tree-spine")?.style.getPropertyValue("--depth")).toBe("1");

    const leaves = container.querySelectorAll<HTMLElement>(".cms-tree-leaf-wrap");
    expect(leaves[0].style.getPropertyValue("--depth")).toBe("2");
    expect(leaves[2].style.getPropertyValue("--depth")).toBe("1");
    for (const leaf of leaves) {
      expect(leaf.querySelector(".cms-tree-vline")).not.toBeNull();
      expect(leaf.querySelector(".cms-tree-hline")).not.toBeNull();
    }
  });

  it("gives is-last to the final node of a list, and drops that group's spine", () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    const groups = container.querySelectorAll(".cms-tree-group");
    expect(groups[0]).not.toHaveClass("is-last");
    expect(groups[0].querySelector(":scope > .cms-tree-spine")).not.toBeNull();

    const docs = groups[1];
    expect(docs).toHaveClass("is-last");
    expect(docs.querySelector(":scope > .cms-tree-group__header")).toHaveClass("is-last");
    expect(docs.querySelector(":scope > .cms-tree-spine")).toBeNull();
    expect(container.querySelector(".cms-tree-leaf-wrap.is-last")?.textContent).toContain("Pricing");
  });

  it("hands is-last to the terminal add row instead once one is rendered", () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    expect(container.querySelector(".cms-tree-group.is-last")).toBeNull();
    expect(container.querySelectorAll(".cms-tree-leaf-wrap.is-last")).toHaveLength(0);
    for (const add of container.querySelectorAll(".cms-tree-add-wrap")) expect(add).toHaveClass("is-last");
  });
});

describe("expansion", () => {
  it("opens everything when the host keeps no state of its own", () => {
    render(<OutlineTree nodes={NODES} />);
    expect(screen.getAllByRole("treeitem")).toHaveLength(ROW_ORDER.length);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Products" }));
    expect(screen.queryByRole("treeitem", { name: /Product overview/ })).toBeNull();
    expect(item("products")).toHaveAttribute("aria-expanded", "false");
  });

  it("stays controlled: the toggle reports the change and renders nothing new", () => {
    const onExpandedChange = vi.fn();
    render(<OutlineTree nodes={NODES} expandedIds={["home"]} onExpandedChange={onExpandedChange} />);
    expect(screen.queryByRole("treeitem", { name: /Product overview/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Products" }));
    expect(onExpandedChange).toHaveBeenCalledWith(["home", "products"]);
    expect(screen.queryByRole("treeitem", { name: /Product overview/ })).toBeNull();
  });

  it("reports Collapse all and Open all in the tree's own order", () => {
    const onExpandedChange = vi.fn();
    render(<OutlineTree nodes={NODES} expandedIds={["home", "products", "docs"]} onExpandedChange={onExpandedChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(onExpandedChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: "Open all" }));
    expect(onExpandedChange).toHaveBeenLastCalledWith(["home", "products", "docs"]);
  });
});

describe("preferences", () => {
  it("shows both columns by default and stores each change under prefKey", () => {
    const { container } = render(<OutlineTree nodes={NODES} prefKey="sitemapper" />);
    const tree = container.firstElementChild;
    expect(tree).toHaveClass("cms-tree--show-slug", "cms-tree--show-count");

    fireEvent.click(screen.getByRole("switch", { name: "Show slug" }));
    expect(tree).not.toHaveClass("cms-tree--show-slug");
    expect(tree).toHaveClass("cms-tree--show-count");
    expect(localStorage.getItem(outlinePrefsStorageKey("sitemapper"))).toBe('{"slug":false,"count":true}');
  });

  it("reads the stored choice back on the next mount", () => {
    localStorage.setItem(outlinePrefsStorageKey("sitemapper"), '{"slug":false,"count":false}');
    const { container } = render(<OutlineTree nodes={NODES} prefKey="sitemapper" />);
    expect(container.firstElementChild).not.toHaveClass("cms-tree--show-slug");
    expect(container.firstElementChild).not.toHaveClass("cms-tree--show-count");
  });

  it("keeps the choice to itself without a prefKey", () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    fireEvent.click(screen.getByRole("switch", { name: "Show count" }));
    expect(container.firstElementChild).not.toHaveClass("cms-tree--show-count");
    expect(localStorage.length).toBe(0);
  });

  it("hides the toolbar on request", () => {
    render(<OutlineTree nodes={NODES} showToolbar={false} />);
    expect(screen.queryByRole("switch", { name: "Show slug" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse all" })).toBeNull();
  });
});

describe("selection", () => {
  it("marks the selected row and reports a click on another", () => {
    const onSelect = vi.fn();
    render(<OutlineTree nodes={NODES} selectedId="about" onSelect={onSelect} />);
    expect(item("about")).toHaveAttribute("aria-selected", "true");
    expect(item("pricing")).toHaveAttribute("aria-selected", "false");

    fireEvent.click(item("pricing"));
    expect(onSelect).toHaveBeenCalledWith("pricing");
  });

  it("opens on a double click", () => {
    const onOpen = vi.fn();
    render(<OutlineTree nodes={NODES} onOpen={onOpen} />);
    fireEvent.dblClick(item("pricing"));
    expect(onOpen).toHaveBeenCalledWith("pricing");
  });

  it("starts the tab order on the selected row, and moves it with the focus", () => {
    render(<OutlineTree nodes={NODES} selectedId="about" />);
    expect(item("about")).toHaveAttribute("tabindex", "0");
    expect(item("home")).toHaveAttribute("tabindex", "-1");

    focus(item("pricing"));
    expect(item("pricing")).toHaveAttribute("tabindex", "0");
    expect(item("about")).toHaveAttribute("tabindex", "-1");
  });

  it("falls back to the first row when nothing is selected", () => {
    render(<OutlineTree nodes={NODES} />);
    expect(item("home")).toHaveAttribute("tabindex", "0");
  });
});

describe("keyboard", () => {
  it("moves down, up, and to either end of the visible rows", () => {
    render(<OutlineTree nodes={NODES} />);
    focus(item("home"));
    fireEvent.keyDown(item("home"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(item("products"));

    fireEvent.keyDown(item("products"), { key: "ArrowUp" });
    expect(document.activeElement).toBe(item("home"));

    fireEvent.keyDown(item("home"), { key: "End" });
    expect(document.activeElement).toBe(item("settings"));

    fireEvent.keyDown(item("settings"), { key: "Home" });
    expect(document.activeElement).toBe(item("home"));
  });

  it("expands with Right, then steps into the first child", () => {
    const onExpandedChange = vi.fn();
    render(<OutlineTree nodes={NODES} onExpandedChange={onExpandedChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Products" }));

    const products = screen.getAllByRole("treeitem")[1];
    focus(products);
    fireEvent.keyDown(products, { key: "ArrowRight" });
    expect(onExpandedChange).toHaveBeenLastCalledWith(["home", "products", "docs"]);
    expect(item("products")).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(item("products"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(item("overview"));
  });

  it("collapses with Left, and from a leaf steps out to the parent", () => {
    render(<OutlineTree nodes={NODES} />);
    focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("products"));

    fireEvent.keyDown(item("products"), { key: "ArrowLeft" });
    expect(screen.getAllByRole("treeitem")[1]).toHaveAttribute("aria-expanded", "false");
  });

  it("selects and opens on Enter", () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(<OutlineTree nodes={NODES} onSelect={onSelect} onOpen={onOpen} />);
    focus(item("pricing"));
    fireEvent.keyDown(item("pricing"), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("pricing");
    expect(onOpen).toHaveBeenCalledWith("pricing");
  });

  it("asks for a new sibling below the row on a and on +", () => {
    const onRequestInsert = vi.fn();
    const { rerender } = render(<OutlineTree nodes={NODES} onRequestInsert={onRequestInsert} />);
    focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "a" });
    expect(onRequestInsert).toHaveBeenLastCalledWith({ parentId: "products", index: 1 });

    fireEvent.keyDown(item("home"), { key: "+" });
    expect(onRequestInsert).toHaveBeenLastCalledWith({ parentId: null, index: 1 });

    rerender(<OutlineTree nodes={NODES} onRequestInsert={onRequestInsert} canInsert={() => false} />);
    onRequestInsert.mockClear();
    fireEvent.keyDown(item("overview"), { key: "a" });
    expect(onRequestInsert).not.toHaveBeenCalled();
  });

  it("opens the inline editor at the row the shortcut was pressed on", () => {
    render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "a" });
    expect(screen.getByRole("textbox", { name: "Insert before Pricing" })).toBeInTheDocument();
  });

  it("ignores keys it does not own", () => {
    const onOpen = vi.fn();
    render(<OutlineTree nodes={NODES} onOpen={onOpen} />);
    focus(item("home"));
    fireEvent.keyDown(item("home"), { key: "b" });
    expect(document.activeElement).toBe(item("home"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("insert affordance", () => {
  it("puts a zero-height insert point between every pair of siblings, with its hit zone and tile", () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    // 1 between the two categories, 2 under Home, 1 under Products.
    const gaps = container.querySelectorAll(".cms-tree-insert");
    expect(gaps).toHaveLength(4);
    for (const gap of gaps) {
      expect(gap.querySelector(".cms-tree-insert__hit")).toHaveAttribute("aria-hidden", "true");
      expect(gap.querySelector(".cms-tree-insert__btn")).not.toBeNull();
    }
    const rootGap = container.querySelector<HTMLElement>(".cms-tree__nodes > .cms-tree-insert");
    expect(rootGap).toHaveClass("cms-tree-insert--root");
    expect(rootGap?.style.getPropertyValue("--depth")).toBe("0");
    // Products' own gap comes first in document order, then Home's two.
    const nested = [...container.querySelectorAll<HTMLElement>(".cms-tree-children > .cms-tree-insert")];
    expect(nested.map((gap) => gap.style.getPropertyValue("--depth"))).toEqual(["2", "1", "1"]);
    expect(screen.getByRole("button", { name: "Insert before Pricing" })).toBeInTheDocument();
  });

  it("closes every list with an add row, an empty branch included, plus the dashed root button", () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    expect(container.querySelectorAll(".cms-tree-add-wrap")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Add under Site settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add root page" })).toHaveClass("cms-tree-add-root");
  });

  it("offers nothing at all when the host gave it no way to add a node", () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    expect(container.querySelectorAll(".cms-tree-insert")).toHaveLength(0);
    expect(container.querySelectorAll(".cms-tree-add-wrap")).toHaveLength(0);
    expect(container.querySelector(".cms-tree-add-root")).toBeNull();
  });

  it("gates every insert point through canInsert", () => {
    const canInsert = vi.fn(({ parentId }: { parentId: string | null }) => parentId === "products");
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} canInsert={canInsert} addLabel={addLabel} />);
    expect(container.querySelectorAll(".cms-tree-insert")).toHaveLength(1);
    expect(container.querySelectorAll(".cms-tree-add-wrap")).toHaveLength(1);
    expect(container.querySelector(".cms-tree-add-root")).toBeNull();
    expect(canInsert).toHaveBeenCalledWith({ parentId: "products", index: 2 });
  });
});

describe("adding a node", () => {
  it("leaves the insert to the host unless it asks for the inline editor", () => {
    const onRequestInsert = vi.fn();
    const { rerender } = render(<OutlineTree nodes={NODES} onRequestInsert={onRequestInsert} onAdd={vi.fn()} addLabel={addLabel} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    expect(onRequestInsert).toHaveBeenCalledWith({ parentId: "products", index: 1 });
    expect(screen.queryByRole("textbox")).toBeNull();

    onRequestInsert.mockReturnValue("inline");
    rerender(<OutlineTree nodes={NODES} onRequestInsert={onRequestInsert} onAdd={vi.fn()} addLabel={addLabel} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    expect(screen.getByRole("textbox", { name: "Insert before Pricing" })).toBeInTheDocument();
  });

  it("adds at the index of the gap it was opened from", () => {
    const onAdd = vi.fn();
    render(<OutlineTree nodes={NODES} onAdd={onAdd} addLabel={addLabel} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));

    const input = screen.getByRole("textbox", { name: "Insert before Pricing" });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    fireEvent.input(input, { target: { value: "  Spec sheet  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith({ parentId: "products", index: 1, title: "Spec sheet" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("appends from a terminal add row and from the root button", () => {
    const onAdd = vi.fn();
    render(<OutlineTree nodes={NODES} onAdd={onAdd} addLabel={addLabel} />);

    fireEvent.click(screen.getByRole("button", { name: "Add under Products" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Add under Products" }), { target: { value: "Support" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onAdd).toHaveBeenLastCalledWith({ parentId: "products", index: 2, title: "Support" });

    fireEvent.click(screen.getByRole("button", { name: "Add root page" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Add root page" }), { target: { value: "Blog" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Add root page" }), { key: "Enter" });
    expect(onAdd).toHaveBeenLastCalledWith({ parentId: null, index: 2, title: "Blog" });
  });

  it("replaces the add row in flow, so only the editor or the row is present", () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    fireEvent.click(screen.getByRole("button", { name: "Add under Products" }));
    const wraps = [...container.querySelectorAll(".cms-tree-add-wrap")];
    const editing = wraps.filter((wrap) => wrap.querySelector(".cms-tree-inline"));
    expect(editing).toHaveLength(1);
    expect(editing[0].querySelector(".cms-tree-add")).toBeNull();
    expect(editing[0].querySelector(".cms-tree-vline")).not.toBeNull();
    for (const wrap of wraps.filter((wrap) => wrap !== editing[0])) {
      expect(wrap.querySelector(".cms-tree-add")).not.toBeNull();
    }
  });

  it("marks the gap active and keeps the editor inside it, so no row can move", () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    const gap = container.querySelector(".cms-tree-insert.is-active");
    expect(gap).not.toBeNull();
    expect(gap?.querySelector(".cms-tree-inline")).not.toBeNull();
    expect(container.querySelectorAll(".cms-tree-insert.is-active")).toHaveLength(1);
  });

  it("abandons the editor on Escape and on Cancel, adding nothing", () => {
    const onAdd = vi.fn();
    render(<OutlineTree nodes={NODES} onAdd={onAdd} addLabel={addLabel} />);
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    fireEvent.input(screen.getByRole("textbox", { name: "Insert before Pricing" }), { target: { value: "Spec" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Insert before Pricing" }), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("returns focus to the row the shortcut was pressed on after Escape", () => {
    render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "a" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Insert before Pricing" }), { key: "Escape" });
    expect(document.activeElement).toBe(item("overview"));
  });
});
