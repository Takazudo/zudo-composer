/** @jsxRuntime automatic */
/** @jsxImportSource preact */

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SitemapDocument, SitemapNode } from "../../../../../sitemapper/model";
import { SITEMAP_SCHEMA_VERSION } from "../../../../../sitemapper/model";
import { buildSitemapOutline } from "../outline-model";
import { PagesPane } from "../pages-pane";

afterEach(cleanup);

function documentOf(root: SitemapNode[]): SitemapDocument {
  return { schemaVersion: SITEMAP_SCHEMA_VERSION, id: "pages", name: "Pages", root };
}

const page = (id: string, title = id, children: SitemapNode[] = []): SitemapNode =>
  ({ id, title, source: { kind: "unassigned" }, children });

function paneProps(document: SitemapDocument, overrides: Record<string, unknown> = {}) {
  return {
    document,
    outline: buildSitemapOutline(document),
    selectedId: null,
    expandedIds: new Set(["home"]),
    onSelect: vi.fn(),
    onExpandedChange: vi.fn(),
    onAdd: vi.fn(),
    onAddChild: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

const addRows = () => [...document.querySelectorAll(".cms-tree-add")];

describe("Sitemapper pages pane", () => {
  it("offers the root's terminal add row even while the root has no children", () => {
    render(<PagesPane {...paneProps(documentOf([page("home", "Home")]))} />);
    expect(addRows()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Add root page" })).toBeNull();
  });

  it("offers Add root page only on a document with no root yet", () => {
    const props = paneProps(documentOf([]));
    render(<PagesPane {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add root page" }));
    // With no host handler the tree edits inline, which is what commits the add.
    const input = document.querySelector(".cms-tree-inline input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Home" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onAdd).toHaveBeenCalledWith({ parentId: null, index: 0, title: "Home" });
  });

  it("keeps a childless page a leaf, so it carries no add row of its own", () => {
    render(<PagesPane {...paneProps(documentOf([page("home", "Home", [page("about", "About")])]))} />);
    // Only the root category's children list closes with an add row.
    expect(addRows()).toHaveLength(1);
    expect(screen.getByRole("treeitem", { name: /About/ })).toBeInTheDocument();
  });

  it("refuses authored children under a Mapping route family", () => {
    const mapped = page("home", "Home");
    mapped.source = { kind: "mapping", ref: { providerId: "m", recordId: "articles" }, route: { kind: "single" } };
    render(<PagesPane {...paneProps(documentOf([mapped]))} />);
    expect(addRows()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Add child page to Home" })).toBeDisabled();
  });

  it("puts move, duplicate and delete behind one row menu, with the root protected", () => {
    const props = paneProps(documentOf([page("home", "Home", [page("about", "About"), page("contact", "Contact")])]));
    render(<PagesPane {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "More actions for Home" }));
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Home actions" }), { key: "Escape" });

    fireEvent.click(screen.getByRole("button", { name: "More actions for Contact" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    expect(props.onMove).toHaveBeenCalledWith("contact", "up");
  });

  it("names each dot's meaning and prints the legend that decodes them", () => {
    const home = page("home", "Home", [page("about", "About")]);
    home.children[0]!.source = { kind: "composition", ref: { providerId: "p", recordId: "c" } };
    render(<PagesPane {...paneProps(documentOf([home]))} />);
    expect(screen.getByRole("treeitem", { name: /Composition/ })).toBeInTheDocument();
    expect(document.querySelectorAll(".cms-tree__legend .cms-tree-dot")).toHaveLength(3);
  });
});
