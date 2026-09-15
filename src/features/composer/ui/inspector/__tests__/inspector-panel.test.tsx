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
  testManifestEntries,
} from "../../test-support/composer-fixtures";
import { InspectorPanel, type InspectorPanelProps } from "../inspector-panel";

const copyTextMock = vi.fn<(text: string) => Promise<boolean>>();

vi.mock("../../../../../shared/clipboard", () => ({
  copyText: (text: string) => copyTextMock(text),
}));

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

  it("shows the Grammar-for-agents block for the document row when the root policy is restricted", () => {
    const doc = makeDocument([]);
    doc.binding = { sourceRecordId: "source", outletId: "outlet-main" };
    renderPanel({
      document: doc,
      selectedId: null,
      entries: testManifestEntries,
      rootPolicy: {
        kind: "resolved",
        accepts: [TEST_COMPONENT_IDS.label],
        cardinality: "many",
        min: 1,
        origin: {
          componentId: TEST_COMPONENT_IDS.panel,
          componentTitle: "Panel",
          slotId: "left",
          slotLabel: "Left",
        },
      },
    });

    expect(screen.getByText("Grammar for agents")).toBeInTheDocument();
    expect(screen.getByText(/Region "Left" = test\.panel › left/)).toBeInTheDocument();
  });

  it("omits the Grammar-for-agents block for the document row when the root policy is unrestricted", () => {
    renderPanel({ document: makeDocument([]), selectedId: null });
    expect(screen.queryByText("Grammar for agents")).not.toBeInTheDocument();
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
  it("lists every slot with its child count, an open-slot line, and jumps to one", () => {
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
    expect(items[0]).toContain("Left1 child · single");
    expect(items[1]).toContain("Right2 children");
    // Neither panel slot declares `accepts`, so both are open.
    expect(items[0]).toContain("Accepts any component in the pack.");
    expect(items[1]).toContain("Accepts any component in the pack.");

    fireEvent.click(screen.getByRole("button", { name: "Jump to Right" }));
    expect(onJumpToSlot).toHaveBeenCalledWith({ parentId: "panel", slotId: "right" });
  });

  function regionDoc(children: ReturnType<typeof makeNode>[] = []) {
    return makeDocument([makeNode(TEST_COMPONENT_IDS.region, {}, { body: children }, "region")]);
  }

  it("shows a restricted slot's rule: accepted rows with ids, a 'has rule' badge, and the bounds sentence", () => {
    const { container } = renderPanel({
      document: regionDoc(),
      selectedId: "region",
      entries: testManifestEntries,
    });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    const slot = container.querySelector('[data-sg-inspector-slots] li[class="sg-composer-inspector-slot"]')!;
    expect(slot.textContent).toContain("Rule from Region › Body");
    expect(slot.textContent).toContain(TEST_COMPONENT_IDS.label);
    expect(slot.textContent).toContain(TEST_COMPONENT_IDS.card);
    expect(slot.textContent).toContain("has rule");
    expect(slot.textContent).toContain("Cardinality: many · at least 2 · at most 3");
    expect(slot.textContent).toContain("Read-only here.");

    // Only the card accepted-component row restricts its own slot.
    const rows = Array.from(container.querySelectorAll(".sg-composer-inspector-rule-row"));
    const cardRow = rows.find((row) => row.textContent?.includes(TEST_COMPONENT_IDS.card));
    const labelRow = rows.find((row) => row.textContent?.includes(TEST_COMPONENT_IDS.label));
    expect(cardRow?.textContent).toContain("has rule");
    expect(labelRow?.textContent).not.toContain("has rule");
  });

  it("warns when a restricted slot holds fewer children than its declared minimum", () => {
    renderPanel({
      document: regionDoc([makeNode(TEST_COMPONENT_IDS.label, { text: "A" })]),
      selectedId: "region",
      entries: testManifestEntries,
    });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    expect(screen.getByText(/needs at least 2/)).toBeInTheDocument();
  });

  it("does not warn once the restricted slot meets its declared minimum", () => {
    renderPanel({
      document: regionDoc([
        makeNode(TEST_COMPONENT_IDS.label, { text: "A" }),
        makeNode(TEST_COMPONENT_IDS.label, { text: "B" }),
      ]),
      selectedId: "region",
      entries: testManifestEntries,
    });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    expect(screen.queryByText(/needs at least/)).not.toBeInTheDocument();
  });

  it("shows the consumer-facing rule for a published Global template outlet instead of a blocked verdict", () => {
    const doc = regionDoc();
    doc.publication = {
      kind: "global-template",
      outlet: { id: "outlet-body", label: "Body", target: { parentId: "region", slotId: "body" } },
    };
    const { container } = renderPanel({ document: doc, selectedId: "region", entries: testManifestEntries });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    const rule = container.querySelector(".sg-composer-inspector-rule")!;
    expect(rule.textContent).toContain("Applies to: every page bound to this template");
    expect(rule.textContent).toContain(TEST_COMPONENT_IDS.label);
    expect(screen.queryByText(/reserved for its consumers/)).not.toBeInTheDocument();
  });
});

