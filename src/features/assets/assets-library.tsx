import type { JSX } from "preact";
import { assetKindForMime, ASSET_KIND_LABELS, type AssetKindName, type AssetSummary } from "../../assets";
import { CopyIcon, MarkdownIcon, PreviewIcon, TrashIcon } from "../../components/icons";
import {
  LibraryNoMatch,
  LibraryPagination,
  LibrarySortMenu,
  LibraryTable,
  LibraryToolbar,
  LibraryViewToggle,
  RowMenu,
  type LibraryFacet,
  type LibraryQueryController,
  type LibraryRowContract,
  type LibrarySelectionController,
  type LibrarySort,
  type LibraryView,
  type RowMenuProps,
} from "../../components/library-page";
import { Button, Checkbox, SegmentedControl, type DataTableColumn } from "../../components/ui";
import { compareAssetSummariesNewestFirst } from "../../assets";
import type { AssetDimensionStore } from "./assets-dimensions";
import { formatBytes, assetCaption, assetTypeLabel } from "./assets-format";
import { AssetThumb } from "./assets-thumb";

export type AssetTypeFilter = "all" | AssetKindName;

export const ASSET_SORTS: readonly LibrarySort<AssetSummary>[] = [
  { id: "newest", label: "Newest", compare: compareAssetSummariesNewestFirst },
  { id: "oldest", label: "Oldest", compare: (a, b) => compareAssetSummariesNewestFirst(b, a) },
  { id: "name", label: "Name", compare: (a, b) => a.fileName.localeCompare(b.fileName) },
  { id: "size", label: "Size", compare: (a, b) => b.byteLength - a.byteLength },
];

/**
 * The type filter.
 *
 * It is a facet as far as `useLibraryQuery` is concerned — that is what makes
 * filtering and the no-match state work — but the toolbar renders facets as
 * menus, and the prototype's control is a `SegmentedControl` carrying counts.
 * The definition and the control therefore live together here.
 */
const ASSET_TYPE_FILTER_ID = "type";

export const ASSET_TYPE_FACET: LibraryFacet<AssetSummary> = {
  id: ASSET_TYPE_FILTER_ID,
  label: "Type",
  options: [
    { id: "all", label: "All" },
    ...Object.entries(ASSET_KIND_LABELS).map(([id, label]) => ({ id, label, match: (row: AssetSummary) => assetKindForMime(row.mimeType)?.kind === id })),
  ],
};

export interface AssetLibraryProps {
  /** Every asset in the library, for the filter counts and the pager total. */
  records: readonly AssetSummary[];
  query: LibraryQueryController<AssetSummary>;
  selection: LibrarySelectionController<AssetSummary>;
  dimensions: AssetDimensionStore;
  view: LibraryView;
  onViewChange(view: LibraryView): void;
  /** The asset the detail panel is showing. */
  activeId: string | null;
  onActivate(record: AssetSummary): void;
  onCopyUrl(record: AssetSummary): void;
  onCopyMarkdown(record: AssetSummary): void;
  onDelete(records: readonly AssetSummary[]): void;
  /** The bulk bar, supplied by the route so both views show the same one. */
  bulkBar?: JSX.Element | null;
  /** The compact drop strip and its queue, placed under the toolbar. */
  uploadPanel?: JSX.Element | null;
}

const CONTRACT: LibraryRowContract<AssetSummary> = {
  id: (row) => row.id,
  name: (row) => row.fileName,
  // No `kind` accessor: the asset type is a column of its own here rather than
  // a chip, because it is the value the type filter above is narrowing on.
  //
  // The built-in timestamp column reads `Added` because there is no way to
  // change an asset — the file provider has upload and delete, and `put()`
  // rejects — so `createdAt` is the only date an author can act on.
  updatedAt: (row) => row.createdAt,
};

