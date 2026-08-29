/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
// Focused test for the clipboard chip wiring (issue #255) — the rest of
// ComposerToolbarBar's presentational contract is exercised end-to-end via
// composer-integration.test.tsx (issue #251).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import type { CompositionNode } from "../../../../composer";
import { ComposerToolbarBar } from "../composer-toolbar-bar";

function noop() {
  /* no-op */
}

function baseProps() {
  return {
    documentName: "Doc",
    saveStatus: { kind: "saved" } as const,
    mode: "edit" as const,
    viewport: "fluid" as const,
    onSetMode: noop,
    onSetViewport: noop,
    onReset: noop,
    onExport: noop,
  };
}

describe("ComposerToolbarBar — clipboard chip", () => {
  it("shows the document's explicit reusable role beside its header identity", () => {
    render(
      <ComposerToolbarBar
        {...baseProps()}
        publication={{
          kind: "global-template",
          outlet: { id: "outlet-main", label: "Main content", target: { parentId: "shell", slotId: "content" } },
        }}
      />,
    );
    expect(screen.getByText("Global template · Main content")).toBeInTheDocument();
  });

  it("renders no chip when the clipboard is empty (the default)", () => {
    render(<ComposerToolbarBar {...baseProps()} />);
    expect(screen.queryByText(/⧉/)).toBeNull();
  });

  it("renders the clipboard component's display name beside the save status when non-empty", () => {
    const clipboard: CompositionNode = { id: "b", componentId: "test.box", componentVersion: 1, props: {}, slots: {} };
    const titleFor = vi.fn((id: string) => (id === "test.box" ? "Box" : undefined));
    render(<ComposerToolbarBar {...baseProps()} clipboard={clipboard} titleFor={titleFor} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Box")).toBeInTheDocument();
    expect(titleFor).toHaveBeenCalledWith("test.box");
  });

  it("keeps Saved visible while showing a separate generated-output warning", () => {
    render(
      <ComposerToolbarBar
        {...baseProps()}
        derivedOutput={{
          status: "blocked",
          records: [{ recordId: "consumer", status: "blocked", reason: "Linked source is unavailable." }],
        }}
      />,
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Generated output blocked")).toHaveAttribute(
      "data-sg-generated-output",
      "blocked",
    );
  });
});
