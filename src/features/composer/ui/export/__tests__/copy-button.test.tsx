/** @jsxRuntime automatic */
/** @jsxImportSource preact */
import "../../../test-support/cleanup";
// Mocks the shared `copyText` utility so this suite verifies this
// component's success/failure feedback deterministically, independent of a
// test environment's Clipboard API / execCommand emulation quirks.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";

const copyTextMock = vi.fn<(text: string) => Promise<boolean>>();

vi.mock("../../../../../shared/clipboard", () => ({
  copyText: (text: string) => copyTextMock(text),
}));

describe("ComposerCopyButton", () => {
  beforeEach(() => {
    copyTextMock.mockReset();
  });

  it("shows success feedback and announces it when copying succeeds", async () => {
    copyTextMock.mockResolvedValue(true);
    const { ComposerCopyButton } = await import("../copy-button");
    render(<ComposerCopyButton text="const x = 1;" />);

    const button = screen.getByRole("button", { name: /copy jsx/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Copied"));
    expect(button).toHaveAttribute("data-sg-copy-status", "copied");
    expect(screen.getByRole("status")).toHaveTextContent(/copied to clipboard/i);
    expect(copyTextMock).toHaveBeenCalledWith("const x = 1;");
  });

  it("shows failure feedback and announces it when copying fails", async () => {
    copyTextMock.mockResolvedValue(false);
    const { ComposerCopyButton } = await import("../copy-button");
    render(<ComposerCopyButton text="const x = 1;" />);

    const button = screen.getByRole("button", { name: /copy jsx/i });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Copy failed"));
    expect(button).toHaveAttribute("data-sg-copy-status", "failed");
    expect(screen.getByRole("status")).toHaveTextContent(/copy failed/i);
  });

  it("returns to idle after the feedback window", async () => {
    copyTextMock.mockResolvedValue(true);
    const { ComposerCopyButton } = await import("../copy-button");
    render(<ComposerCopyButton text="x" label="Copy JSX" />);

    fireEvent.click(screen.getByRole("button", { name: /copy jsx/i }));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Copied"));
    await waitFor(() => expect(screen.getByRole("button")).toHaveTextContent("Copy JSX"), { timeout: 3000 });
  });
});
