import type { JSX } from "preact";
import type { MediaSummary } from "../../media";
import { CopyIcon, FileIcon, MarkdownIcon, PreviewIcon, TrashIcon } from "../../components/icons";
import {
  LibraryNoMatch,
  LibraryPagination,
  LibrarySortMenu,
  LibraryTable,
  LibraryToolbar,
  LibraryViewToggle,
  RowMenu,
  type LibraryQueryController,
  type LibraryRowContract,
  type LibrarySelectionController,
  type LibrarySort,
  type LibraryView,
  type RowMenuProps,
} from "../../components/library-page";
import { Button, Checkbox, SegmentedControl, type DataTableColumn } from "../../components/ui";
import { compareMediaSummariesNewestFirst } from "../../media";
import { mediaUrl } from "./controller";
import type { MediaDimensionStore } from "./media-dimensions";
import { formatBytes, isMediaImage, mediaCaption, mediaTypeLabel } from "./media-format";

export type MediaTypeFilter = "all" | "images" | "pdfs";

export const MEDIA_SORTS: readonly LibrarySort<MediaSummary>[] = [
  { id: "newest", label: "Newest", compare: compareMediaSummariesNewestFirst },
  { id: "oldest", label: "Oldest", compare: (a, b) => compareMediaSummariesNewestFirst(b, a) },
  { id: "name", label: "Name", compare: (a, b) => a.fileName.localeCompare(b.fileName) },
  { id: "size", label: "Size", compare: (a, b) => b.byteLength - a.byteLength },
];

/** The filter is a `SegmentedControl` with counts, so it lives outside the toolbar's facet menus. */
export const MEDIA_TYPE_FILTER_ID = "type";

export function mediaMatchesTypeFilter(record: MediaSummary, filter: MediaTypeFilter): boolean {
  if (filter === "images") return isMediaImage(record);
  if (filter === "pdfs") return !isMediaImage(record);
  return true;
}

export interface MediaLibraryProps {
  /** Every asset in the library, for the filter counts and the pager total. */
  records: readonly MediaSummary[];
  query: LibraryQueryController<MediaSummary>;
  selection: LibrarySelectionController<MediaSummary>;
  dimensions: MediaDimensionStore;
  view: LibraryView;
  onViewChange(view: LibraryView): void;
  /** The asset the detail panel is showing. */
  activeId: string | null;
  onActivate(record: MediaSummary): void;
  onCopyUrl(record: MediaSummary): void;
  onCopyMarkdown(record: MediaSummary): void;
  onDelete(records: readonly MediaSummary[]): void;
  /** The bulk bar, supplied by the route so both views show the same one. */
  bulkBar?: JSX.Element | null;
  /** The compact drop strip and its queue, placed under the toolbar. */
  uploadPanel?: JSX.Element | null;
}

const CONTRACT: LibraryRowContract<MediaSummary> = {
  id: (row) => row.id,
  name: (row) => row.fileName,
  // No `kind` accessor: the media type is a column of its own here rather than
  // a chip, because it is the value the type filter above is narrowing on.
  //
  // The built-in timestamp column reads `Added` because there is no way to
  // change an asset — the file provider has upload and delete, and `put()`
  // rejects — so `createdAt` is the only date an author can act on.
  updatedAt: (row) => row.createdAt,
};

