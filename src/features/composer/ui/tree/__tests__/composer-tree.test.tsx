/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import { createComponentCatalog } from "../../../../../composer/browser";
import { ComposerTree } from "../composer-tree";
import { fixtureCatalog, fixtureDocument, fixtureNode, fixturePackManifest, makeAbcDocument, resetFixtureIds, FIXTURE_IDS } from "./fixtures";

// One shared derivation, mirroring the app layer's single catalog creation —
// every test below passes this same manifest + the raw
// catalog array, rather than re-deriving inside `ComposerTree` itself.
const fixtureManifest = createComponentCatalog(fixturePackManifest);

function baseProps() {
  return {
    manifest: fixtureManifest,
    entries: fixtureCatalog,
    selectedId: null as string | null,
    expandedIds: new Set<string>(),
    onSelect: vi.fn(),
    onReveal: vi.fn(),
    onToggleExpanded: vi.fn(),
    onOpenChooser: vi.fn(),
    onReorder: vi.fn(),
    onRemove: vi.fn(),
    onOpenNodeMenu: vi.fn(),
    onOpenInsertMenu: vi.fn(),
  };
}

describe("ComposerTree — structure", () => {
  it("shows a linked frame outside the strictly local document nodes", () => {
    resetFixtureIds();
    const onOpenSource = vi.fn();
    const document = makeAbcDocument();
    const { container } = render(
      <ComposerTree
        document={document}
        {...baseProps()}
        linkedPresentation={{
          state: "resolved",
          sourceRecordId: "source-record",
          sourceName: "Site shell",
          outletId: "outlet-main",
          outletLabel: "Main content",
        }}
        linkedActions={{ onOpenSource }}
      />,
    );

    const frame = container.querySelector('[data-sg-linked-frame="resolved"]')!;
    expect(frame.textContent).toContain("Site shell");
    expect(frame.textContent).toContain("Main content");
    // The collapsed local tree still has exactly its one local root node; the
    // linked source does not become a second tree branch.
    expect(container.querySelectorAll("[data-sg-tree-node-id]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Open source" }));
    expect(onOpenSource).toHaveBeenCalledWith("source-record");
  });

  it("renders the virtual document-root row as an insertion target only", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const { container } = render(<ComposerTree document={document} {...baseProps()} />);
    expect(screen.getByText("Document root")).toBeInTheDocument();
    expect(container.querySelector("[data-sg-tree-section-header]")).toHaveClass("sg-composer-tree-row-root");
  });

  it("renders named left/right slots with B then C in right, in exact order", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const { container } = render(
      <ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} />,
    );
    expect(screen.getByText("Left", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Right", { exact: false })).toBeInTheDocument();

    const rightSlot = container.querySelector('[data-sg-tree-slot-id="right"]')!;
    const titles = within(rightSlot as HTMLElement)
      .getAllByRole("button", { name: /^Box (B|C)$/ })
      .map((btn) => btn.textContent);
    expect(titles[0]).toContain("B");
    expect(titles[1]).toContain("C");
  });

  it("distinguishes container rows from nested leaf rows", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const { container } = render(
      <ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} />,
    );

    const splitRow = container.querySelector(
      '[data-sg-tree-node-id="split"] > .sg-composer-tree-row',
    );
    const leafRow = container.querySelector(
      '[data-sg-tree-node-id="A"] > .sg-composer-tree-row',
    );

    expect(splitRow).toHaveClass("sg-composer-tree-row-container");
    expect(splitRow).not.toHaveClass("sg-composer-tree-row-leaf");
    expect(leafRow).toHaveClass("sg-composer-tree-row-leaf");
    expect(leafRow).not.toHaveClass("sg-composer-tree-row-container");
  });

  it("marks every slot explicitly and identifies its cardinality", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const { container } = render(
      <ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} />,
    );

    const slots = [...container.querySelectorAll<HTMLElement>(".sg-composer-tree-slot-header")];
    expect(slots).toHaveLength(2);
    expect(slots.map((slot) => slot.querySelector(".sg-composer-tree-slot-kind")?.textContent)).toEqual([
      "Slot",
      "Slot",
    ]);
    expect(slots.map((slot) => slot.querySelector(".sg-composer-tree-slot-cardinality")?.textContent)).toEqual([
      "Single",
      "Multiple",
    ]);
  });

  it("shows an empty-slot placeholder when a slot has no children", () => {
    resetFixtureIds();
    const document = fixtureDocument([fixtureNode(FIXTURE_IDS.split, {}, { left: [], right: [] }, "split")]);
    render(<ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} />);
    expect(screen.getAllByText("Empty slot")).toHaveLength(2);
  });

  it("keeps duplicate component types distinct via stable node ids", () => {
    resetFixtureIds();
    const document = fixtureDocument([
      fixtureNode(
        FIXTURE_IDS.stack,
        {},
        {
          content: [
            fixtureNode(FIXTURE_IDS.box, { label: "one" }, {}, "box-1"),
            fixtureNode(FIXTURE_IDS.box, { label: "two" }, {}, "box-2"),
          ],
        },
        "stack",
      ),
    ]);
    const { container } = render(
      <ComposerTree document={document} {...baseProps()} expandedIds={new Set(["stack"])} />,
    );
    const boxButtons = container.querySelectorAll(
      '[data-sg-tree-node-id="box-1"], [data-sg-tree-node-id="box-2"]',
    );
    expect(boxButtons).toHaveLength(2);
    expect(screen.getAllByText("Box")).toHaveLength(2);
  });

  it("hides children and the empty-slot text while a container is collapsed", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    render(<ComposerTree document={document} {...baseProps()} expandedIds={new Set()} />);
    expect(screen.queryByText("B")).not.toBeInTheDocument();
    expect(screen.queryByText("Empty slot")).not.toBeInTheDocument();
  });

  it("toggling disclosure calls onToggleExpanded with the node id", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const props = baseProps();
    render(<ComposerTree document={document} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /expand split layout/i }));
    expect(props.onToggleExpanded).toHaveBeenCalledWith("split");
  });

  it("clicking a real node's row calls onReveal, and the root row calls onSelect(null)", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const props = baseProps();
    render(<ComposerTree document={document} {...props} expandedIds={new Set(["split"])} />);

    fireEvent.click(screen.getByRole("button", { name: "Document root" }));
    expect(props.onSelect).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: "Split Layout" }));
    expect(props.onReveal).toHaveBeenCalledWith("split");
  });

  it("does not use role=tree (plain nested lists/buttons per the issue's constraint)", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const { container } = render(
      <ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} />,
    );
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.querySelectorAll("ul").length).toBeGreaterThan(0);
  });
});

