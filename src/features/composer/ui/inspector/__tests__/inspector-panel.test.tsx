/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { useState } from "preact/hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/preact";
import type { CompositionDocument } from "../../../../../composer/browser";
import {
  TEST_COMPONENT_IDS,
  makeDocument,
  makeNode,
  resetTestIds,
  testManifest,
} from "../../test-support/composer-fixtures";
import { InspectorPanel, type InspectorPanelProps } from "../inspector-panel";

function renderPanel(overrides: Partial<InspectorPanelProps> = {}) {
  const onUpdateProps = vi.fn();
  const onRemove = vi.fn();
  const onCopy = vi.fn();
  const onDuplicate = vi.fn();
  const utils = render(
    <InspectorPanel
      document={makeDocument([])}
      manifest={testManifest}
      selectedId={null}
      mode="edit"
      onUpdateProps={onUpdateProps}
      onRemove={onRemove}
      onCopy={onCopy}
      onDuplicate={onDuplicate}
      {...overrides}
    />,
  );
  return { ...utils, onUpdateProps, onRemove, onCopy, onDuplicate };
}

/** The Reuse tab is document-scoped, so every reuse assertion opens it first. */
function openReuse(): void {
  fireEvent.click(screen.getByRole("tab", { name: "Reuse" }));
}

beforeEach(() => {
  resetTestIds();
});

function reusableDocument(): CompositionDocument {
  return makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hello" }, {}, "label")]);
}

function PatternPublicationHarness({ initialDocument = reusableDocument() }: { initialDocument?: CompositionDocument }) {
  const [document, setDocument] = useState(initialDocument);
  return (
    <InspectorPanel
      document={document}
      manifest={testManifest}
      selectedId={null}
      mode="edit"
      onUpdateProps={() => {}}
      onRemove={() => {}}
      onPublishPattern={() => setDocument((current) => ({ ...current, publication: { kind: "pattern" } }))}
      onClearPublication={async () => {
        setDocument((current) => ({ ...current, publication: undefined }));
        return { status: "applied" };
      }}
    />
  );
}

