import "./cleanup";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { Button } from "../button";
import { DataTable } from "../data-table";
import type { DataTableColumn } from "../data-table";

interface Composition {
  id: string;
  name: string;
  kind: string;
  slots: number;
}

const ROWS: readonly Composition[] = [
  { id: "c1", name: "Product overview", kind: "Pattern", slots: 8 },
  { id: "c2", name: "Pricing", kind: "Page", slots: 4 },
  { id: "c3", name: "Docs shell", kind: "Pattern", slots: 12 },
];

const COLUMNS: readonly DataTableColumn<Composition>[] = [
  { key: "name", header: "Name", variant: "name", cell: (row) => row.name },
  { key: "kind", header: "Kind", cell: (row) => row.kind },
  { key: "slots", header: "Slots", variant: "num", cell: (row) => row.slots },
];

function baseProps() {
  return { caption: "Compositions", columns: COLUMNS, rows: ROWS, rowKey: (row: Composition) => row.id };
}

function SelectableHarness({ rows = ROWS }: { rows?: readonly Composition[] }) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  return (
    <DataTable
      {...baseProps()}
      rows={rows}
      selection={{
        selectedIds,
        rowLabel: (row) => row.name,
        onToggleRow: (id, selected) =>
          setSelectedIds((current) => {
            const next = new Set(current);
            if (selected) next.add(id);
            else next.delete(id);
            return next;
          }),
        onToggleAll: (selected) => setSelectedIds(selected ? new Set(rows.map((row) => row.id)) : new Set()),
      }}
      bulkBar={selectedIds.size > 0 ? <span>{selectedIds.size} selected</span> : undefined}
    />
  );
}

describe("DataTable", () => {
  it("renders one row per record under a named table", () => {
    render(<DataTable {...baseProps()} />);
    const table = screen.getByRole("table", { name: "Compositions" });
    expect(within(table).getAllByRole("row")).toHaveLength(ROWS.length + 1);
    expect(within(table).getByRole("columnheader", { name: "Slots" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "Product overview" })).toBeInTheDocument();
  });

  it("marks column variants so the name and number cells keep their emphasis", () => {
    const { container } = render(<DataTable {...baseProps()} />);
    expect(container.querySelectorAll("td.cms-table__cell--name")).toHaveLength(3);
    expect(container.querySelectorAll("td.cms-table__cell--num")).toHaveLength(3);
  });

  it("leaves rows unselectable without a selection contract", () => {
    const { container } = render(<DataTable {...baseProps()} />);
    expect(container.querySelectorAll("tr[aria-selected]")).toHaveLength(0);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("selects a row by its own name and reflects it on the row", () => {
    render(<SelectableHarness />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pricing" }));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveAttribute("aria-selected", "false");
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("moves the header box through mixed to fully selected", () => {
    render(<SelectableHarness />);
    const selectAll = () => screen.getByRole("checkbox", { name: "Select all rows" }) as HTMLInputElement;
    expect(selectAll().indeterminate).toBe(false);
    expect(selectAll()).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Pricing" }));
    expect(selectAll().indeterminate).toBe(true);

    fireEvent.click(selectAll());
    expect(selectAll()).toBeChecked();
    expect(selectAll().indeterminate).toBe(false);
    expect(screen.getAllByRole("row").slice(1).every((row) => row.getAttribute("aria-selected") === "true")).toBe(true);

    fireEvent.click(selectAll());
    expect(screen.getByText("Product overview")).toBeInTheDocument();
    expect(screen.queryByText("1 selected")).toBeNull();
  });

  it("keeps the header box unchecked when there are no rows to select", () => {
    render(<SelectableHarness rows={[]} />);
    expect(screen.getByRole("checkbox", { name: "Select all rows" })).not.toBeChecked();
  });

  it("renders a hover-only actions cell that stays reachable by keyboard", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <DataTable
        {...baseProps()}
        rowActions={(row) => (
          <Button size="sm" iconOnly aria-label={`More actions for ${row.name}`} onClick={() => onOpen(row.id)}>
            {"⋯"}
          </Button>
        )}
      />,
    );
    expect(container.querySelectorAll("td.cms-table__actions")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "More actions for Pricing" }));
    expect(onOpen).toHaveBeenCalledWith("c2");
  });

  it("renders the empty slot across every column instead of rows", () => {
    const { container } = render(<DataTable {...baseProps()} rows={[]} empty={<span>No compositions yet</span>} />);
    expect(screen.getByText("No compositions yet")).toBeInTheDocument();
    expect(container.querySelector(".cms-table__empty-row td")).toHaveAttribute("colspan", "3");
  });

  it("spans the checkbox and actions columns in the empty row too", () => {
    const { container } = render(
      <DataTable
        {...baseProps()}
        rows={[]}
        rowActions={() => null}
        selection={{
          selectedIds: new Set(),
          rowLabel: (row) => row.name,
          onToggleRow: vi.fn(),
          onToggleAll: vi.fn(),
        }}
        empty={<span>No compositions yet</span>}
      />,
    );
    expect(container.querySelector(".cms-table__empty-row td")).toHaveAttribute("colspan", "5");
  });

  it("scrolls horizontally inside its own wrapper", () => {
    const { container } = render(<DataTable {...baseProps()} />);
    const wrap = container.querySelector(".cms-table-wrap");
    expect(wrap).not.toBeNull();
    expect(wrap!.querySelector("table.cms-table")).not.toBeNull();
  });

  it("offers a compact density", () => {
    const { container } = render(<DataTable {...baseProps()} density="compact" />);
    expect(container.querySelector("table")!.className).toBe("cms-table cms-table--compact");
  });
});
