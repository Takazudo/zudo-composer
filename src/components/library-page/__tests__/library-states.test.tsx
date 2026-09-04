import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import "./library-test-environment";
import { ComposerIcon } from "../../icons";
import { Button } from "../../ui";
import {
  LibraryEmpty,
  LibraryNoMatch,
  LibraryRecoveryBanner,
  LibrarySkeleton,
  LibraryUnavailableBanner,
} from "../library-states";

describe("LibrarySkeleton", () => {
  it("announces the wait once while the placeholder rows stay decorative", () => {
    const { container } = render(<LibrarySkeleton rows={3} columns={4} label="Loading compositions…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Loading compositions…");
    expect(container.querySelectorAll(".cms-library-skeleton__row")).toHaveLength(3);
    expect(container.querySelectorAll(".cms-library-skeleton__row[aria-hidden='true']")).toHaveLength(3);
    expect(container.querySelectorAll(".cms-library-skeleton__bar")).toHaveLength(12);
  });
});

describe("LibraryEmpty", () => {
  it("says what the library is for and offers the primary action", () => {
    const onCreate = vi.fn();
    render(
      <LibraryEmpty
        icon={ComposerIcon}
        title="No compositions yet"
        description="Reusable page structures built from the 12 provider components."
        action={<Button variant="primary" onClick={onCreate}>New composition</Button>}
      />,
    );
    expect(screen.getByText("No compositions yet")).toBeInTheDocument();
    expect(screen.getByText(/Reusable page structures/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New composition" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });
});

describe("LibraryNoMatch", () => {
  it("quotes the filter that hid everything and offers a way out of it", () => {
    const onClearFilters = vi.fn();
    render(<LibraryNoMatch search="  pricing  " onClearFilters={onClearFilters} />);
    expect(screen.getByText("No matches for “pricing”")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledOnce();
  });

  it("falls back to a generic title when only a facet is narrowing the list", () => {
    render(<LibraryNoMatch onClearFilters={vi.fn()} />);
    expect(screen.getByText("No matching records")).toBeInTheDocument();
  });
});

describe("LibraryRecoveryBanner", () => {
  it("offers Retry and a destructive Start fresh that opens a confirmation", () => {
    const onRetry = vi.fn();
    const onStartFresh = vi.fn();
    render(
      <LibraryRecoveryBanner
        title="Stored compositions need recovery."
        description="2 of 6 records could not be read."
        onRetry={onRetry}
        onStartFresh={onStartFresh}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Stored compositions need recovery.");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();

    // The ellipsis is the promise that the discard is confirmed, not immediate.
    const startFresh = screen.getByRole("button", { name: "Start fresh…" });
    expect(startFresh).toHaveClass("cms-btn--danger");
    fireEvent.click(startFresh);
    expect(onStartFresh).toHaveBeenCalledOnce();
  });
});

describe("LibraryUnavailableBanner", () => {
  it("reports the failure as an alert with only a Retry", () => {
    const onRetry = vi.fn();
    render(
      <LibraryUnavailableBanner
        title="Composition library unavailable."
        description="IndexedDB could not be opened in this browser session."
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Composition library unavailable.");
    expect(screen.getAllByRole("button")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