describe("InspectorPanel — root/empty state", () => {
  it("opens on Properties and shows an empty-composition note when the document has no nodes", () => {
    renderPanel({ document: makeDocument([]), selectedId: null });
    expect(screen.getByRole("tab", { name: "Properties" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(screen.getByText(/composition is empty/i)).toBeInTheDocument();
  });

  it("shows a 'select something' note when nodes exist but nothing is selected", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    renderPanel({ document: doc, selectedId: null });
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(screen.getByText(/select a component/i)).toBeInTheDocument();
  });

  it("falls back to the empty state for a stale/unknown selectedId", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a")]);
    renderPanel({ document: doc, selectedId: "does-not-exist" });
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
  });

  it("disables the Slots tab for a node with no slots, and enables it for a container", () => {
    const leaf = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a")]);
    const { rerender } = renderPanel({ document: leaf, selectedId: "a" });
    expect(screen.getByRole("tab", { name: /Slots/ })).toBeDisabled();

    const container = makeDocument([
      makeNode(TEST_COMPONENT_IDS.panel, {}, { left: [], right: [] }, "panel"),
    ]);
    rerender(
      <InspectorPanel
        document={container}
        manifest={testManifest}
        selectedId="panel"
        mode="edit"
        onUpdateProps={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByRole("tab", { name: /Slots/ })).not.toBeDisabled();
  });
});

describe("InspectorPanel — Reuse tab", () => {
  it("presents linked ownership on the Reuse tab, separately from the selected node's props", () => {
    const onOpenSource = vi.fn();
    const onDetach = vi.fn();
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Local" }, {}, "local-node")]);
    renderPanel({
      document: doc,
      selectedId: "local-node",
      linkedPresentation: {
        state: "resolved",
        sourceRecordId: "source-record",
        sourceName: "Site shell",
        outletId: "outlet-main",
        outletLabel: "Main content",
      },
      linkedActions: { onOpenSource, onDetach },
    });

    // The consumer's own local node is what Properties still edits.
    expect(screen.getByLabelText("Text")).toBeInTheDocument();

    openReuse();
    expect(screen.getByText("This composition consumes a Global template.")).toBeInTheDocument();
    expect(screen.getByText(/Site shell.*Main content.*Locked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open source" }));
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    expect(onOpenSource).toHaveBeenCalledWith("source-record");
    expect(onDetach).toHaveBeenCalledOnce();
  });

  it("exposes only injected recovery actions for a broken binding", () => {
    const onRetry = vi.fn();
    const onRemoveBrokenBinding = vi.fn();
    renderPanel({
      linkedPresentation: {
        state: "blocked",
        sourceRecordId: "source-record",
        diagnostic: "missing-template",
        message: "The linked Global template is unavailable.",
      },
      linkedActions: { onRetry, onRemoveBrokenBinding },
    });

    openReuse();
    expect(screen.getByText("Linked template unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove broken binding" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRemoveBrokenBinding).toHaveBeenCalledOnce();
  });

  it("disables empty Pattern publication with an accessible reason", () => {
    renderPanel({ document: makeDocument([]), selectedId: null });
    openReuse();
    const publish = screen.getByRole("button", { name: "Publish as Pattern" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(
      "Add at least one root component before publishing a Pattern.",
    );
  });

  it("publishes through one explicit button, then reports the in-memory role without claiming persistence", async () => {
    render(<PatternPublicationHarness />);
    openReuse();
    const publish = screen.getByRole("button", { name: "Publish as Pattern" });
    expect(publish.tagName).toBe("BUTTON");
    expect(screen.queryByRole("radio", { name: /Pattern/i })).not.toBeInTheDocument();

    fireEvent.click(publish);

    await waitFor(() => expect(screen.getByText("This composition is a Pattern.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Unpublish Pattern" })).toBeInTheDocument();
  });

  it("keeps a bound consumer from being published and explains the conflict", () => {
    const doc = reusableDocument();
    doc.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    renderPanel({ document: doc, selectedId: null });
    openReuse();

    const publish = screen.getByRole("button", { name: "Publish as Pattern" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(/bound to a Global template/i);
    expect(screen.getByText(/A bound composition cannot publish an outlet of its own/i)).toBeInTheDocument();
  });

  it("keeps Global-template publication separate and guards its unpublish behind an alertdialog", () => {
    const doc = reusableDocument();
    doc.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main content", target: { parentId: "shell", slotId: "main" } },
    };
    renderPanel({ document: doc, selectedId: null });
    openReuse();

    const publish = screen.getByRole("button", { name: "Publish as Pattern" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(/This composition is a Global template/i);
    expect(screen.getByText("This composition is a Global template.")).toBeInTheDocument();
    expect(screen.getByText(/Current outlet: Main content/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish Global template" }));
    // ConfirmDialog is an alertdialog, never a plain dialog.
    const confirm = screen.getByRole("alertdialog", { name: "Unpublish Global template?" });
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("shows a stale outlet diagnostic with a reassign or unpublish path", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.panel, {}, { left: [], right: [] }, "panel")]);
    doc.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "missing", slotId: "content" } },
    };
    renderPanel({ document: doc, selectedId: null });
    openReuse();

    expect(screen.getByText(/no longer a declared empty component slot/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose another valid empty slot/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpublish Global template" })).toBeInTheDocument();
  });

  it("confirms before unpublishing, and restores the publish action afterwards", async () => {
    render(<PatternPublicationHarness initialDocument={{ ...reusableDocument(), publication: { kind: "pattern" } }} />);
    openReuse();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish Pattern" }));
    const confirm = screen.getByRole("alertdialog", { name: "Unpublish Pattern?" });
    expect(within(confirm).getByText(/removes the composition’s reusable Pattern status/i)).toBeInTheDocument();

    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish Pattern" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Unpublish Pattern" }),
    );

    await waitFor(() => expect(screen.getByRole("button", { name: "Publish as Pattern" })).toBeInTheDocument());
    expect(document.querySelector("[data-sg-reuse-feedback]")).toHaveTextContent(
      "Pattern unpublished. Check the save status for persistence.",
    );
  });

  it("waits for the guarded relationship result before clearing a role, and reports a refusal", async () => {
    let finishClear: ((result: { status: "blocked"; message: string }) => void) | undefined;
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hello" })]);
    doc.publication = { kind: "pattern" };
    renderPanel({
      document: doc,
      selectedId: null,
      onClearPublication: vi.fn(() => new Promise<{ status: "blocked"; message: string }>((resolve) => {
        finishClear = resolve;
      })),
    });
    openReuse();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish Pattern" }));
    const confirm = screen.getByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Unpublish Pattern" }));

    finishClear?.({ status: "blocked", message: "2 consumers are still bound." });
    await waitFor(() =>
      expect(document.querySelector("[data-sg-reuse-feedback]")).toHaveTextContent("2 consumers are still bound."),
    );
  });

  it("keeps the current reuse state visible but disables its mutation actions in preview", () => {
    const doc = reusableDocument();
    doc.publication = { kind: "pattern" };
    renderPanel({ document: doc, selectedId: null, mode: "preview" });
    openReuse();

    expect(screen.getByText("This composition is a Pattern.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpublish Pattern" })).toBeDisabled();
  });

  it("keeps controller errors visible without treating them as accepted Pattern publication", () => {
    renderPanel({ document: reusableDocument(), selectedId: null, lastError: "This Composition cannot be published right now." });
    openReuse();
    expect(document.querySelector("[data-sg-reuse-feedback]")).toHaveTextContent(
      "This Composition cannot be published right now.",
    );
    expect(screen.queryByText("This composition is a Pattern.")).not.toBeInTheDocument();
  });

  it("offers the outlet action only for an empty slot selected in Structure", () => {
    const doc = makeDocument([
      makeNode(
        TEST_COMPONENT_IDS.panel,
        {},
        { left: [], right: [makeNode(TEST_COMPONENT_IDS.label, { text: "B" }, {}, "b")] },
        "panel",
      ),
    ]);
    const onSetGlobalTemplateOutlet = vi.fn(async () => ({ status: "applied" as const }));

    const { rerender } = renderPanel({
      document: doc,
      selectedId: "panel",
      selectedSlot: null,
      onSetGlobalTemplateOutlet,
    });
    openReuse();
    expect(screen.getByRole("button", { name: "Select a slot first" })).toBeDisabled();

    function withSlot(slotId: string) {
      rerender(
        <InspectorPanel
          document={doc}
          manifest={testManifest}
          selectedId="panel"
          selectedSlot={{ parentId: "panel", slotId }}
          mode="edit"
          onUpdateProps={() => {}}
          onRemove={() => {}}
          onSetGlobalTemplateOutlet={onSetGlobalTemplateOutlet}
        />,
      );
      openReuse();
    }

    withSlot("right");
    expect(screen.getByRole("button", { name: /Use Right as outlet/ })).toBeDisabled();

    withSlot("left");
    const use = screen.getByRole("button", { name: "Use Left as outlet" });
    expect(use).not.toBeDisabled();
    fireEvent.click(use);
    fireEvent.click(screen.getByRole("button", { name: "Publish template" }));
    expect(onSetGlobalTemplateOutlet).toHaveBeenCalledWith({ parentId: "panel", slotId: "left" }, "Left");
  });
});

describe("InspectorPanel — identity, parent and position", () => {
  it("shows the component id, node id and a Document root parent for a top-level node", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a")]);
    const { container } = renderPanel({ document: doc, selectedId: "a" });
    const node = container.querySelector(".sg-composer-inspector-node")!;
    expect(node.textContent).toContain(TEST_COMPONENT_IDS.label);
    expect(node.textContent).toContain("a");
    expect(node.textContent).toContain("Document root");
    expect(node.textContent).toContain("1 of 1");
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("uses titleFor for a friendlier parent path when supplied", () => {
    const doc = makeDocument([
      makeNode(
        TEST_COMPONENT_IDS.panel,
        {},
        { left: [makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "child")] },
        "panel",
      ),
    ]);
    const { container } = renderPanel({
      document: doc,
      selectedId: "child",
      titleFor: (id) => (id === TEST_COMPONENT_IDS.panel ? "Split Panel" : undefined),
    });
    expect(container.querySelector(".sg-composer-inspector-node")!.textContent).toContain("Split Panel › Left");
  });

  it("routes Duplicate, Copy and Delete through their callbacks", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a")]);
    const { onCopy, onDuplicate, onRemove } = renderPanel({ document: doc, selectedId: "a" });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDuplicate).toHaveBeenCalledWith("a");
    expect(onCopy).toHaveBeenCalledWith("a");
    expect(onRemove).toHaveBeenCalledWith("a");
  });
});

describe("InspectorPanel — Slots tab", () => {
  it("lists every slot with its child count and jumps to one", () => {
    const doc = makeDocument([
      makeNode(
        TEST_COMPONENT_IDS.panel,
        {},
        {
          left: [makeNode(TEST_COMPONENT_IDS.label, { text: "A" })],
          right: [makeNode(TEST_COMPONENT_IDS.label, { text: "B" }), makeNode(TEST_COMPONENT_IDS.label, { text: "C" })],
        },
        "panel",
      ),
    ]);
    const onJumpToSlot = vi.fn();
    const { container } = renderPanel({ document: doc, selectedId: "panel", onJumpToSlot });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    const items = Array.from(container.querySelectorAll("[data-sg-inspector-slots] li")).map(
      (li) => li.textContent,
    );
    expect(items).toEqual(["Left1 child · singleJump", "Right2 childrenJump"]);

    fireEvent.click(screen.getByRole("button", { name: "Jump to Right" }));
    expect(onJumpToSlot).toHaveBeenCalledWith({ parentId: "panel", slotId: "right" });
  });
});

describe("InspectorPanel — field rendering + commits", () => {
  function widgetDoc() {
    return makeDocument([
      makeNode(
        TEST_COMPONENT_IDS.widget,
        { title: "Untitled", note: "n", enabled: true, count: 3, variant: "solid", tint: "#336699" },
        {},
        "w",
      ),
    ]);
  }

  it("renders one control per declared field kind", () => {
    renderPanel({ document: widgetDoc(), selectedId: "w" });
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Note")).toBeInTheDocument();
    expect(screen.getByLabelText("Note").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Enabled")).toBeInTheDocument();
    expect(screen.getByLabelText("Enabled")).toHaveAttribute("type", "checkbox");
    expect(screen.getByLabelText("Count")).toHaveAttribute("type", "number");
    expect(screen.getByLabelText("Variant").tagName).toBe("SELECT");
    expect(screen.getByLabelText("Tint")).toHaveAttribute("type", "text");
  });

  it("commits a text field edit through onUpdateProps with the node id + prop patch", () => {
    const { onUpdateProps } = renderPanel({ document: widgetDoc(), selectedId: "w" });
    fireEvent.input(screen.getByLabelText("Title"), { target: { value: "New title" } });
    expect(onUpdateProps).toHaveBeenCalledWith("w", { title: "New title" });
  });

  it("commits a boolean field edit with a real boolean", () => {
    const { onUpdateProps } = renderPanel({ document: widgetDoc(), selectedId: "w" });
    fireEvent.click(screen.getByLabelText("Enabled"));
    expect(onUpdateProps).toHaveBeenCalledWith("w", { enabled: false });
  });

  it("commits a select field edit", () => {
    const { onUpdateProps } = renderPanel({ document: widgetDoc(), selectedId: "w" });
    fireEvent.change(screen.getByLabelText("Variant"), { target: { value: "ghost" } });
    expect(onUpdateProps).toHaveBeenCalledWith("w", { variant: "ghost" });
  });

  it("commits a color field edit as a string", () => {
    const { onUpdateProps } = renderPanel({ document: widgetDoc(), selectedId: "w" });
    fireEvent.input(screen.getByLabelText("Tint"), { target: { value: "#ff0000" } });
    expect(onUpdateProps).toHaveBeenCalledWith("w", { tint: "#ff0000" });
  });

  it("commits a valid numeric edit as a number, not a string", () => {
    const { onUpdateProps } = renderPanel({ document: widgetDoc(), selectedId: "w" });
    fireEvent.input(screen.getByLabelText("Count"), { target: { value: "7" } });
    expect(onUpdateProps).toHaveBeenCalledWith("w", { count: 7 });
    expect(typeof onUpdateProps.mock.calls[0]![1].count).toBe("number");
  });

  it("never commits NaN and shows a labelled inline error for invalid numeric drafts", () => {
    // A native <input type="number"> coerces non-numeric text to an empty
    // `.value` per the HTML spec (never lets "abc" reach the DOM value) —
    // the empty-draft branch is what real invalid typing hits.
    const { onUpdateProps } = renderPanel({ document: widgetDoc(), selectedId: "w" });
    const countInput = screen.getByLabelText("Count");
    fireEvent.input(countInput, { target: { value: "abc" } });
    expect(onUpdateProps).not.toHaveBeenCalled();
    expect(countInput).toHaveAttribute("aria-invalid", "true");
    const describedBy = countInput.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)).toHaveTextContent(/enter a number/i);
  });

  it("rejects an out-of-range numeric draft with a labelled error and no commit", () => {
    const { onUpdateProps } = renderPanel({ document: widgetDoc(), selectedId: "w" });
    const countInput = screen.getByLabelText("Count");
    fireEvent.input(countInput, { target: { value: "99" } });
    expect(onUpdateProps).not.toHaveBeenCalled();
    expect(countInput).toHaveAttribute("aria-invalid", "true");
  });

  it("reverts an invalid numeric draft to the last valid value on blur", () => {
    renderPanel({ document: widgetDoc(), selectedId: "w" });
    const countInput = screen.getByLabelText("Count") as HTMLInputElement;
    fireEvent.input(countInput, { target: { value: "" } });
    expect(countInput).toHaveAttribute("aria-invalid", "true");
    fireEvent.blur(countInput);
    expect(countInput.value).toBe("3");
    expect(countInput).not.toHaveAttribute("aria-invalid", "true");
  });

  it("offers an absent optional prop as its own Add control, seeded from the schema", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.widget, { title: "Only the required one" }, {}, "w")]);
    const { onUpdateProps } = renderPanel({ document: doc, selectedId: "w" });
    expect(screen.queryByLabelText("Note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Note" }));
    expect(onUpdateProps).toHaveBeenCalledWith("w", { note: "" }, null);
  });
});

