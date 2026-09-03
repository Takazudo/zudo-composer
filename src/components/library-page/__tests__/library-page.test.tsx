import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import "./library-test-environment";
import { ComposerIcon } from "../../icons";
import { Button } from "../../ui";
import { LibraryPage } from "../library-page";
import { LibraryPagination } from "../library-pagination";

describe("LibraryPage", () => {
  it("heads the page with the record type, its purpose and both action slots", () => {
    const { container } = render(
      <LibraryPage
        icon={ComposerIcon}
        title="Compositions"
        purpose="Reusable page structures built from the 12 provider components."
        actions={<Button>Browser storage</Button>}
        primaryAction={<Button variant="primary">New composition</Button>}
      >
        <p>Table goes here</p>
      </LibraryPage>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Compositions" })).toBeInTheDocument();
    expect(screen.getByText(/Reusable page structures/)).toBeInTheDocument();
    expect(screen.getByText("Table goes here")).toBeInTheDocument();

    const actions = container.querySelector(".cms-library__actions")!;
    expect(actions.textContent).toBe("Browser storageNew composition");
    // Decorative: the heading already names the page.
    expect(container.querySelector(".cms-library__tile")).toHaveAttribute("aria-hidden", "true");
  });

  it("drops the header slots a route does not use", () => {
    const { container } = render(<LibraryPage title="Sitemaps" />);
    expect(container.querySelector(".cms-library__actions")).toBeNull();
    expect(container.querySelector(".cms-library__purpose")).toBeNull();
    expect(container.querySelector(".cms-library__tile")).toBeNull();
  });
});

describe("LibraryPagination", () => {
  it("shows the summary alone when the route does not page", () => {
    render(<LibraryPagination summary="6 compositions · Browser storage" />);
    expect(screen.getByText("6 compositions · Browser storage")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("steps through pages and disables the ends", () => {
    const onPageChange = vi.fn();
    render(<LibraryPagination summary="60 records" page={1} pageCount={3} onPageChange={onPageChange} />);
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("disables the next control on the last page", () => {
    render(<LibraryPagination summary="60 records" page={3} pageCount={3} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });
});