describe("InspectorPanel — Grammar for agents", () => {
  beforeEach(() => {
    copyTextMock.mockReset();
  });

  function regionDoc(children: ReturnType<typeof makeNode>[] = []) {
    return makeDocument([makeNode(TEST_COMPONENT_IDS.region, {}, { body: children }, "region")]);
  }

  it("shows the block, below the Rule block, for a restricted slot", () => {
    const { container } = renderPanel({
      document: regionDoc(),
      selectedId: "region",
      entries: testManifestEntries,
    });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    const slot = container.querySelector('[data-sg-inspector-slots] li[class="sg-composer-inspector-slot"]')!;
    const rule = slot.querySelector(".sg-composer-inspector-rule")!;
    const grammar = slot.querySelector<HTMLElement>(".sg-composer-inspector-grammar")!;
    expect(grammar).toBeInTheDocument();
    // Below, in document order, the existing Rule block.
    expect(rule.compareDocumentPosition(grammar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(within(grammar).getByText("Grammar for agents")).toBeInTheDocument();
    expect(grammar.textContent).toContain(TEST_COMPONENT_IDS.label);
    expect(grammar.textContent).toContain(TEST_COMPONENT_IDS.card);
    expect(grammar.textContent).toContain("Same output as");
  });

  it("omits the block for an open slot", () => {
    const doc = makeDocument([makeNode(TEST_COMPONENT_IDS.panel, {}, { left: [], right: [] }, "panel")]);
    const { container } = renderPanel({ document: doc, selectedId: "panel", entries: testManifestEntries });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    expect(container.querySelector(".sg-composer-inspector-grammar")).not.toBeInTheDocument();
  });

  it("renders this document's own buildGrammar output for a published Global template outlet", () => {
    const doc = regionDoc();
    doc.publication = {
      kind: "global-template",
      outlet: { id: "outlet-body", label: "Body", target: { parentId: "region", slotId: "body" } },
    };
    const { container } = renderPanel({ document: doc, selectedId: "region", entries: testManifestEntries });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    const grammar = container.querySelector<HTMLElement>(".sg-composer-inspector-grammar")!;
    // The header `zudo-composer grammar` itself would print for this exact template.
    expect(grammar.textContent).toContain(`${doc.name} (template ${doc.id})`);
  });

  it("swaps the rendered text between Markdown and JSON", () => {
    const { container } = renderPanel({
      document: regionDoc(),
      selectedId: "region",
      entries: testManifestEntries,
    });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));

    const grammar = container.querySelector<HTMLElement>(".sg-composer-inspector-grammar")!;
    expect(grammar.querySelector("pre")?.textContent).toContain('Region "Body" = test.region › body');

    fireEvent.click(within(grammar).getByRole("button", { name: "JSON" }));
    expect(grammar.querySelector("pre")?.textContent).toContain('"slotId": "body"');
    expect(grammar.querySelector("pre")?.textContent).not.toContain('Region "Body"');

    fireEvent.click(within(grammar).getByRole("button", { name: "Markdown" }));
    expect(grammar.querySelector("pre")?.textContent).toContain('Region "Body" = test.region › body');
  });

  it("copies whichever text is currently displayed", () => {
    copyTextMock.mockResolvedValue(true);
    const { container } = renderPanel({
      document: regionDoc(),
      selectedId: "region",
      entries: testManifestEntries,
    });
    fireEvent.click(screen.getByRole("tab", { name: /Slots/ }));
    const grammar = container.querySelector<HTMLElement>(".sg-composer-inspector-grammar")!;

    fireEvent.click(within(grammar).getByRole("button", { name: "Copy" }));
    expect(copyTextMock).toHaveBeenCalledWith(expect.stringContaining('Region "Body" = test.region › body'));

    fireEvent.click(within(grammar).getByRole("button", { name: "JSON" }));
    fireEvent.click(within(grammar).getByRole("button", { name: "Copy" }));
    expect(copyTextMock).toHaveBeenLastCalledWith(expect.stringContaining('"slotId": "body"'));
  });
});

describe("InspectorPanel — unaccepted-child diagnostics", () => {
  it("points at the slot rule when a node holds a child its own slot rejects", () => {
    const doc = makeDocument([
      makeNode(
        TEST_COMPONENT_IDS.region,
        {},
        { body: [makeNode(TEST_COMPONENT_IDS.widget, {}, {}, "bad-child")] },
        "region",
      ),
    ]);
    renderPanel({ document: doc, selectedId: "region", entries: testManifestEntries });

    expect(screen.getByText(/does not accept "test\.widget"/)).toBeInTheDocument();
    expect(screen.getByText(/rule from test\.region › /)).toBeInTheDocument();
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
