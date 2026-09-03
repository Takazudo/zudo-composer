import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/preact";
import { useState } from "preact/hooks";
import "./library-test-environment";
import { DuplicateIcon, EditIcon, TrashIcon } from "../../icons";
import type { DataTableColumn } from "../../ui";
import { BulkBar } from "../bulk-bar";
import { formatLibraryTimestampFull } from "../library-format";
import { LibraryTable } from "../library-table";
import { useLibrarySelection } from "../library-selection";
import { CONTRACT, RECORDS, type Record_ } from "./library-fixtures";

const NODES_COLUMN: DataTableColumn<Record_> = {
  key: "nodes",
  header: "Nodes",
  variant: "num",
  cell: (row) => row.nodes,
};

function headers(): string[] {
  return screen.getAllByRole("columnheader").map((cell) => cell.textContent?.trim() ?? "");
}

describe("LibraryTable columns", () => {
  it("renders the name over its mono record id, linked to the record", () => {
    const { container } = render(<LibraryTable caption="Records" rows={RECORDS} contract={CONTRACT} />);
    const link = screen.getByRole("link", { name: "Product overview" });
    expect(link).toHaveAttribute("href", "/composer?record=product-overview");
    expect(container.querySelectorAll(".cms-library-name__sub")[0]).toHaveTextContent("product-overview");
  });

  it("takes an explicit subline, and drops the line when the contract returns null", () => {
    const { container, rerender } = render(
      <LibraryTable caption="Records" rows={RECORDS} contract={{ ...CONTRACT, subline: (row) => `${row.nodes} nodes` }} />,
    );
    expect(container.querySelectorAll(".cms-library-name__sub")[0]).toHaveTextContent("8 nodes");

    rerender(<LibraryTable caption="Records" rows={RECORDS} contract={{ ...CONTRACT, subline: () => null }} />);
    expect(container.querySelectorAll(".cms-library-name__sub")).toHaveLength(0);
  });

  it("renders a plain label when the contract has no deep link", () => {
    render(<LibraryTable caption="Records" rows={RECORDS} contract={{ ...CONTRACT, href: undefined }} />);
    expect(screen.queryByRole("link", { name: "Product overview" })).toBeNull();
    expect(screen.getByText("Product overview")).toBeInTheDocument();
  });

  it("puts the route's own columns between the kind chip and the updated column", () => {
    render(<LibraryTable caption="Records" rows={RECORDS} contract={CONTRACT} columns={[NODES_COLUMN]} />);
    expect(headers()).toEqual(["Name", "Kind", "Nodes", "Updated"]);
  });

  it("drops the built-in columns the contract does not describe", () => {
    render(
      <LibraryTable
        caption="Records"
        rows={RECORDS}
        contract={{ id: CONTRACT.id, name: CONTRACT.name }}
        columns={[NODES_COLUMN]}
      />,
    );
    expect(headers()).toEqual(["Name", "Nodes"]);
  });

  it("renders the kind as a chip, and an em dash when a row has none", () => {
    const { container } = render(
      <LibraryTable
        caption="Records"
        rows={RECORDS}
        contract={{ ...CONTRACT, kind: (row) => (row.kind === "plain" ? null : { label: "Pattern", tone: "accent" }) }}
      />,
    );
    expect(container.querySelectorAll(".cms-chip")).toHaveLength(3);
    // The dash is decorative, so it never reaches the row's accessible name.
    const blank = container.querySelector(".cms-library-blank");
    expect(blank).toHaveAttribute("aria-hidden", "true");
  });

  it("formats the updated cell as a machine-readable time carrying the full timestamp", () => {
    const { container } = render(<LibraryTable caption="Records" rows={RECORDS} contract={CONTRACT} />);
    const time = container.querySelector("time");
    expect(time).toHaveAttribute("datetime", new Date(RECORDS[0].updatedAt).toISOString());
    expect(time).toHaveAttribute("title", formatLibraryTimestampFull(RECORDS[0].updatedAt));
  });

  it("shows an em dash for a record that has never been written", () => {
    const { container } = render(
      <LibraryTable caption="Records" rows={RECORDS} contract={{ ...CONTRACT, updatedAt: () => null }} />,
    );
    expect(container.querySelectorAll("time")).toHaveLength(0);
    expect(container.querySelectorAll(".cms-library-blank")).toHaveLength(RECORDS.length);
  });

  it("renders the empty slot in place of rows", () => {
    render(<LibraryTable caption="Records" rows={[]} contract={CONTRACT} empty={<span>No records yet</span>} />);
    expect(screen.getByText("No records yet")).toBeInTheDocument();
  });
});

function SelectableTable({ onDelete }: { onDelete: () => void }) {
  const [rows, setRows] = useState<readonly Record_[]>(RECORDS);
  const selection = useLibrarySelection({ rows, rowId: CONTRACT.id });
  return (
    <LibraryTable
      caption="Records"
      rows={rows}
      contract={CONTRACT}
      selection={selection}
      bulkBar={
        selection.selectedCount > 0 ? (
          <BulkBar
            count={selection.selectedCount}
            describeCount={(count) => `${count} record${count === 1 ? "" : "s"}`}
            actions={[
              {
                id: "delete",
                label: "Delete",
                icon: TrashIcon,
                tone: "danger",
                onSelect: () => {
                  onDelete();
                  setRows((current) => current.filter((row) => !selection.selectedIds.has(row.id)));
                },
              },
            ]}
            onClear={selection.clear}
          />
        ) : undefined
      }
    />
  );
}

