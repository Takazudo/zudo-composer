import { signal } from "@takazudo/zfb/zudo-react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, settle, within } from "../../../test/render";
import "./library-test-environment";
import { LibraryTable } from "../library-table";
import { createLibraryQuery } from "../library-query";
import { LibraryToolbar, LibraryViewToggle, type LibraryView } from "../library-toolbar";
import { CONTRACT, KIND_FACET, RECORDS, SORTS, searchText } from "./library-fixtures";

function LibraryHarness({ withView = false }: { withView?: boolean } = {}) {
  const query = createLibraryQuery({ rows: RECORDS, searchText, facets: [KIND_FACET], sorts: SORTS });
  const view = signal<LibraryView>("table");
  return (
    <div>
      <LibraryToolbar
        query={query}
        end={withView ? <LibraryViewToggle value={view} onChange={(next) => { view.value = next; }} /> : undefined}
      />
      <LibraryTable caption="Records" rows={query.rows} contract={CONTRACT} />
    </div>
  );
}

function rowNames(): string[] {
  return screen.getAllByRole("row").slice(1).map((row) => row.querySelector(".cms-library-name__label")!.textContent!);
}

describe("LibraryToolbar", () => {
  it("filters the table from the search input", async () => {
    render(<LibraryHarness />);
    fireEvent.input(screen.getByRole("searchbox", { name: "Filter records" }), { target: { value: "hero" } });
    await settle();
    expect(rowNames()).toEqual(["Landing hero"]);
  });

  it("reads the facet's current answer on its trigger and narrows when another is chosen", async () => {
    render(<LibraryHarness />);
    const trigger = screen.getByRole("button", { name: /Kind: All/ });
    fireEvent.click(trigger);
    await settle();

    const menu = screen.getByRole("menu", { name: "Kind" });
    expect(within(menu).getByRole("menuitemradio", { name: "All" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Global template" }));
    await settle();
    expect(rowNames()).toEqual(["Site frame"]);
    expect(screen.getByRole("button", { name: /Kind: Global template/ })).toBeInTheDocument();
  });

  it("reorders the table from the sort menu", async () => {
    render(<LibraryHarness />);
    expect(rowNames()[0]).toBe("Product overview");

    fireEvent.click(screen.getByRole("button", { name: /Updated/ }));
    await settle();
    fireEvent.click(within(screen.getByRole("menu", { name: "Sort" })).getByRole("menuitemradio", { name: "Name" }));
    await settle();
    expect(rowNames()[0]).toBe("Blog post");
    expect(screen.getByRole("button", { name: /Name/ })).toBeInTheDocument();
  });

  it("names the sort trigger after what it sorts, since it shows only its value", async () => {
    render(<LibraryHarness />);
    expect(screen.getByRole("button", { name: "Sort: Updated" })).toBeInTheDocument();
    // The facet says it on the face of the trigger, so it needs no override.
    expect(screen.getByRole("button", { name: "Kind: All" })).not.toHaveAttribute("aria-label");
  });

  it("renders the optional view toggle only when the route supplies one", async () => {
    const plain = render(<LibraryHarness />);
    expect(screen.queryByRole("radiogroup", { name: "View" })).toBeNull();

    // Whether the route supplies a toggle is fixed per mount.
    plain.unmount();
    render(<LibraryHarness withView />);
    const group = screen.getByRole("radiogroup", { name: "View" });
    expect(within(group).getByRole("radio", { name: "Table" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(group).getByRole("radio", { name: "Cards" }));
    await settle();
    expect(within(group).getByRole("radio", { name: "Cards" })).toHaveAttribute("aria-checked", "true");
  });

  it("is just the layout row for a route that drives its own controls", async () => {
    render(
      <LibraryToolbar>
        <button type="button">Route control</button>
      </LibraryToolbar>,
    );
    expect(screen.queryByRole("searchbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Route control" })).toBeInTheDocument();
  });
});

describe("LibraryViewToggle", () => {
  it("names both segments even though they are icon-only", async () => {
    const onChange = vi.fn();
    render(<LibraryViewToggle value="cards" onChange={onChange} tableLabel="List" cardsLabel="Grid" />);
    expect(screen.getByRole("radio", { name: "Grid" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    await settle();
    expect(onChange).toHaveBeenCalledWith("table");
  });
});