describe("ComposerTree — opaque/unavailable placeholders", () => {
  it("renders an unknown component as an 'Unavailable' placeholder that stays selectable", () => {
    resetFixtureIds();
    const document = fixtureDocument([fixtureNode("unknown.widget", {}, {}, "mystery")]);
    const props = baseProps();
    render(<ComposerTree document={document} {...props} />);
    expect(screen.getByText("unknown.widget")).toBeInTheDocument();
    expect(screen.getByText("Unavailable")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "unknown.widget Unavailable" }));
    expect(props.onReveal).toHaveBeenCalledWith("mystery");
  });

  it("does not offer Add under an opaque node's slots", () => {
    resetFixtureIds();
    // A known component at the wrong version is opaque, but its declared slots
    // are still rendered (read-only) — Add must not appear.
    const document = fixtureDocument([
      { id: "split", componentId: FIXTURE_IDS.split, componentVersion: 99, props: {}, slots: { left: [], right: [] } },
    ]);
    render(<ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} />);
    expect(screen.queryByRole("button", { name: /Add component to Left/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add component to Right/i })).not.toBeInTheDocument();
  });
});

describe("ComposerTree — component chooser target capture", () => {
  it("opens the chooser with a slot target (index = end) when a slot's Add is clicked", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const props = baseProps();
    render(<ComposerTree document={document} {...props} expandedIds={new Set(["split"])} />);
    fireEvent.click(screen.getByRole("button", { name: /Add component to Right in Split Layout/i }));
    expect(props.onOpenChooser).toHaveBeenCalledWith({ parentId: "split", slotId: "right", index: 2 });
  });

  it("hides Add for a single-cardinality slot that is already occupied", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    render(<ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} />);
    expect(screen.queryByRole("button", { name: /Add component to Left in Split Layout/i })).not.toBeInTheDocument();
  });

  it("root Add opens the chooser targeting the virtual root", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const props = baseProps();
    render(<ComposerTree document={document} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Add component to document root" }));
    expect(props.onOpenChooser).toHaveBeenCalledWith({ parentId: null, slotId: "root", index: 1 });
  });
});

