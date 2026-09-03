import { Fragment, type ComponentChildren } from "preact";
import { cx } from "./class-names";
import { Checkbox } from "./form-controls";

export interface DataTableColumn<Row> {
  key: string;
  header: ComponentChildren;
  cell: (row: Row) => ComponentChildren;
  /** `name` carries the row emphasis, `num` right-aligns tabular figures. */
  variant?: "name" | "muted" | "num";
  width?: string;
}

export interface DataTableSelection<Row> {
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  /** Accessible name for a row's checkbox — the row's own name, not "Select". */
  rowLabel: (row: Row) => string;
  allLabel?: string;
}

export interface DataTableProps<Row> {
  /** Accessible name of the table, rendered as a visually hidden caption. */
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  selection?: DataTableSelection<Row>;
  /** Trailing actions cell, revealed on row hover or focus. */
  rowActions?: (row: Row) => ComponentChildren;
  /**
   * A full-width row rendered under its record, spanning every column — an
   * inline diagnostic or explanation that belongs to the row above it rather
   * than to one of its cells. Return null for rows that have nothing to add.
   */
  rowDetail?: (row: Row) => ComponentChildren;
  /** Bulk action bar, rendered above the table while rows are selected. */
  bulkBar?: ComponentChildren;
  density?: "default" | "compact";
  /** Rendered in place of the rows when there are none. */
  empty?: ComponentChildren;
  class?: string;
}

export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  selection,
  rowActions,
  rowDetail,
  bulkBar,
  density = "default",
  empty,
  class: className,
}: DataTableProps<Row>) {
  const selectedCount = selection ? rows.filter((row) => selection.selectedIds.has(rowKey(row))).length : 0;
  const allSelected = selection !== undefined && rows.length > 0 && selectedCount === rows.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const columnCount = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div class={cx("cms-table-frame", className)}>
      {bulkBar ? <div class="cms-table__bulk">{bulkBar}</div> : null}
      <div class="cms-table-wrap">
        <table class={cx("cms-table", density === "compact" && "cms-table--compact")}>
          <caption class="cms-sr-only">{caption}</caption>
          <thead>
            <tr>
              {selection ? (
                <th scope="col" class="cms-table__cb">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={(checked) => selection.onToggleAll(checked)}
                    aria-label={selection.allLabel ?? "Select all rows"}
                  />
                </th>
              ) : null}
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  class={cx(column.variant && `cms-table__cell--${column.variant}`)}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.header}
                </th>
              ))}
              {rowActions ? (
                <th scope="col" class="cms-table__actions">
                  <span class="cms-sr-only">Row actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr class="cms-table__empty-row">
                <td colSpan={columnCount}>{empty}</td>
              </tr>
            ) : (
              rows.map((row) => {
                const id = rowKey(row);
                const selected = selection?.selectedIds.has(id) ?? false;
                const detail = rowDetail?.(row);
                return (
                  <Fragment key={id}>
                    <tr aria-selected={selection ? selected : undefined}>
                      {selection ? (
                        <td class="cms-table__cb">
                          <Checkbox
                            checked={selected}
                            onCheckedChange={(checked) => selection.onToggleRow(id, checked)}
                            aria-label={selection.rowLabel(row)}
                          />
                        </td>
                      ) : null}
                      {columns.map((column) => (
                        <td key={column.key} class={cx(column.variant && `cms-table__cell--${column.variant}`)}>
                          {column.cell(row)}
                        </td>
                      ))}
                      {rowActions ? <td class="cms-table__actions">{rowActions(row)}</td> : null}
                    </tr>
                    {detail ? (
                      <tr class="cms-table__detail-row">
                        <td colSpan={columnCount}>{detail}</td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
