/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
// Focused tests for optional ComposerToolbarBar presentation seams. The wider
// toolbar contract is exercised end-to-end via composer-integration.test.tsx
// (issue #251).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import type { CompositionNode } from "../../../../composer/browser";
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

describe("ComposerToolbarBar — undo and redo actions", () => {
  it("preserves the existing toolbar DOM when the optional callbacks are omitted", () => {
    render(<ComposerToolbarBar {...baseProps()} />);

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Redo" })).toBeNull();
    expect(screen.getByRole("button", { name: "Export JSX" })).toBeInTheDocument();
  });

  it("renders accessible toolbar buttons with shortcut titles and invokes enabled actions", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    render(
      <ComposerToolbarBar
        {...baseProps()}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo
        canRedo
      />,
    );

    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toHaveAttribute("title", "Undo (Cmd+Z / Ctrl+Z)");
    expect(redo).toHaveAttribute("title", "Redo (Cmd+Shift+Z / Ctrl+Shift+Z or Ctrl+Y)");
    expect(undo).toHaveClass("sg-composer-toolbar-button");
    expect(redo).toHaveClass("sg-composer-toolbar-button");

    fireEvent.click(undo);
    fireEvent.click(redo);
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("uses actual disabled state from the supplied flags without masking preview mode", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { rerender } = render(
      <ComposerToolbarBar
        {...baseProps()}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={false}
        canRedo={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();

    rerender(
      <ComposerToolbarBar
        {...baseProps()}
        mode="preview"
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo
        canRedo
      />,
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();
  });
});
