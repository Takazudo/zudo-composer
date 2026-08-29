/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../test-support/cleanup";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/preact";
import type { CompositionNode } from "../../../../composer/browser";
import { ComposerClipboardChip } from "../composer-clipboard-chip";

function box(id = "b"): CompositionNode {
  return { id, componentId: "test.box", componentVersion: 1, props: {}, slots: {} };
}

describe("ComposerClipboardChip", () => {
  it("renders nothing when the clipboard is empty", () => {
    const { container } = render(<ComposerClipboardChip clipboard={null} titleFor={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the clipboard component's friendly display name", () => {
    render(<ComposerClipboardChip clipboard={box()} titleFor={(id) => (id === "test.box" ? "Box" : undefined)} />);
    expect(screen.getByText("Box")).toBeInTheDocument();
  });

  it("falls back to the raw component id when no display name is known", () => {
    render(<ComposerClipboardChip clipboard={box()} titleFor={() => undefined} />);
    expect(screen.getByText("test.box")).toBeInTheDocument();
  });

  it("exposes the clipboard component id as a data attribute", () => {
    render(<ComposerClipboardChip clipboard={box()} titleFor={() => "Box"} />);
    expect(screen.getByText("Box").closest("[data-sg-clipboard-component]")).toHaveAttribute(
      "data-sg-clipboard-component",
      "test.box",
    );
  });
});