describe("LibraryTable selection and bulk bar", () => {
  it("names each row's checkbox after the record itself", () => {
    render(<SelectableTable onDelete={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Blog post" })).toBeInTheDocument();
  });

  it("shows the bulk bar once rows are picked and clears back out of it", () => {
    render(<SelectableTable onDelete={vi.fn()} />);
    expect(screen.queryByText("1 record")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Blog post" }));
    expect(screen.getByText("1 record")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Site frame" }));
    expect(screen.getByText("2 records")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByText("2 records")).toBeNull();
  });

  it("runs a route-supplied bulk action and drops the vanished rows from the selection", () => {
    const onDelete = vi.fn();
    render(<SelectableTable onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Blog post" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByText("Blog post")).toBeNull();
    expect(screen.queryByText("1 record")).toBeNull();
  });

  it("selects every row from the header box", () => {
    render(<SelectableTable onDelete={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all rows" }));
    expect(screen.getByText(`${RECORDS.length} records`)).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.every((row) => row.getAttribute("aria-selected") === "true")).toBe(true);
  });
});

function menuProps(row: Record_, handlers: { onOpen: () => void; onDuplicate: () => void; onDelete: () => void }) {
  return {
    label: row.name,
    open: { id: "open", label: "Open", icon: EditIcon, kbd: "↵", onSelect: handlers.onOpen },
    actions: [{ id: "duplicate", label: "Duplicate", icon: DuplicateIcon, onSelect: handlers.onDuplicate }],
    destructive: [{ id: "delete", label: "Delete…", icon: TrashIcon, onSelect: handlers.onDelete }],
  };
}

function renderWithMenu() {
  const handlers = { onOpen: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };
  const view = render(
    <LibraryTable caption="Records" rows={RECORDS} contract={CONTRACT} rowMenu={(row) => menuProps(row, handlers)} />,
  );
  const trigger = screen.getByRole("button", { name: "More actions for Blog post" });
  return { ...view, handlers, trigger };
}

describe("LibraryTable row menu", () => {
  it("gives every row a named ⋯ trigger", () => {
    renderWithMenu();
    expect(screen.getAllByRole("button", { name: /^More actions for/ })).toHaveLength(RECORDS.length);
  });

  it("opens the row's own actions, with Open first and Delete last behind a separator", () => {
    const { trigger } = renderWithMenu();
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "Blog post actions" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent?.trim())).toEqual([
      "Open↵",
      "Duplicate",
      "Delete…",
    ]);
    const separator = menu.querySelector(".cms-menu__separator");
    expect(separator).not.toBeNull();
    expect(separator!.nextElementSibling).toHaveTextContent("Delete…");
    expect(separator!.nextElementSibling).toHaveClass("cms-menu__item--danger");
  });

  it("paints the menu in a body-level portal, outside the table's scroll wrapper", () => {
    const { container, trigger } = renderWithMenu();
    fireEvent.click(trigger);

    const menu = screen.getByRole("menu", { name: "Blog post actions" });
    const wrap = container.querySelector(".cms-table-wrap");
    expect(wrap).not.toBeNull();
    // The whole point of the portal: nothing between the menu and <body> can
    // clip it, so a row menu in a scrolled table is never cut off.
    expect(wrap!.contains(menu)).toBe(false);
    expect(menu.closest("table")).toBeNull();
    const host = menu.closest(".cms-overlay-portal");
    expect(host).not.toBeNull();
    expect(host!.parentElement).toBe(document.body);
  });

  it("opens from the keyboard onto the first item and runs it", () => {
    const { handlers, trigger } = renderWithMenu();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const menu = screen.getByRole("menu", { name: "Blog post actions" });
    const items = within(menu).getAllByRole("menuitem");
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[1]);
    expect(handlers.onDuplicate).toHaveBeenCalledOnce();
  });

  it("dismisses on Escape and hands focus back to the row's trigger", () => {
    const { trigger } = renderWithMenu();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menu", { name: "Blog post actions" }), { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("marks the trigger expanded, which is what keeps the hover-only cell visible while the menu is up", () => {
    const { trigger } = renderWithMenu();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.parentElement).toHaveClass("cms-table__actions");
  });

  it("leaves a row with no actions without a trigger", () => {
    render(
      <LibraryTable
        caption="Records"
        rows={RECORDS}
        contract={CONTRACT}
        rowMenu={(row) => (row.id === "blog-post" ? null : { label: row.name, open: { id: "open", label: "Open" } })}
      />,
    );
    expect(screen.queryByRole("button", { name: "More actions for Blog post" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^More actions for/ })).toHaveLength(RECORDS.length - 1);
  });
});
