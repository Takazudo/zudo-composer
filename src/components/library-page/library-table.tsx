import type { ComponentChildren } from "preact";
import { Chip, DataTable, type DataTableColumn } from "../ui";
import { formatLibraryTimestamp, formatLibraryTimestampFull, toLibraryDate } from "./library-format";
import type { LibrarySelectionController } from "./library-selection";
import type { LibraryRowContract } from "./row-contract";
import { RowMenu, type RowMenuProps } from "./row-menu";

// The library table (issue #164): the shared `DataTable` with the name, kind
// and updated columns the pattern always has, and the route's own columns in
// between. Everything it knows about a record comes through
// `LibraryRowContract`, so Compositions, Mappings, Sitemaps and Media share
// one table without the component naming any of them.

/** An absent value reads as an em dash, and stays out of the accessible name. */
function BlankCell() {
  return (
    <span class="cms-library-blank" aria-hidden="true">
      —
    </span>
  );
}

export interface LibraryTableProps<Row> {
  /** Accessible name of the table. */
  caption: string;
  rows: readonly Row[];
  contract: LibraryRowContract<Row>;
  /** Route columns, rendered between the kind chip and the updated column. */
  columns?: readonly DataTableColumn<Row>[];
  selection?: LibrarySelectionController<Row>;
  /** The trailing `⋯` menu. Return null for a row that has no actions. */
  rowMenu?: (row: Row) => RowMenuProps | null;
  /** Rendered above the table while rows are selected — a `BulkBar`, typically. */
  bulkBar?: ComponentChildren;
  /** Replaces the rows when there are none: the empty or no-match state. */
  empty?: ComponentChildren;
  density?: "default" | "compact";
  nameHeader?: ComponentChildren;
  kindHeader?: ComponentChildren;
  updatedHeader?: ComponentChildren;
  class?: string;
}

export function LibraryTable<Row>({
  caption,
  rows,
  contract,
  columns = [],
  selection,
  rowMenu,
  bulkBar,
  empty,
  density,
  nameHeader = "Name",
  kindHeader = "Kind",
  updatedHeader = "Updated",
  class: className,
}: LibraryTableProps<Row>) {
  const nameColumn: DataTableColumn<Row> = {
    key: "name",
    header: nameHeader,
    variant: "name",
    cell: (row) => {
      const Icon = contract.icon?.(row);
      const name = contract.name(row);
      const subline = contract.subline ? contract.subline(row) : contract.id(row);
      const href = contract.href?.(row);
      return (
        <div class="cms-library-name">
          {Icon ? <Icon size="sm" class="cms-library-name__icon" /> : null}
          <span class="cms-library-name__text">
            {href ? (
              <a class="cms-library-name__label" href={href}>
                {name}
              </a>
            ) : (
              <span class="cms-library-name__label">{name}</span>
            )}
            {subline ? <span class="cms-library-name__sub">{subline}</span> : null}
          </span>
        </div>
      );
    },
  };

  const kindColumn: DataTableColumn<Row> | null = contract.kind
    ? {
        key: "kind",
        header: kindHeader,
        cell: (row) => {
          const tag = contract.kind?.(row);
          return tag ? <Chip tone={tag.tone}>{tag.label}</Chip> : <BlankCell />;
        },
      }
    : null;

  const updatedColumn: DataTableColumn<Row> | null = contract.updatedAt
    ? {
        key: "updated",
        header: updatedHeader,
        variant: "muted",
        cell: (row) => {
          const date = toLibraryDate(contract.updatedAt?.(row));
          if (!date) return <BlankCell />;
          return (
            <time dateTime={date.toISOString()} title={formatLibraryTimestampFull(date)}>
              {formatLibraryTimestamp(date)}
            </time>
          );
        },
      }
    : null;

  const allColumns = [nameColumn, ...(kindColumn ? [kindColumn] : []), ...columns, ...(updatedColumn ? [updatedColumn] : [])];

  return (
    <DataTable
      class={className}
      caption={caption}
      columns={allColumns}
      rows={rows}
      rowKey={contract.id}
      density={density}
      bulkBar={bulkBar}
      empty={empty}
      selection={
        selection
          ? {
              selectedIds: selection.selectedIds,
              onToggleRow: selection.toggleRow,
              onToggleAll: selection.toggleAll,
              rowLabel: contract.name,
            }
          : undefined
      }
      rowActions={
        rowMenu
          ? (row) => {
              const props = rowMenu(row);
              return props ? <RowMenu {...props} /> : null;
            }
          : undefined
      }
    />
  );
}