export function AssetLibrary({
  records,
  query,
  selection,
  dimensions,
  view,
  onViewChange,
  activeId,
  onActivate,
  onCopyUrl,
  onCopyMarkdown,
  onDelete,
  bulkBar,
  uploadPanel,
}: AssetLibraryProps): JSX.Element {
  const facets = ASSET_TYPE_FACET.options.filter((option) => option.id === "all" || option.id === query.facetValue(ASSET_TYPE_FILTER_ID) || records.some((record) => option.match?.(record)));
  const filter = query.facetValue(ASSET_TYPE_FILTER_ID) as AssetTypeFilter;
  const totalBytes = records.reduce((sum, record) => sum + record.byteLength, 0);

  const columns: readonly DataTableColumn<AssetSummary>[] = [
    { key: "type", header: "Type", variant: "muted", cell: (row) => assetTypeLabel(row.mimeType) },
    { key: "size", header: "Size", variant: "num", cell: (row) => formatBytes(row.byteLength) },
  ];

  const rowMenu = (row: AssetSummary) => ({
    label: row.fileName,
    open: { id: "details", label: "Show details", icon: PreviewIcon, onSelect: () => onActivate(row) },
    actions: [
      { id: "copy-url", label: "Copy URL", icon: CopyIcon, onSelect: () => onCopyUrl(row) },
      { id: "copy-markdown", label: "Copy Markdown", icon: MarkdownIcon, onSelect: () => onCopyMarkdown(row) },
    ],
    destructive: [{ id: "delete", label: "Delete…", icon: TrashIcon, onSelect: () => onDelete([row]) }],
  });

  const noMatch = <LibraryNoMatch search={query.search} onClearFilters={query.clearFilters} />;

  return (
    <div class="sg-assets-browser">
      <LibraryToolbar
        // The toolbar renders one menu per facet, and this route's single facet
        // is the prototype's `SegmentedControl` instead. Handing it a
        // facet-free and sort-free view of the controller keeps the generated
        // search input while the two choice controls are placed by hand, in the
        // prototype's order.
        query={{ ...query, facets: [], sorts: [] }}
        searchLabel="Filter assets"
        searchPlaceholder="Filter by file name or ID"
        end={<LibraryViewToggle value={view} onChange={onViewChange} tableLabel="List view" cardsLabel="Grid view" />}
      >
        <SegmentedControl<AssetTypeFilter>
          label="Type"
          size="sm"
          value={filter}
          onChange={(next) => query.setFacetValue(ASSET_TYPE_FILTER_ID, next)}
          options={facets.map((option) => ({ value: option.id as AssetTypeFilter, label: <TypeSegment label={option.label} count={option.match ? records.filter(option.match).length : records.length} /> }))}
        />
        <LibrarySortMenu sorts={ASSET_SORTS} value={query.sortId} onChange={query.setSortId} />
      </LibraryToolbar>

      {uploadPanel}

      {view === "cards" ? (
        <>
          {bulkBar ? <div class="cms-table__bulk">{bulkBar}</div> : null}
          {query.rows.length === 0 ? noMatch : (
            <ul class="sg-assets-grid" aria-label="Assets">
              {query.rows.map((row) => (
                <AssetTile
                  key={row.id}
                  record={row}
                  dimensions={dimensions}
                  active={row.id === activeId}
                  selected={selection.isSelected(row.id)}
                  onToggleSelected={(selected) => selection.toggleRow(row.id, selected)}
                  onActivate={() => onActivate(row)}
                  onCopyUrl={() => onCopyUrl(row)}
                  rowMenu={rowMenu(row)}
                />
              ))}
            </ul>
          )}
        </>
      ) : (
        <LibraryTable
          caption="Assets"
          rows={query.rows}
          contract={CONTRACT}
          columns={columns}
          selection={selection}
          updatedHeader="Added"
          bulkBar={bulkBar ?? undefined}
          empty={noMatch}
          rowMenu={rowMenu}
        />
      )}

      <LibraryPagination
        summary={`${query.rows.length} of ${records.length} assets · ${formatBytes(totalBytes)} · /uploaded-assets/`}
      />
    </div>
  );
}

function TypeSegment({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <>
      {label}
      <span class="sg-assets-seg__count">{count}</span>
    </>
  );
}

interface AssetTileProps {
  record: AssetSummary;
  dimensions: AssetDimensionStore;
  active: boolean;
  selected: boolean;
  onToggleSelected(selected: boolean): void;
  onActivate(): void;
  onCopyUrl(): void;
  rowMenu: RowMenuProps;
}

function AssetTile({ record, dimensions, active, selected, onToggleSelected, onActivate, onCopyUrl, rowMenu }: AssetTileProps): JSX.Element {
  return (
    <li class={`sg-assets-asset${active ? " sg-assets-asset--active" : ""}${selected ? " sg-assets-asset--selected" : ""}`}>
      <div class="sg-assets-asset__thumb">
        <button
          type="button"
          class="sg-assets-asset__open"
          // The tile is the route's way into the detail panel, and the panel
          // shows exactly one asset — `aria-current` says which, where
          // `aria-pressed` would promise a toggle that clicking again does not
          // perform.
          aria-current={active ? "true" : undefined}
          aria-label={`Show details for ${record.fileName}`}
          onClick={onActivate}
        >
          <AssetThumb record={record} dimensions={dimensions} />
        </button>
        <span class="sg-assets-asset__check">
          <Checkbox checked={selected} onCheckedChange={onToggleSelected} aria-label={record.fileName} />
        </span>
        <span class="sg-assets-asset__acts">
          <Button size="sm" iconOnly aria-label={`Copy URL for ${record.fileName}`} onClick={onCopyUrl}>
            <CopyIcon size="sm" />
          </Button>
          <RowMenu {...rowMenu} />
        </span>
      </div>
      <div class="sg-assets-asset__caption">
        <span class="sg-assets-asset__name" title={record.fileName}>{record.fileName}</span>
        <span class="sg-assets-asset__meta">{assetCaption(record, dimensions.get(record.id))}</span>
      </div>
    </li>
  );
}
