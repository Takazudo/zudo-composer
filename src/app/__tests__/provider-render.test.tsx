import { render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { CompositionCanvas } from "../../features/composer/preview/renderer";
import { activeComponentProvider } from "../../features/composer/active-pack";
import { createProductionSampleDocument } from "../provider-integration";

describe("real provider preview render", () => {
  it("renders container, named slots, leaves, and focused ProseMd WASM output", async () => {
    const document = createProductionSampleDocument();
    const { container } = render(
      <CompositionCanvas
        document={document}
        localRecordId={document.id}
        provider={activeComponentProvider}
        session={{ mode: "preview", theme: "light", selectedId: null }}
        onSelect={vi.fn()}
        onRequestAdd={vi.fn()}
        onRequestNodeMenu={vi.fn()}
        onRequestInsertMenu={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Build a clear product story" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse products/i })).toHaveAttribute("href", "/products");
    expect(container.querySelector(".zc-node[data-zc-node-id='sample-container']")).toBeInTheDocument();
    expect(container.querySelector(".zc-node[data-zc-node-id='sample-split']")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("A real provider composition", { selector: "h2" })).toBeInTheDocument();
      expect(container.querySelector("pre code")).toHaveTextContent("const ready = true;");
      expect(container.querySelector(".hi-kw")).toHaveTextContent("const");
      expect(container.querySelector(".hi-const")).toHaveTextContent("true");
    }, { timeout: 10_000 });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  }, 15_000);
});