export function MediaLibrary({
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
}: MediaLibraryProps): JSX.Element {
  const imageCount = records.filter(isMediaImage).length;
  const filter = query.facetValue(MEDIA_TYPE_FILTER_ID) as MediaTypeFilter;
  const totalBytes = records.reduce((sum, record) => sum + record.byteLength, 0);

  const columns: readonly DataTableColumn<MediaSummary>[] = [
    { key: "type", header: "Type", variant: "muted", cell: (row) => mediaTypeLabel(row.mediaType) },
    { key: "size", header: "Size", variant: "num", cell: (row) => formatBytes(row.byteLength) },
  ];

  const rowMenu = (row: MediaSummary) => ({
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
    <div class="sg-media-browser">
      <LibraryToolbar
        // The toolbar renders one menu per facet, and this route's single facet
        // is the prototype's `SegmentedControl` instead. Handing it a
        // facet-free and sort-free view of the controller keeps the generated
        // search input while the two choice controls are placed by hand, in the
        // prototype's order.
        query={{ ...query, facets: [], sorts: [] }}
        searchLabel="Filter media"
        searchPlaceholder="Filter by file name or ID"
        end={<LibraryViewToggle value={view} onChange={onViewChange} tableLabel="List view" cardsLabel="Grid view" />}
      >
        <SegmentedControl<MediaTypeFilter>
          label="Type"
          size="sm"
          value={filter}
          onChange={(next) => query.setFacetValue(MEDIA_TYPE_FILTER_ID, next)}
          options={[
            { value: "all", label: <TypeSegment label="All" count={records.length} /> },
            { value: "images", label: <TypeSegment label="Images" count={imageCount} /> },
            { value: "pdfs", label: <TypeSegment label="PDFs" count={records.length - imageCount} /> },
          ]}
        />
        <LibrarySortMenu sorts={MEDIA_SORTS} value={query.sortId} onChange={query.setSortId} />
      </LibraryToolbar>

      {uploadPanel}

      {view === "cards" ? (
        <>
          {bulkBar ? <div class="cms-table__bulk">{bulkBar}</div> : null}
          {query.rows.length === 0 ? noMatch : (
            <ul class="sg-media-grid" aria-label="Media assets">
              {query.rows.map((row) => (
                <MediaTile
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
          caption="Media assets"
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
        summary={`${query.rows.length} of ${records.length} assets · ${formatBytes(totalBytes)} · /uploaded-media/`}
      />
    </div>
  );
}

function TypeSegment({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <>
      {label}
      <span class="sg-media-seg__count">{count}</span>
    </>
  );
}

interface MediaTileProps {
  record: MediaSummary;
  dimensions: MediaDimensionStore;
  active: boolean;
  selected: boolean;
  onToggleSelected(selected: boolean): void;
  onActivate(): void;
  onCopyUrl(): void;
  rowMenu: RowMenuProps;
}

function MediaTile({ record, dimensions, active, selected, onToggleSelected, onActivate, onCopyUrl, rowMenu }: MediaTileProps): JSX.Element {
  return (
    <li class={`sg-media-asset${active ? " sg-media-asset--active" : ""}${selected ? " sg-media-asset--selected" : ""}`}>
      <div class="sg-media-asset__thumb">
        <button
          type="button"
          class="sg-media-asset__open"
          // The tile is the route's way into the detail panel, and the panel
          // shows exactly one asset — `aria-current` says which, where
          // `aria-pressed` would promise a toggle that clicking again does not
          // perform.
          aria-current={active ? "true" : undefined}
          aria-label={`Show details for ${record.fileName}`}
          onClick={onActivate}
        >
          <MediaThumb record={record} dimensions={dimensions} />
        </button>
        <span class="sg-media-asset__check">
          <Checkbox checked={selected} onCheckedChange={onToggleSelected} aria-label={record.fileName} />
        </span>
        <span class="sg-media-asset__acts">
          <Button size="sm" iconOnly aria-label={`Copy URL for ${record.fileName}`} onClick={onCopyUrl}>
            <CopyIcon size="sm" />
          </Button>
          <RowMenu {...rowMenu} />
        </span>
      </div>
      <div class="sg-media-asset__caption">
        <span class="sg-media-asset__name" title={record.fileName}>{record.fileName}</span>
        <span class="sg-media-asset__meta">{mediaCaption(record, dimensions.get(record.id))}</span>
      </div>
    </li>
  );
}

export interface MediaThumbProps {
  record: MediaSummary;
  dimensions: MediaDimensionStore;
  /** The larger preview in the detail panel. */
  detail?: boolean;
}

/**
 * The asset itself for an image, a page-shaped tile for a PDF. The image is the
 * public URL the rest of the app references, so a thumbnail that renders is
 * also proof the delivered bytes decode.
 */
export function MediaThumb({ record, dimensions, detail = false }: MediaThumbProps): JSX.Element {
  if (!isMediaImage(record)) {
    return (
      <span class={`sg-media-pdf${detail ? " sg-media-pdf--detail" : ""}`} aria-hidden="true">
        <FileIcon size={detail ? "lg" : "md"} />
        <span class="sg-media-pdf__label">PDF</span>
      </span>
    );
  }
  return (
    <img
      class="sg-media-image"
      src={mediaUrl(record)}
      alt=""
      loading={detail ? undefined : "lazy"}
      decoding="async"
      // A cached image can already be decoded before `load` would fire, so the
      // ref reports too; both paths are idempotent in the store.
      ref={(element) => dimensions.record(record.id, element)}
      onLoad={(event) => dimensions.record(record.id, event.currentTarget)}
    />
  );
}