describe("ComposerTree — Global template outlet authoring", () => {
  it("offers outlet authoring only for real, declared, empty slots and captures a compact label", async () => {
    resetFixtureIds();
    const document = fixtureDocument([
      fixtureNode(
        FIXTURE_IDS.split,
        {},
        { left: [], right: [fixtureNode(FIXTURE_IDS.box, { label: "Filled" }, {}, "filled")] },
        "split",
      ),
    ]);
    const onSetGlobalTemplateOutlet = vi.fn(async () => ({ status: "applied" as const }));
    render(
      <ComposerTree
        document={document}
        {...baseProps()}
        expandedIds={new Set(["split"])}
        onSetGlobalTemplateOutlet={onSetGlobalTemplateOutlet}
      />,
    );

    expect(screen.getByRole("button", { name: "Use Left as template outlet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Right as template outlet" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Use .*document root as template outlet/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use Left as template outlet" }));
    const label = screen.getByLabelText("Outlet label") as HTMLInputElement;
    expect(label.value).toBe("Left");
    expect(label).toHaveFocus();
    fireEvent.input(label, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish template" }));
    expect(onSetGlobalTemplateOutlet).not.toHaveBeenCalled();
    expect(label).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(/Enter an outlet label/i);
    fireEvent.input(label, { target: { value: "Main content" } });
    fireEvent.click(screen.getByRole("button", { name: "Publish template" }));

    await waitFor(() => {
      expect(onSetGlobalTemplateOutlet).toHaveBeenCalledWith(
        { parentId: "split", slotId: "left" },
        "Main content",
      );
    });
  });

  it("badges the selected outlet, removes its Add/insert controls, and permits a label-only update", async () => {
    resetFixtureIds();
    const document = fixtureDocument([
      fixtureNode(FIXTURE_IDS.split, {}, { left: [], right: [] }, "split"),
    ]);
    document.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main content", target: { parentId: "split", slotId: "left" } },
    };
    const onSetGlobalTemplateOutlet = vi.fn(async () => ({ status: "applied" as const }));
    render(
      <ComposerTree
        document={document}
        {...baseProps()}
        expandedIds={new Set(["split"])}
        onSetGlobalTemplateOutlet={onSetGlobalTemplateOutlet}
      />,
    );

    expect(screen.getByText("Template outlet: Main content")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add component to Left/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Insert options for Left/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename Left template outlet" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rename Left template outlet" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename Left template outlet" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Rename Left template outlet" }));
    fireEvent.input(screen.getByLabelText("Outlet label"), { target: { value: "Body" } });
    fireEvent.click(screen.getByRole("button", { name: "Save outlet label" }));
    await waitFor(() => {
      expect(onSetGlobalTemplateOutlet).toHaveBeenCalledWith(
        { parentId: "split", slotId: "left" },
        "Body",
      );
    });
  });
});

describe("ComposerTree — structural actions", () => {
  it("disables move-up on the first sibling and move-down on the last sibling", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    render(<ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} />);
    expect(screen.getByRole("button", { name: "Move Box B up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Box B down" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Box C down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Box C up" })).not.toBeDisabled();
  });

  it("reorder buttons call onReorder with the node id and direction", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const props = baseProps();
    render(<ComposerTree document={document} {...props} expandedIds={new Set(["split"])} />);
    fireEvent.click(screen.getByRole("button", { name: "Move Box C up" }));
    expect(props.onReorder).toHaveBeenCalledWith("C", "up");
  });

  it("removes a leaf immediately with no confirmation step", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const props = baseProps();
    render(<ComposerTree document={document} {...props} expandedIds={new Set(["split"])} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Box B" }));
    expect(props.onRemove).toHaveBeenCalledWith("B");
  });

  it("requires explicit confirmation before removing a populated container, initially focused on Cancel, and cancel makes no removal", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const props = baseProps();
    render(<ComposerTree document={document} {...props} expandedIds={new Set(["split"])} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove Split Layout" }));
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove Split Layout and its 3 nested components\?/)).toBeInTheDocument();
    // Unified with the menu-triggered Delete confirmation (issue #260/#269):
    // initial focus lands on the SAFE action, not the danger button.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onRemove).not.toHaveBeenCalled();
    expect(screen.queryByText(/nested components\?/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove Split Layout" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    expect(props.onRemove).toHaveBeenCalledWith("split");
  });

  it("opaque nodes remain movable and removable", () => {
    resetFixtureIds();
    const document = fixtureDocument([
      fixtureNode(FIXTURE_IDS.box, {}, {}, "known"),
      fixtureNode("unknown.widget", {}, {}, "mystery"),
    ]);
    const props = baseProps();
    render(<ComposerTree document={document} {...props} />);
    expect(screen.getByRole("button", { name: "Move unknown.widget up" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove unknown.widget" }));
    expect(props.onRemove).toHaveBeenCalledWith("mystery");
  });

  it("hides all mutating affordances in readOnly mode", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    render(<ComposerTree document={document} {...baseProps()} expandedIds={new Set(["split"])} readOnly />);
    expect(screen.queryByRole("button", { name: /Add component/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move /i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove /i })).not.toBeInTheDocument();
  });
});

describe("ComposerTree — focus retention across rerenders", () => {
  it("keeps focus on a row's select button after a rerender triggered by a prop change", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const props = baseProps();
    const { rerender } = render(
      <ComposerTree document={document} {...props} expandedIds={new Set(["split"])} />,
    );
    const bButton = screen.getByRole("button", { name: "Box B" });
    bButton.focus();
    expect(bButton).toHaveFocus();

    rerender(<ComposerTree document={document} {...props} selectedId="B" expandedIds={new Set(["split"])} />);
    expect(screen.getByRole("button", { name: "Box B" })).toHaveFocus();
  });
});

describe("ComposerTree — expansion/reveal", () => {
  it("scrolls the selected row into view when selectedId changes to a now-rendered node", () => {
    resetFixtureIds();
    const document = makeAbcDocument();
    const scrollSpy = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollSpy;
    const props = baseProps();
    const { rerender } = render(
      <ComposerTree document={document} {...props} selectedId={null} expandedIds={new Set()} />,
    );
    expect(scrollSpy).not.toHaveBeenCalled();

    rerender(<ComposerTree document={document} {...props} selectedId="B" expandedIds={new Set(["split"])} />);
    expect(scrollSpy).toHaveBeenCalled();
  });
});
