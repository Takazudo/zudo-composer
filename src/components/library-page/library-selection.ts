import { computed, getScope, signal, type ReadonlySignal } from "@takazudo/zfb/zudo-react";
import { read, type MaybeSignal } from "../reactive";

// Row selection behind the bulk bar (issue #164).
//
// Two rules the routes depend on:
//   1. A selection survives filtering. Typing in the filter input must not
//      silently drop the rows an author already picked, so the controller is
//      given EVERY record and prunes only against that set.
//   2. A selection does not survive deletion. Pruning is derived on read, so
//      the frame after a delete can never show a bulk bar counting records
//      that are gone, and the stored set is swept afterwards so a deleted id
//      cannot come back to life on a later record.

export interface LibrarySelectionController<Row> {
  readonly selectedIds: ReadonlySignal<ReadonlySet<string>>;
  /** The selected records, in the source list's order. */
  readonly selectedRows: ReadonlySignal<readonly Row[]>;
  readonly selectedCount: ReadonlySignal<number>;
  /** Tracked when read in a computed. */
  isSelected: (id: string) => boolean;
  toggleRow: (id: string, selected: boolean) => void;
  /** Covers exactly the visible rows — a filtered "select all" is not "select everything". */
  toggleAll: (selected: boolean) => void;
  clear: () => void;
}

export interface LibrarySelectionOptions<Row> {
  /** Every record in the library. */
  readonly rows: MaybeSignal<readonly Row[]>;
  /** The rows currently on screen. Defaults to `rows`. */
  readonly visibleRows?: MaybeSignal<readonly Row[]>;
  readonly rowId: (row: Row) => string;
}

/** Call during component setup: the sweep below runs in the caller's scope. */
export function createLibrarySelection<Row>({
  rows,
  visibleRows = rows,
  rowId,
}: LibrarySelectionOptions<Row>): LibrarySelectionController<Row> {
  const picked = signal<ReadonlySet<string>>(new Set());

  const selectedRows = computed(() => {
    const ids = picked.value;
    return read(rows).filter((row) => ids.has(rowId(row)));
  });
  const selectedIds = computed<ReadonlySet<string>>(() => new Set(selectedRows.value.map(rowId)));

  // The read above keeps a deleted record out of the bulk bar, but the id it
  // left behind in the stored set would silently select a FUTURE record that
  // reuses it — a route slugging ids from names hands out `untitled-record`
  // again as soon as the first one is deleted. Sweeping it here, after the
  // flush that already showed the truth, fixes that without a stale frame.
  getScope().effect(() => {
    const known = new Set(read(rows).map(rowId));
    const current = picked.value;
    const kept = [...current].filter((id) => known.has(id));
    if (kept.length !== current.size) picked.value = new Set(kept);
  });

  return {
    selectedIds,
    selectedRows,
    selectedCount: computed(() => selectedRows.value.length),
    isSelected: (id) => selectedIds.value.has(id),
    toggleRow: (id, selected) => {
      const current = picked.value;
      if (current.has(id) === selected) return;
      const next = new Set(current);
      if (selected) next.add(id);
      else next.delete(id);
      picked.value = next;
    },
    toggleAll: (selected) => {
      const next = new Set(picked.value);
      for (const id of read(visibleRows).map(rowId)) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      picked.value = next;
    },
    clear: () => {
      if (picked.value.size !== 0) picked.value = new Set();
    },
  };
}