describe("InspectorPanel — read-only / preview mode", () => {
  it("disables every field control and the node actions while keeping values visible", () => {
    const doc = makeDocument([
      makeNode(TEST_COMPONENT_IDS.widget, { title: "Locked", note: "n", enabled: true, count: 3, variant: "solid", tint: "#000" }, {}, "w"),
    ]);
    renderPanel({ document: doc, selectedId: "w", mode: "preview" });
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Title")).toHaveValue("Locked");
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByText("Preview mode — properties are read-only.")).toBeInTheDocument();
  });
});

describe("InspectorPanel — opaque nodes", () => {
  it("shows diagnostics + raw identity, no editable fields, but keeps Delete", () => {
    const doc = makeDocument([makeNode("unknown.thing", { anything: "x" }, {}, "ghost")]);
    const { container, onRemove } = renderPanel({ document: doc, selectedId: "ghost" });

    expect(container.querySelector(".sg-composer-inspector-node")!.textContent).toContain("unknown.thing");
    expect(screen.getByText("This component can't be edited.")).toBeInTheDocument();
    expect(screen.getByText(/unknown component/i, { selector: "li" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onRemove).toHaveBeenCalledWith("ghost");
  });

  it("keeps declared fields hidden for a known component with an unsupported version", () => {
    const versioned = makeNode(TEST_COMPONENT_IDS.label, { text: "Preserved" }, {}, "future");
    versioned.componentVersion = 2;
    renderPanel({ document: makeDocument([versioned]), selectedId: "future" });
    expect(screen.getByText("This component can't be edited.")).toBeInTheDocument();
    expect(screen.getByText(/manifest provides v1/i, { selector: "li" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
  });
});

describe("InspectorPanel — DOM scoping sanity", () => {
  it("does not leak diagnostics markup when the node is editable", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a")]);
    const { container } = renderPanel({ document: doc, selectedId: "a" });
    expect(within(container as HTMLElement).queryByRole("alert")).not.toBeInTheDocument();
  });
});
