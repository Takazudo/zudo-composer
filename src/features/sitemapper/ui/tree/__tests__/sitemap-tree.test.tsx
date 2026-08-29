/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SitemapDocument } from "../../../../../sitemapper/model";
import { SitemapTree } from "../sitemap-tree";
import { fixtureDocument } from "./fixtures";

function baseProps(document: SitemapDocument = fixtureDocument()) {
  return {
    document,
    selectedId: null as string | null,
    expandedIds: new Set<string>(),
    onSelect: vi.fn(),
    onToggleExpanded: vi.fn(),
    onAddChild: vi.fn(),
    onAddSibling: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

describe("SitemapTree structure and controlled state", () => {
  it("renders the real root and only renders descendants when expanded", () => {
    const document = fixtureDocument();
    const props = baseProps(document);
    const { container, rerender } = render(<SitemapTree {...props} />);
    expect(container.querySelector('[data-sg-tree-node-id="home"]')).toBeInTheDocument();
    expect(container.querySelector('[data-sg-tree-node-id="about"]')).toBeNull();

    rerender(<SitemapTree {...props} expandedIds={new Set(["home"])} />);
    expect(screen.getByRole("button", { name: "About" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Contact" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
  });

  it("sends selection and disclosure changes to the caller", () => {
    const props = baseProps();
    render(<SitemapTree {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(props.onSelect).toHaveBeenCalledWith("home");
    fireEvent.click(screen.getByRole("button", { name: "Expand Home" }));
    expect(props.onToggleExpanded).toHaveBeenCalledWith("home");
  });

  it("scrolls the selected rendered row into view when selection or expansion changes", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const props = baseProps();
    const { rerender } = render(<SitemapTree {...props} />);
    expect(scrollIntoView).not.toHaveBeenCalled();

    rerender(<SitemapTree {...props} selectedId="about" expandedIds={new Set(["home"])} />);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("renders an empty state when the document has no root", () => {
    const props = baseProps({ ...fixtureDocument(), root: [] });
    render(<SitemapTree {...props} />);
    expect(screen.getByText("No root page yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add child" })).not.toBeInTheDocument();
  });
});

describe("SitemapTree row actions", () => {
  it("surfaces disabled root sibling/delete reasons while leaving controls present", () => {
    const props = baseProps();
    const { container } = render(<SitemapTree {...props} />);
    const root = container.querySelector('[data-sg-tree-node-id="home"]') as HTMLElement;
    const sibling = within(root).getByRole("button", { name: "Add sibling" });
    const remove = within(root).getByRole("button", { name: "Delete" });
    expect(sibling).toBeDisabled();
    expect(remove).toBeDisabled();
    expect(sibling).toHaveAttribute("aria-describedby", "sg-sitemapper-tree-home-sibling-help");
    expect(remove).toHaveAttribute("aria-describedby", "sg-sitemapper-tree-home-delete-help");
    expect(screen.getByText("The root page cannot have a sibling.")).toBeInTheDocument();
    expect(screen.getByText("The root page cannot be deleted.")).toBeInTheDocument();
  });

  it("emits add, duplicate, and reorder callbacks from the row", () => {
    const props = baseProps();
    const { container } = render(<SitemapTree {...props} expandedIds={new Set(["home"])} />);
    const about = container.querySelector('[data-sg-tree-node-id="about"]') as HTMLElement;
    fireEvent.click(within(about).getByRole("button", { name: "Add child" }));
    fireEvent.click(within(about).getByRole("button", { name: "Add sibling" }));
    fireEvent.click(within(about).getByRole("button", { name: "Duplicate" }));
    fireEvent.click(within(about).getByRole("button", { name: "Move down" }));
    expect(props.onAddChild).toHaveBeenCalledWith("about");
    expect(props.onAddSibling).toHaveBeenCalledWith("about");
    expect(props.onDuplicate).toHaveBeenCalledWith("about");
    expect(props.onReorder).toHaveBeenCalledWith("about", "down");
  });

  it("disables move controls at sibling boundaries and never invokes them", () => {
    const props = baseProps();
    const { container } = render(<SitemapTree {...props} expandedIds={new Set(["home"])} />);
    const about = container.querySelector('[data-sg-tree-node-id="about"]') as HTMLElement;
    const contact = container.querySelector('[data-sg-tree-node-id="contact"]') as HTMLElement;
    expect(within(about).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(about).getByRole("button", { name: "Move down" })).not.toBeDisabled();
    expect(within(contact).getByRole("button", { name: "Move down" })).toBeDisabled();
    expect(within(contact).getByRole("button", { name: "Move up" })).not.toBeDisabled();
    fireEvent.click(within(about).getByRole("button", { name: "Move up" }));
    fireEvent.click(within(contact).getByRole("button", { name: "Move down" }));
    expect(props.onReorder).not.toHaveBeenCalled();
  });

  it("edits a title inline and supports Escape cancellation", () => {
    const props = baseProps();
    const { container } = render(<SitemapTree {...props} expandedIds={new Set(["home"])} />);
    const about = container.querySelector('[data-sg-tree-node-id="about"]') as HTMLElement;
    fireEvent.click(within(about).getByRole("button", { name: "Rename" }));
    const input = within(about).getByRole("textbox", { name: "Rename About" });
    expect(input).toHaveFocus();
    fireEvent.input(input, { target: { value: "About us" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(props.onRename).toHaveBeenCalledWith("about", "About us");

    fireEvent.click(within(about).getByRole("button", { name: "Rename" }));
    fireEvent.input(within(about).getByRole("textbox", { name: "Rename About" }), {
      target: { value: "Discarded" },
    });
    fireEvent.keyDown(within(about).getByRole("textbox", { name: "Rename About" }), { key: "Escape" });
    expect(props.onRename).toHaveBeenCalledTimes(1);
  });

  it("deletes a leaf immediately and confirms a populated subtree with Cancel focused", () => {
    const props = baseProps();
    const { container } = render(<SitemapTree {...props} expandedIds={new Set(["home"])} />);
    const contact = container.querySelector('[data-sg-tree-node-id="contact"]') as HTMLElement;
    fireEvent.click(within(contact).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("contact");

    const root = container.querySelector('[data-sg-tree-node-id="home"] > .sg-sitemapper-tree-row') as HTMLElement;
    fireEvent.click(within(root).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).not.toHaveBeenCalledWith("home");

    const about = container.querySelector('[data-sg-tree-node-id="about"]') as HTMLElement;
    fireEvent.click(within(about).getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete About and its 1 sub-page?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalledWith("about");

    fireEvent.click(within(about).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(about).getByRole("button", { name: "Delete" }));
    expect(props.onDelete).toHaveBeenCalledWith("about");
  });
});
