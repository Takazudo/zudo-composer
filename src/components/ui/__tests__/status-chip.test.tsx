import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { StatusChip } from "../status-chip";

describe("StatusChip", () => {
  it("announces the saved state politely", () => {
    render(<StatusChip state="saved" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saved");
    expect(status.className).toBe("cms-status cms-status--ok");
    expect(status).toHaveAttribute("data-state", "saved");
  });

  it("names the unsaved state in the warn tone", () => {
    render(<StatusChip state="unsaved" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Unsaved changes");
    expect(status.className).toBe("cms-status cms-status--warn");
  });

  it("spins while saving", () => {
    const { container } = render(<StatusChip state="saving" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Saving…");
    expect(status.className).toBe("cms-status");
    expect(container.querySelector(".cms-status__spinner")).not.toBeNull();
  });

  it("offers Retry only in the failed state", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<StatusChip state="failed" onRetry={onRetry} />);
    const status = screen.getByRole("status");
    expect(status.className).toBe("cms-status cms-status--err");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    rerender(<StatusChip state="saved" onRetry={onRetry} />);
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("defaults retrying off and restores the same markup after retrying", () => {
    const onRetry = vi.fn();
    const { container, rerender } = render(<StatusChip state="failed" onRetry={onRetry} />);
    const normal = container.innerHTML;
    const button = screen.getByRole("button", { name: "Retry" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button.querySelector(".cms-btn__spinner")).toBeNull();
    rerender(<StatusChip state="failed" onRetry={onRetry} retrying />);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    rerender(<StatusChip state="failed" onRetry={onRetry} retrying={false} />);
    expect(container.innerHTML).toBe(normal);
  });

  it("appends the storage detail after a middot", () => {
    render(<StatusChip state="saved" detail="Browser storage" />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved · Browser storage");
  });

  it("takes a label, tone and icon in the custom state", () => {
    const { container } = render(<StatusChip state="custom" label="Preview is current" tone="ok" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Preview is current");
    expect(status.className).toBe("cms-status cms-status--ok");
    expect(status).toHaveAttribute("data-state", "custom");
    expect(container.querySelector(".cms-status__icon")).toBeNull();
  });

  it("lets a caller override a preset label without losing its tone", () => {
    render(<StatusChip state="failed" label="Could not reach storage" onRetry={vi.fn()} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Could not reach storage");
    expect(status.className).toBe("cms-status cms-status--err");
  });
});
