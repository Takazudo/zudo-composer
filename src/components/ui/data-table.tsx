import { computed, getScope, signal, type Child, type Ref } from "@takazudo/zfb/zudo-react";
import { toSignal, type MaybeSignal } from "../reactive";
import { liveSlot, Rebuild, type LiveChild } from "../rebuild";
import { cx } from "./class-names";
import { Checkbox } from "./form-controls";

type ScrollEdge = "none" | "start" | "end" | "both";

const SCROLL_EDGE_TOLERANCE = 1;

export interface DataTableColumn<Row> {
  key: string;
  header: Child;
  cell: (row: Row) => Child;
  /** `name` carries the row emphasis, `num` right-aligns tabular figures. */
  variant?: "name" | "muted" | "num";
  width?: string;
}

export interface DataTableSelection<Row> {
  selectedIds: MaybeSignal<ReadonlySet<string>>;
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
  /** A signal rebuilds the table body when the list changes; selection stays live per cell. */
  rows: MaybeSignal<readonly Row[]>;
  rowKey: (row: Row) => string;
  selection?: DataTableSelection<Row>;
  /** Trailing actions cell, revealed on row hover or focus. */
  rowActions?: (row: Row) => Child;
  /**
   * A full-width row rendered under its record, spanning every column — an
   * inline diagnostic or explanation that belongs to the row above it rather
   * than to one of its cells. Return null for rows that have nothing to add.
   */
  rowDetail?: (row: Row) => Child;
  /** Bulk action bar, rendered above the table while it has content. */
  bulkBar?: LiveChild;
  density?: "default" | "compact";
  /** Rendered in place of the rows when there are none. */
  empty?: Child;
  class?: string;
}

function hasDetail(detail: Child): boolean {
  return detail !== undefined && detail !== null && detail !== false && detail !== "";
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
  const rowList = toSignal(rows);
  const columnCount = columns.length + (selection ? 1 : 0) + (rowActions ? 1 : 0);
  const scrollRef: Ref<HTMLDivElement> = { current: null };
  const scrollEdge = signal<ScrollEdge>("none");
  const scope = getScope();
  let observer: ResizeObserver | null = null;

  const measure = (): void => {
    const scrollport = scrollRef.current;
    if (!scrollport) return;
    const maxScrollLeft = Math.max(0, scrollport.scrollWidth - scrollport.clientWidth);
    if (maxScrollLeft <= SCROLL_EDGE_TOLERANCE) {
      scrollEdge.value = "none";
      return;
    }
    const scrollLeft = Math.min(maxScrollLeft, Math.max(0, scrollport.scrollLeft));
    const hasStart = scrollLeft > SCROLL_EDGE_TOLERANCE;
    const hasEnd = maxScrollLeft - scrollLeft > SCROLL_EDGE_TOLERANCE;
    scrollEdge.value = hasStart ? (hasEnd ? "both" : "start") : "end";
  };

  // The rebuilt table activates before this frame does (children first), so
  // whichever side activates second starts observing the table.
  let table: HTMLTableElement | null = null;
  scope.onActivate(() => {
    const scrollport = scrollRef.current;
    if (!scrollport) return undefined;
    measure();
    scrollport.addEventListener("scroll", measure, { passive: true });
    observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(scrollport);
    if (table) observer?.observe(table);
    return () => {
      scrollport.removeEventListener("scroll", measure);
      observer?.disconnect();
      observer = null;
    };
  });

  const selectedIds = selection ? toSignal(selection.selectedIds) : null;
  const selectedCount = computed(() => {
    if (!selectedIds) return 0;
    const ids = selectedIds.value;
    return rowList.value.filter((row) => ids.has(rowKey(row))).length;
  });
  const allSelected = computed(() => selection !== undefined && rowList.value.length > 0 && selectedCount.value === rowList.value.length);
  const someSelected = computed(() => selectedCount.value > 0 && !allSelected.value);

  // `For`/`Show` cannot sit inside a table, so the table is rebuilt as a whole
  // when the row list changes; selection state stays live in each cell.
  function Table(props: { rows: readonly Row[] }) {
    const tableRef: Ref<HTMLTableElement> = { current: null };
    getScope().onActivate(() => {
      const element = tableRef.current;
      table = element;
      if (element) observer?.observe(element);
      measure();
      return () => {
        if (element) observer?.unobserve(element);
        if (table === element) table = null;
      };
    });
    return (
      <table ref={tableRef} class={cx("cms-table", density === "compact" && "cms-table--compact")}>
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
          {props.rows.length === 0 ? (
            <tr class="cms-table__empty-row">
              <td colspan={columnCount}>{empty}</td>
            </tr>
          ) : (
            props.rows.map((row) => {
              const id = rowKey(row);
              const selected = computed(() => selectedIds?.value.has(id) ?? false);
              const detail = rowDetail?.(row);
              return [
                <tr key={id} aria-selected={selection ? selected : undefined}>
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
                </tr>,
                hasDetail(detail) ? (
                  <tr key={`${id}:detail`} class="cms-table__detail-row">
                    <td colspan={columnCount}>{detail}</td>
                  </tr>
                ) : null,
              ];
            })
          )}
        </tbody>
      </table>
    );
  }

  return (
    <div class={cx("cms-table-frame", className)}>
      {liveSlot(bulkBar, (bar) => <div class="cms-table__bulk">{bar}</div>)}
      <div class="cms-table-scroll-shell" data-scroll-edge={scrollEdge}>
        <div ref={scrollRef} class="cms-table-wrap">
          <Rebuild value={rowList}>{(list) => <Table rows={list} />}</Rebuild>
        </div>
      </div>
    </div>
  );
}
