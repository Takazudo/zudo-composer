import "./cleanup";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Child } from "@takazudo/zfb/zudo-react";
import { fireEvent, render as renderNode, screen, settle, within } from "../../../test/render";
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
async function focus(element: HTMLElement) {
  element.focus();
  await settle();
}

/** Mounts and lets the first effects run, as a Preact render would have. */
function render(child: Child) {
  const view = renderNode(child);
  return view;
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
  it("names the tree and exposes level, position and set size on every row", async () => {
    render(<OutlineTree nodes={NODES} label="Site pages" />);
    await settle();
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

  it("labels each children list as a group so the levels are navigable", async () => {
    render(<OutlineTree nodes={NODES} />);
    await settle();
    expect(screen.getByRole("group", { name: "Products" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Products" })).getAllByRole("treeitem")).toHaveLength(2);
  });

  it("puts the title first — a row carries a » mark, never a leading icon", async () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    await settle();
    const leaf = container.querySelector(".cms-tree-leaf");
    expect(leaf?.firstElementChild).toHaveClass("cms-tree-title");
    expect(leaf?.querySelector("svg")).toBeNull();
    expect(container.querySelector(".cms-tree-cat__link")?.firstElementChild?.textContent).toBe("»");
  });

  it("renders the quiet slot variant, the tag and the status dot from the node", async () => {
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
    await settle();
    expect(container.querySelector(".cms-tree-group__row--slot")?.textContent).toContain("content");
    expect(container.querySelector(".cms-tree-hint")?.textContent).toBe("Build a clear…");
    expect(container.querySelector(".cms-tree-hint")).toHaveAttribute("title", "Build a clear…");
    expect(container.querySelector(".cms-tree-group__row--slot .cms-tree-slug")).toHaveAttribute("title", "slot");

    const withStatus = render(<OutlineTree nodes={NODES} />);

    await settle();
    expect(withStatus.container.querySelector(".cms-tree-dot--warn")).toHaveAttribute("title", "Unassigned");
    expect(withStatus.container.querySelector(".cms-tree-tag")?.textContent).toBe("single");
  });

  it("renders a rule tag with its own class and native tooltip, distinct from a plain tag", async () => {
    const nodes: readonly OutlineNode[] = [
      {
        id: "doc",
        kind: "category",
        title: "Document",
        children: [
          {
            id: "content",
            kind: "group",
            title: "Content",
            slug: "slot",
            variant: "slot",
            tag: "2 kinds",
            tagVariant: "rule",
            tagDetail: "Heading, Note — rule from ProductCard › Content",
            children: [],
          },
        ],
      },
    ];
    const { container } = render(<OutlineTree nodes={nodes} />);
    await settle();
    const tag = container.querySelector(".cms-tree-tag--rule");
    expect(tag).toHaveClass("cms-tree-tag");
    expect(tag?.textContent).toBe("2 kinds");
    expect(tag).toHaveAttribute("title", "Heading, Note — rule from ProductCard › Content");
  });

  it("insets a warn rail on a row whose status tone is warn, leaf and group alike", async () => {
    const nodes: readonly OutlineNode[] = [
      {
        id: "doc",
        kind: "category",
        title: "Document",
        status: { tone: "warn", label: "needs at least 1" },
        children: [
          {
            id: "group",
            kind: "group",
            title: "Box",
            status: { tone: "warn", label: "Slot \"items\" does not accept \"test.text\"" },
            children: [{ id: "leaf", kind: "leaf", title: "Text", status: { tone: "warn", label: "Not accepted" } }],
          },
        ],
      },
    ];
    const { container } = render(<OutlineTree nodes={nodes} />);
    await settle();
    expect(container.querySelector(".cms-tree-cat__row")).toHaveClass("cms-tree-row--warn-rail");
    expect(container.querySelector(".cms-tree-group__header")).toHaveClass("cms-tree-row--warn-rail");
    expect(container.querySelector(".cms-tree-leaf-wrap")).toHaveClass("cms-tree-row--warn-rail");
  });

  it("keeps every row's own metadata inside the treeitem, where it is announced", async () => {
    render(<OutlineTree nodes={NODES} />);
    await settle();
    // Only the treeitem is in the accessibility tree, so the slug, the count and
    // the status label have to be part of its name on a category too.
    for (const name of [/\(11\)/, /Composition assigned/]) expect(item("home")).toHaveAccessibleName(name);
    for (const name of [/site-settings/, /single/]) expect(item("settings")).toHaveAccessibleName(name);
    for (const name of [/\/about/, /Unassigned/]) expect(item("about")).toHaveAccessibleName(name);
  });

  it("renders the hover-only actions slot only when the host fills it", async () => {
    const bare = render(<OutlineTree nodes={NODES} />);
    await settle();
    expect(bare.container.querySelectorAll(".cms-tree-acts")).toHaveLength(0);
    bare.unmount();
    // A callback prop is fixed for the tree's lifetime, so a new one remounts it.
    const { container } = render(<OutlineTree nodes={NODES} renderActions={(node) => <Button size="xs">{node.title}</Button>} />);
    await settle();
    expect(container.querySelectorAll(".cms-tree-acts")).toHaveLength(ROW_ORDER.length);
  });
});

describe("connectors", () => {
  it("sets --depth on every connected element so the dashes line up", async () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    await settle();
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

  it("gives is-last to the final node of a list, and drops that group's spine", async () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    await settle();
    const groups = container.querySelectorAll(".cms-tree-group");
    expect(groups[0]).not.toHaveClass("is-last");
    expect(groups[0].querySelector(":scope > .cms-tree-spine")).not.toBeNull();

    const docs = groups[1];
    expect(docs).toHaveClass("is-last");
    expect(docs.querySelector(":scope > .cms-tree-group__header")).toHaveClass("is-last");
    expect(docs.querySelector(":scope > .cms-tree-spine")).toBeNull();
    expect(container.querySelector(".cms-tree-leaf-wrap.is-last")?.textContent).toContain("Pricing");
  });

  it("hands is-last to the terminal add row instead once one is rendered", async () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    await settle();
    expect(container.querySelector(".cms-tree-group.is-last")).toBeNull();
    expect(container.querySelectorAll(".cms-tree-leaf-wrap.is-last")).toHaveLength(0);
    for (const add of container.querySelectorAll(".cms-tree-add-wrap")) expect(add).toHaveClass("is-last");
  });
});

describe("expansion", () => {
  it("opens everything when the host keeps no state of its own", async () => {
    render(<OutlineTree nodes={NODES} />);
    await settle();
    expect(screen.getAllByRole("treeitem")).toHaveLength(ROW_ORDER.length);
    fireEvent.click(screen.getByRole("button", { name: "Collapse Products" }));
    await settle();
    expect(screen.queryByRole("treeitem", { name: /Product overview/ })).toBeNull();
    expect(item("products")).toHaveAttribute("aria-expanded", "false");
  });

  it("stays controlled: the toggle reports the change and renders nothing new", async () => {
    const onExpandedChange = vi.fn();
    render(<OutlineTree nodes={NODES} expandedIds={["home"]} onExpandedChange={onExpandedChange} />);
    await settle();
    expect(screen.queryByRole("treeitem", { name: /Product overview/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Expand Products" }));
    await settle();
    expect(onExpandedChange).toHaveBeenCalledWith(["home", "products"]);
    expect(screen.queryByRole("treeitem", { name: /Product overview/ })).toBeNull();
  });

  it("keeps an id whose node is momentarily childless, and opens a branch it fills", async () => {
    const onExpandedChange = vi.fn();
    const onAdd = vi.fn();
    // "settings" has no children, so it is not expandable — an expansion list
    // that only kept branches would quietly drop it here.
    render(
      <OutlineTree
        nodes={NODES}
        expandedIds={["home", "settings"]}
        onExpandedChange={onExpandedChange}
        onAdd={onAdd}
        addLabel={addLabel}
      />,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Expand Products" }));
    await settle();
    expect(onExpandedChange).toHaveBeenLastCalledWith(["home", "products", "settings"]);

    onExpandedChange.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Add under Site settings" }));
    await settle();
    fireEvent.input(screen.getByRole("textbox", { name: "Add under Site settings" }), { target: { value: "Domains" } });
    await settle();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Add under Site settings" }), { key: "Enter" });
    await settle();
    expect(onAdd).toHaveBeenCalledWith({ parentId: "settings", index: 0, title: "Domains" });
    expect(onExpandedChange).not.toHaveBeenCalled();
  });

  it("opens the branch it just filled, so the new node is not added out of sight", async () => {
    const onExpandedChange = vi.fn();
    render(
      <OutlineTree
        nodes={NODES}
        expandedIds={["home"]}
        onExpandedChange={onExpandedChange}
        onAdd={vi.fn()}
        addLabel={addLabel}
      />,
    );
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Add under Site settings" }));
    await settle();
    fireEvent.input(screen.getByRole("textbox", { name: "Add under Site settings" }), { target: { value: "Domains" } });
    await settle();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Add under Site settings" }), { key: "Enter" });
    await settle();
    expect(onExpandedChange).toHaveBeenCalledWith(["home", "settings"]);
  });

  it("reports Collapse all and Open all in the tree's own order", async () => {
    const onExpandedChange = vi.fn();
    render(<OutlineTree nodes={NODES} expandedIds={["home", "products", "docs"]} onExpandedChange={onExpandedChange} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    await settle();
    expect(onExpandedChange).toHaveBeenLastCalledWith([]);
    fireEvent.click(screen.getByRole("button", { name: "Open all" }));
    await settle();
    expect(onExpandedChange).toHaveBeenLastCalledWith(["home", "products", "docs"]);
  });
});

describe("preferences", () => {
  it("shows both columns by default and stores each change under prefKey", async () => {
    const { container } = render(<OutlineTree nodes={NODES} prefKey="sitemapper" />);
    await settle();
    const tree = container.firstElementChild;
    expect(tree).toHaveClass("cms-tree--show-slug", "cms-tree--show-count");

    fireEvent.click(screen.getByRole("switch", { name: "Show slug" }));
    await settle();
    expect(tree).not.toHaveClass("cms-tree--show-slug");
    expect(tree).toHaveClass("cms-tree--show-count");
    expect(localStorage.getItem(outlinePrefsStorageKey("sitemapper"))).toBe('{"slug":false,"count":true}');
  });

  it("reads the stored choice back on the next mount", async () => {
    localStorage.setItem(outlinePrefsStorageKey("sitemapper"), '{"slug":false,"count":false}');
    const { container } = render(<OutlineTree nodes={NODES} prefKey="sitemapper" />);
    await settle();
    expect(container.firstElementChild).not.toHaveClass("cms-tree--show-slug");
    expect(container.firstElementChild).not.toHaveClass("cms-tree--show-count");
  });

  it("keeps the choice to itself without a prefKey", async () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    await settle();
    fireEvent.click(screen.getByRole("switch", { name: "Show count" }));
    await settle();
    expect(container.firstElementChild).not.toHaveClass("cms-tree--show-count");
    expect(localStorage.length).toBe(0);
  });

  it("hides the toolbar on request", async () => {
    render(<OutlineTree nodes={NODES} showToolbar={false} />);
    await settle();
    expect(screen.queryByRole("switch", { name: "Show slug" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse all" })).toBeNull();
  });
});

describe("selection", () => {
  it("marks the selected row and reports a click on another", async () => {
    const onSelect = vi.fn();
    render(<OutlineTree nodes={NODES} selectedId="about" onSelect={onSelect} />);
    await settle();
    expect(item("about")).toHaveAttribute("aria-selected", "true");
    expect(item("pricing")).toHaveAttribute("aria-selected", "false");

    fireEvent.click(item("pricing"));
    await settle();
    expect(onSelect).toHaveBeenCalledWith("pricing");
  });

  it("opens on a double click", async () => {
    const onOpen = vi.fn();
    render(<OutlineTree nodes={NODES} onOpen={onOpen} />);
    await settle();
    fireEvent.dblClick(item("pricing"));
    await settle();
    expect(onOpen).toHaveBeenCalledWith("pricing");
  });

  it("starts the tab order on the selected row, and moves it with the focus", async () => {
    render(<OutlineTree nodes={NODES} selectedId="about" />);
    await settle();
    expect(item("about")).toHaveAttribute("tabindex", "0");
    expect(item("home")).toHaveAttribute("tabindex", "-1");

    await focus(item("pricing"));
    expect(item("pricing")).toHaveAttribute("tabindex", "0");
    expect(item("about")).toHaveAttribute("tabindex", "-1");
  });

  it("falls back to the first row when nothing is selected", async () => {
    render(<OutlineTree nodes={NODES} />);
    await settle();
    expect(item("home")).toHaveAttribute("tabindex", "0");
  });
});

describe("keyboard", () => {
  it("moves down, up, and to either end of the visible rows", async () => {
    render(<OutlineTree nodes={NODES} />);
    await settle();
    await focus(item("home"));
    fireEvent.keyDown(item("home"), { key: "ArrowDown" });
    await settle();
    expect(document.activeElement).toBe(item("products"));

    fireEvent.keyDown(item("products"), { key: "ArrowUp" });
    await settle();
    expect(document.activeElement).toBe(item("home"));

    fireEvent.keyDown(item("home"), { key: "End" });
    await settle();
    expect(document.activeElement).toBe(item("settings"));

    fireEvent.keyDown(item("settings"), { key: "Home" });
    await settle();
    expect(document.activeElement).toBe(item("home"));
  });

  it("expands with Right, then steps into the first child", async () => {
    const onExpandedChange = vi.fn();
    render(<OutlineTree nodes={NODES} onExpandedChange={onExpandedChange} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Products" }));
    await settle();

    const products = screen.getAllByRole("treeitem")[1];
    await focus(products);
    fireEvent.keyDown(products, { key: "ArrowRight" });
    await settle();
    expect(onExpandedChange).toHaveBeenLastCalledWith(["home", "products", "docs"]);
    expect(item("products")).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(item("products"), { key: "ArrowRight" });
    await settle();
    expect(document.activeElement).toBe(item("overview"));
  });

  it("collapses with Left, and from a leaf steps out to the parent", async () => {
    render(<OutlineTree nodes={NODES} />);
    await settle();
    await focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "ArrowLeft" });
    await settle();
    expect(document.activeElement).toBe(item("products"));

    fireEvent.keyDown(item("products"), { key: "ArrowLeft" });
    await settle();
    expect(screen.getAllByRole("treeitem")[1]).toHaveAttribute("aria-expanded", "false");
  });

  it("selects and opens on Enter", async () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    render(<OutlineTree nodes={NODES} onSelect={onSelect} onOpen={onOpen} />);
    await settle();
    await focus(item("pricing"));
    fireEvent.keyDown(item("pricing"), { key: "Enter" });
    await settle();
    expect(onSelect).toHaveBeenCalledWith("pricing");
    expect(onOpen).toHaveBeenCalledWith("pricing");
  });

  it("asks for a new sibling below the row on a and on +", async () => {
    const onRequestInsert = vi.fn();
    const gate = { open: true };
    render(<OutlineTree nodes={NODES} onRequestInsert={onRequestInsert} canInsert={() => gate.open} />);
    await settle();
    await focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "a" });
    await settle();
    expect(onRequestInsert).toHaveBeenLastCalledWith({ parentId: "products", index: 1 }, expect.any(Object));

    fireEvent.keyDown(item("home"), { key: "+" });
    await settle();
    expect(onRequestInsert).toHaveBeenLastCalledWith({ parentId: null, index: 1 }, expect.any(Object));

    gate.open = false;
    await settle();
    onRequestInsert.mockClear();
    fireEvent.keyDown(item("overview"), { key: "a" });
    await settle();
    expect(onRequestInsert).not.toHaveBeenCalled();
  });

  it("opens the inline editor at the row the shortcut was pressed on", async () => {
    render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    await settle();
    await focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "a" });
    await settle();
    expect(screen.getByRole("textbox", { name: "Insert before Pricing" })).toBeInTheDocument();
  });

  it("leaves a modified key to the browser, so Select all is not an insert", async () => {
    const onRequestInsert = vi.fn();
    const onOpen = vi.fn();
    render(<OutlineTree nodes={NODES} onRequestInsert={onRequestInsert} onOpen={onOpen} />);
    await settle();
    await focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "a", metaKey: true });
    await settle();
    fireEvent.keyDown(item("overview"), { key: "a", ctrlKey: true });
    await settle();
    fireEvent.keyDown(item("overview"), { key: "Enter", metaKey: true });
    await settle();
    fireEvent.keyDown(item("overview"), { key: "End", ctrlKey: true });
    await settle();
    expect(onRequestInsert).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(item("overview"));
  });

  it("ignores keys it does not own", async () => {
    const onOpen = vi.fn();
    render(<OutlineTree nodes={NODES} onOpen={onOpen} />);
    await settle();
    await focus(item("home"));
    fireEvent.keyDown(item("home"), { key: "b" });
    await settle();
    expect(document.activeElement).toBe(item("home"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("insert affordance", () => {
  it("puts a zero-height insert point between every pair of siblings, with its hit zone and tile", async () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    await settle();
    // First + between: 2 roots, 3 under Home, 2 under Products, 1 under Docs.
    const gaps = container.querySelectorAll(".cms-tree-insert");
    expect(gaps).toHaveLength(8);
    for (const gap of gaps) {
      expect(gap.querySelector(".cms-tree-insert__hit")).toHaveAttribute("aria-hidden", "true");
      expect(gap.querySelector(".cms-tree-insert__btn")).not.toBeNull();
    }
    const rootGap = container.querySelector<HTMLElement>(".cms-tree__nodes > .cms-tree-insert");
    expect(rootGap).toHaveClass("cms-tree-insert--root");
    expect(rootGap?.style.getPropertyValue("--depth")).toBe("0");
    // First gaps precede each parent's own children, including single children.
    const nested = [...container.querySelectorAll<HTMLElement>(".cms-tree-children > .cms-tree-insert")];
    expect(nested.map((gap) => gap.style.getPropertyValue("--depth"))).toEqual(["1", "2", "2", "1", "1", "2"]);
    expect(screen.getByRole("button", { name: "Insert before Pricing" })).toBeInTheDocument();
  });

  it("closes every list with an add row, an empty branch included, plus the dashed root button", async () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    await settle();
    expect(container.querySelectorAll(".cms-tree-add-wrap")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Add under Site settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add root page" })).toHaveClass("cms-tree-add-root");
  });

  it("offers nothing at all when the host gave it no way to add a node", async () => {
    const { container } = render(<OutlineTree nodes={NODES} />);
    await settle();
    expect(container.querySelectorAll(".cms-tree-insert")).toHaveLength(0);
    expect(container.querySelectorAll(".cms-tree-add-wrap")).toHaveLength(0);
    expect(container.querySelector(".cms-tree-add-root")).toBeNull();
  });

  it("gates every insert point through canInsert", async () => {
    const canInsert = vi.fn(({ parentId }: { parentId: string | null }) => parentId === "products");
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} canInsert={canInsert} addLabel={addLabel} />);
    await settle();
    expect(container.querySelectorAll(".cms-tree-insert")).toHaveLength(2);
    expect(container.querySelectorAll(".cms-tree-add-wrap")).toHaveLength(1);
    expect(container.querySelector(".cms-tree-add-root")).toBeNull();
    expect(canInsert).toHaveBeenCalledWith({ parentId: "products", index: 2 });
  });
});

describe("adding a node", () => {
  it("leaves the insert to the host unless it asks for the inline editor", async () => {
    const onRequestInsert = vi.fn();
    render(<OutlineTree nodes={NODES} onRequestInsert={onRequestInsert} onAdd={vi.fn()} addLabel={addLabel} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    await settle();
    expect(onRequestInsert).toHaveBeenCalledWith({ parentId: "products", index: 1 }, expect.objectContaining({ resolveTarget: expect.any(Function), cancel: expect.any(Function), complete: expect.any(Function) }));
    expect(screen.queryByRole("textbox")).toBeNull();

    onRequestInsert.mockReturnValue("inline");
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    await settle();
    expect(screen.getByRole("textbox", { name: "Insert before Pricing" })).toBeInTheDocument();
  });

  it("adds at the index of the gap it was opened from", async () => {
    const onAdd = vi.fn();
    render(<OutlineTree nodes={NODES} onAdd={onAdd} addLabel={addLabel} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    await settle();

    const input = screen.getByRole("textbox", { name: "Insert before Pricing" });
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    fireEvent.input(input, { target: { value: "  Spec sheet  " } });
    await settle();
    fireEvent.keyDown(input, { key: "Enter" });
    await settle();
    expect(onAdd).toHaveBeenCalledWith({ parentId: "products", index: 1, title: "Spec sheet" });
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("appends from a terminal add row and from the root button", async () => {
    const onAdd = vi.fn();
    render(<OutlineTree nodes={NODES} onAdd={onAdd} addLabel={addLabel} />);
    await settle();

    fireEvent.click(screen.getByRole("button", { name: "Add under Products" }));
    await settle();
    fireEvent.input(screen.getByRole("textbox", { name: "Add under Products" }), { target: { value: "Support" } });
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await settle();
    expect(onAdd).toHaveBeenLastCalledWith({ parentId: "products", index: 2, title: "Support" });

    fireEvent.click(screen.getByRole("button", { name: "Add root page" }));
    await settle();
    fireEvent.input(screen.getByRole("textbox", { name: "Add root page" }), { target: { value: "Blog" } });
    await settle();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Add root page" }), { key: "Enter" });
    await settle();
    expect(onAdd).toHaveBeenLastCalledWith({ parentId: null, index: 2, title: "Blog" });
  });

  it("replaces the add row in flow, so only the editor or the row is present", async () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Add under Products" }));
    await settle();
    const wraps = [...container.querySelectorAll(".cms-tree-add-wrap")];
    const editing = wraps.filter((wrap) => wrap.querySelector(".cms-tree-inline"));
    expect(editing).toHaveLength(1);
    expect(editing[0].querySelector(".cms-tree-add")).toBeNull();
    expect(editing[0].querySelector(".cms-tree-vline")).not.toBeNull();
    for (const wrap of wraps.filter((wrap) => wrap !== editing[0])) {
      expect(wrap.querySelector(".cms-tree-add")).not.toBeNull();
    }
  });

  it("marks the gap active and keeps the editor inside it, so no row can move", async () => {
    const { container } = render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    await settle();
    const gap = container.querySelector(".cms-tree-insert.is-active");
    expect(gap).not.toBeNull();
    expect(gap?.querySelector(".cms-tree-inline")).not.toBeNull();
    expect(container.querySelectorAll(".cms-tree-insert.is-active")).toHaveLength(1);
  });

  it("abandons the editor on Escape and on Cancel, adding nothing", async () => {
    const onAdd = vi.fn();
    render(<OutlineTree nodes={NODES} onAdd={onAdd} addLabel={addLabel} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    await settle();
    fireEvent.input(screen.getByRole("textbox", { name: "Insert before Pricing" }), { target: { value: "Spec" } });
    await settle();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Insert before Pricing" }), { key: "Escape" });
    await settle();
    expect(screen.queryByRole("textbox")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Insert before Pricing" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("returns focus to the row the shortcut was pressed on after Escape", async () => {
    render(<OutlineTree nodes={NODES} onAdd={vi.fn()} addLabel={addLabel} />);
    await settle();
    await focus(item("overview"));
    fireEvent.keyDown(item("overview"), { key: "a" });
    await settle();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Insert before Pricing" }), { key: "Escape" });
    await settle();
    expect(document.activeElement).toBe(item("overview"));
  });
});
