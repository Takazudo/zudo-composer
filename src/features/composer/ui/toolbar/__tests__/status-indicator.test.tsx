/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import { ComposerStatusIndicator } from "../status-indicator";

describe("ComposerStatusIndicator", () => {
  it("announces an honest, human-readable status via aria-live", () => {
    render(<ComposerStatusIndicator saveStatus={{ kind: "saved" }} />);
    const status = screen.getByText("Saved");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("data-sg-status", "saved");
  });

  it("surfaces a provider-neutral error with Retry", () => {
    const onRetry = vi.fn();
    render(
      <ComposerStatusIndicator
        saveStatus={{ kind: "error", reason: "quota exceeded" }}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText("Save failed")).toHaveAttribute("data-sg-status", "error");
    expect(screen.getByText("Save failed")).toHaveAttribute("title", "quota exceeded");
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("is composable — a later status chip (e.g. wave-6 clipboard chip) can render beside it via children", () => {
    render(
      <ComposerStatusIndicator saveStatus={{ kind: "saved" }}>
        <span>Copied</span>
      </ComposerStatusIndicator>,
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByText("Copied")).toBeInTheDocument();
  });

  it("keeps canonical Saved visible alongside a separate blocked generated-output warning", () => {
    render(
      <ComposerStatusIndicator
        saveStatus={{ kind: "saved" }}
        derivedOutput={{
          status: "blocked",
          records: [{ recordId: "consumer", status: "blocked", reason: "The linked source is unavailable." }],
        }}
      />,
    );
    expect(screen.getByText("Saved")).toBeInTheDocument();
    const warning = screen.getByText("Generated output blocked");
    expect(warning).toHaveAttribute("data-sg-generated-output", "blocked");
    expect(warning).toHaveAttribute("title", "The linked source is unavailable.");
  });
});
