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
  const onReorder = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <InspectorPanel
      document={makeDocument([])}
      manifest={testManifest}
      selectedId={null}
      mode="edit"
      onUpdateProps={onUpdateProps}
      onReorder={onReorder}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { ...utils, onUpdateProps, onReorder, onRemove };
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
      onReorder={() => {}}
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
  it("shows an empty-composition note when the document has no nodes", () => {
    renderPanel({ document: makeDocument([]), selectedId: null });
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(screen.getByText(/composition is empty/i, { selector: "p" })).toBeInTheDocument();
  });

  it("shows a 'select something' note when nodes exist but nothing is selected", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" })]);
    renderPanel({ document: doc, selectedId: null });
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
    expect(screen.getByText(/select a component/i, { selector: "p" })).toBeInTheDocument();
  });

  it("falls back to the empty state for a stale/unknown selectedId", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a")]);
    renderPanel({ document: doc, selectedId: "does-not-exist" });
    expect(screen.getByText("Nothing selected")).toBeInTheDocument();
  });
});

describe("InspectorPanel — document reuse controls", () => {
  it("presents linked ownership separately from local selected-node controls", () => {
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

    expect(screen.getByText("Linked Global template")).toBeInTheDocument();
    expect(screen.getByText(/Site shell.*Main content.*Locked/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open source" }));
    fireEvent.click(screen.getByRole("button", { name: "Detach" }));
    expect(onOpenSource).toHaveBeenCalledWith("source-record");
    expect(onDetach).toHaveBeenCalledOnce();
    // The actual selected node is still the consumer's local node.
    expect(screen.getByLabelText("Text")).toBeInTheDocument();
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

    expect(screen.getByText("Linked template unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove broken binding" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRemoveBrokenBinding).toHaveBeenCalledOnce();
  });

  it("disables empty Pattern publication with an accessible reason", () => {
    renderPanel({ document: makeDocument([]), selectedId: null });
    const publish = screen.getByRole("button", { name: "Publish as Pattern" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(
      /whole-composition scope:.*add at least one root component before publishing a pattern/i,
    );
    expect(screen.getByText("Add at least one root component before publishing a Pattern.")).toBeInTheDocument();
  });

  it("uses a native explicit Pattern button, then reports the accepted in-memory publication without claiming persistence", async () => {
    render(<PatternPublicationHarness />);
    const publish = screen.getByRole("button", { name: "Publish as Pattern" });
    expect(publish.tagName).toBe("BUTTON");
    expect(screen.queryByRole("radio", { name: /Pattern/i })).not.toBeInTheDocument();
    expect(publish).toHaveAccessibleDescription(/whole-composition scope:.*does not publish the selected subtree/i);

    publish.focus();
    fireEvent.click(publish);

    await waitFor(() => expect(screen.getByText("Published as Pattern")).toBeInTheDocument());
    const publishedState = screen.getByText("Published as Pattern");
    expect(publishedState).not.toHaveAttribute("role", "status");
    expect(screen.getByText(/available as a reusable pattern in this document/i)).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Pattern published in this document. Check the Composer save status for persistence.",
    );
    expect(screen.getByRole("button", { name: "Unpublish Pattern" })).toHaveFocus();
  });

  it("keeps a bound consumer from being published and explains the conflict", () => {
    const doc = reusableDocument();
    doc.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    renderPanel({ document: doc, selectedId: null });

    const publish = screen.getByRole("button", { name: "Publish as Pattern" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(/bound to a global template/i);
    expect(screen.getByText(/consumer and cannot republish itself/i)).toBeInTheDocument();
    expect(screen.getByText(/global templates are published from structure/i)).toBeInTheDocument();
  });

  it("keeps Global-template publication separate, explains its Pattern restriction, and guards its unpublish action", () => {
    const doc = reusableDocument();
    doc.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main content", target: { parentId: "shell", slotId: "main" } },
    };
    renderPanel({ document: doc, selectedId: null });

    const publish = screen.getByRole("button", { name: "Publish as Pattern" });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription(/currently a global template.*unpublish the global template/i);
    expect(screen.getByText("Published as Global template")).toBeInTheDocument();
    expect(screen.getByText("Template outlet: Main content. Managed from Structure.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish Global template" }));
    expect(screen.getByText("Unpublish Global template?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("shows a stale outlet diagnostic with a reassign or unpublish path", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.panel, {}, { left: [], right: [] }, "panel")]);
    doc.publication = {
      kind: "global-template",
      outlet: { id: "outlet-main", label: "Main", target: { parentId: "missing", slotId: "content" } },
    };
    renderPanel({ document: doc, selectedId: null });

    expect(screen.getByRole("alert")).toHaveTextContent(/no longer a declared empty component slot/i);
    expect(screen.getByText(/Choose another valid empty slot/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unpublish Global template" })).toBeInTheDocument();
  });

  it("requires an inline confirmation, returns focus on cancel, and restores the publish action after unpublishing", async () => {
    render(<PatternPublicationHarness initialDocument={{ ...reusableDocument(), publication: { kind: "pattern" } }} />);

    fireEvent.click(screen.getByRole("button", { name: "Unpublish Pattern" }));
    expect(screen.getByText("Unpublish Pattern?")).toBeInTheDocument();
    expect(screen.getByText("This immediately removes this Composition’s reusable Pattern status. It does not delete the Composition.")).toBeInTheDocument();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();

    fireEvent.click(cancel);
    expect(screen.getByRole("button", { name: "Unpublish Pattern" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Unpublish Pattern" }));
    fireEvent.click(screen.getByRole("button", { name: "Unpublish Pattern" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Publish as Pattern" })).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent(
      "Pattern unpublished in this document. Check the Composer save status for persistence.",
    );
  });

  it("waits for the guarded relationship result before clearing a role and disables only its confirmation controls while in flight", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Unpublish Pattern" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Unpublish Pattern" }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Unpublish Pattern" })).toBeDisabled();
    finishClear?.({ status: "blocked", message: "2 consumers are still bound." });

    await waitFor(() => expect(screen.getByRole("button", { name: "Unpublish Pattern" })).not.toBeDisabled());
    expect(screen.getByRole("status")).toHaveTextContent("2 consumers are still bound.");
  });

  it("keeps the current reuse state visible but disables its mutation actions in preview", () => {
    const doc = reusableDocument();
    doc.publication = { kind: "pattern" };
    renderPanel({ document: doc, selectedId: null, mode: "preview" });

    const unpublish = screen.getByRole("button", { name: "Unpublish Pattern" });
    expect(screen.getByText("Published as Pattern")).toBeInTheDocument();
    expect(unpublish).toBeDisabled();
    expect(unpublish).toHaveAccessibleDescription(/reuse actions are unavailable in preview/i);
  });

  it("keeps controller errors visible without treating them as accepted Pattern publication", () => {
    renderPanel({ document: reusableDocument(), selectedId: null, lastError: "This Composition cannot be published right now." });
    expect(screen.getByRole("status")).toHaveTextContent("This Composition cannot be published right now.");
    expect(screen.queryByText("Published as Pattern")).not.toBeInTheDocument();
  });
});

describe("InspectorPanel — identity + breadcrumb + slot counts", () => {
  it("shows identity and Root breadcrumb for a top-level node", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a")]);
    const { container } = renderPanel({ document: doc, selectedId: "a" });
    const identity = container.querySelector("[data-sg-inspector-identity]")!;
    expect(identity.textContent).toContain(TEST_COMPONENT_IDS.label);
    expect(identity.textContent).toContain("v1");
    const breadcrumb = screen.getByRole("navigation", { name: /selected component location/i });
    expect(breadcrumb.textContent).toContain("Root");
  });

  it("uses titleFor for a friendlier identity + breadcrumb label when supplied", () => {
    const doc = makeDocument([
      makeNode(
        TEST_COMPONENT_IDS.panel,
        {},
        { left: [makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "child")] },
        "panel",
      ),
    ]);
    renderPanel({
      document: doc,
      selectedId: "child",
      titleFor: (id) => (id === TEST_COMPONENT_IDS.panel ? "Split Panel" : undefined),
    });
    const breadcrumb = screen.getByRole("navigation", { name: /selected component location/i });
    const items = within(breadcrumb).getAllByRole("listitem");
    expect(items.map((li) => li.textContent).join(" | ")).toContain("Split Panel › Left");
  });

  it("shows slot counts for a container node", () => {
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
    const { container } = renderPanel({ document: doc, selectedId: "panel" });
    const items = Array.from(container.querySelectorAll("[data-sg-inspector-slots] li")).map(
      (li) => li.textContent,
    );
    expect(items).toEqual(["Left — 1 child (single)", "Right — 2 children"]);
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
});

describe("InspectorPanel — read-only / preview mode", () => {
  it("disables every field control and the move/remove actions while keeping values visible", () => {
    const doc = makeDocument([
      makeNode(TEST_COMPONENT_IDS.widget, { title: "Locked", note: "n", enabled: true, count: 3, variant: "solid", tint: "#000" }, {}, "w"),
    ]);
    renderPanel({ document: doc, selectedId: "w", mode: "preview" });
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Title")).toHaveValue("Locked");
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(screen.getByText(/preview mode/i, { selector: "p" })).toBeInTheDocument();
  });
});

describe("InspectorPanel — opaque nodes", () => {
  it("shows diagnostics + raw identity, no editable fields, but allows move/remove", () => {
    const doc = makeDocument([makeNode("unknown.thing", { anything: "x" }, {}, "ghost")]);
    const { container, onRemove } = renderPanel({ document: doc, selectedId: "ghost" });

    const identity = container.querySelector("[data-sg-inspector-identity]")!;
    expect(identity.textContent).toContain("unknown.thing");
    expect(screen.getByText(/can't be edited/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/unknown component/i, { selector: "li" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledWith("ghost");

    // Single top-level node: nothing to move up/down into.
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("keeps declared fields hidden for a known component with an unsupported version", () => {
    const versioned = makeNode(TEST_COMPONENT_IDS.label, { text: "Preserved" }, {}, "future");
    versioned.componentVersion = 2;
    renderPanel({ document: makeDocument([versioned]), selectedId: "future" });
    expect(screen.getByText(/can't be edited/i, { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText(/manifest provides v1/i, { selector: "li" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Text")).not.toBeInTheDocument();
  });

  it("enables sibling move for an opaque node with siblings", () => {
    const doc = makeDocument([
      makeNode(TEST_COMPONENT_IDS.label, { text: "A" }, {}, "a"),
      makeNode("unknown.thing", {}, {}, "ghost"),
    ]);
    const { onReorder } = renderPanel({ document: doc, selectedId: "ghost" });
    const upButton = screen.getByRole("button", { name: "Move up" });
    expect(upButton).not.toBeDisabled();
    fireEvent.click(upButton);
    expect(onReorder).toHaveBeenCalledWith("ghost", "up");
  });
});

describe("InspectorPanel — DOM scoping sanity", () => {
  it("does not leak diagnostics markup when the node is editable", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.label, { text: "Hi" }, {}, "a")]);
    const { container } = renderPanel({ document: doc, selectedId: "a" });
    expect(within(container as HTMLElement).queryByRole("alert")).not.toBeInTheDocument();
  });
});
