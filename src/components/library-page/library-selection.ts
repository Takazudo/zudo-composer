import { useEffect, useState } from "preact/hooks";

// Row selection behind the bulk bar (issue #164).
//
// Two rules the routes depend on:
//   1. A selection survives filtering. Typing in the filter input must not
//      silently drop the rows an author already picked, so the hook is given
//      EVERY record and prunes only against that set.
//   2. A selection does not survive deletion. Pruning is derived on read, so
//      the frame after a delete can never show a bulk bar counting records
//      that are gone, and the stored set is swept afterwards so a deleted id
//      cannot come back to life on a later record.

export interface LibrarySelectionController<Row> {
  readonly selectedIds: ReadonlySet<string>;
  /** The selected records, in the source list's order. */
  readonly selectedRows: readonly Row[];
  readonly selectedCount: number;
  isSelected: (id: string) => boolean;
  toggleRow: (id: string, selected: boolean) => void;
  /** Covers exactly the visible rows — a filtered "select all" is not "select everything". */
  toggleAll: (selected: boolean) => void;
  clear: () => void;
}

export interface UseLibrarySelectionOptions<Row> {
  /** Every record in the library. */
  readonly rows: readonly Row[];
  /** The rows currently on screen. Defaults to `rows`. */
  readonly visibleRows?: readonly Row[];
  readonly rowId: (row: Row) => string;
}

export function useLibrarySelection<Row>({
  rows,
  visibleRows = rows,
  rowId,
}: UseLibrarySelectionOptions<Row>): LibrarySelectionController<Row> {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  const selectedRows = rows.filter((row) => picked.has(rowId(row)));
  const selectedIds: ReadonlySet<string> = new Set(selectedRows.map(rowId));

  // The read above keeps a deleted record out of the bulk bar, but the id it
  // left behind in the stored set would silently select a FUTURE record that
  // reuses it — a route slugging ids from names hands out `untitled-record`
  // again as soon as the first one is deleted. Sweeping it here, after the
  // render that already read the truth, fixes that without a stale frame.
  useEffect(() => {
    setPicked((current) => {
      const known = new Set(rows.map(rowId));
      const kept = [...current].filter((id) => known.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
    // `rowId` is deliberately not a dependency: routes pass it inline, and the
    // sweep only has anything to do when the record list itself changes.
  }, [rows]);

  return {
    selectedIds,
    selectedRows,
    selectedCount: selectedRows.length,
    isSelected: (id) => selectedIds.has(id),
    toggleRow: (id, selected) =>
      setPicked((current) => {
        if (current.has(id) === selected) return current;
        const next = new Set(current);
        if (selected) next.add(id);
        else next.delete(id);
        return next;
      }),
    toggleAll: (selected) => {
      const ids = visibleRows.map(rowId);
      setPicked((current) => {
        const next = new Set(current);
        for (const id of ids) {
          if (selected) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    clear: () => setPicked((current) => (current.size === 0 ? current : new Set())),
  };
}
