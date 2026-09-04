/**
 * The CMS library pattern (issue #164).
 *
 * One generic page over a ROW CONTRACT: `LibraryRowContract<Row>` is the only
 * thing the components know about a record, so Compositions, Mappings,
 * Sitemaps and Media share this pattern while keeping their own domain types.
 * Nothing here names a record type, and the bulk-bar and row-menu actions are
 * supplied by the route — Delete everywhere, Duplicate only where duplication
 * exists.
 *
 * The stylesheet is imported here rather than from `src/style.css` so the
 * pattern and its CSS ship as one unit, matching `src/components/ui`.
 */
import "./library-page.css";

export { LibraryPage } from "./library-page";
export type { LibraryPageProps } from "./library-page";

export {
  LibraryFacetMenu,
  LibrarySortMenu,
  LibraryToolbar,
  LibraryViewToggle,
} from "./library-toolbar";
export type {
  LibraryFacetMenuProps,
  LibrarySortMenuProps,
  LibraryToolbarProps,
  LibraryView,
  LibraryViewToggleProps,
} from "./library-toolbar";

export { LibraryTable } from "./library-table";
export type { LibraryTableProps } from "./library-table";

export { RowMenu } from "./row-menu";
export type { RowMenuAction, RowMenuProps } from "./row-menu";

export { BulkBar } from "./bulk-bar";
export type { BulkAction, BulkBarProps } from "./bulk-bar";

export {
  LibraryEmpty,
  LibraryNoMatch,
  LibraryRecoveryBanner,
  LibrarySkeleton,
  LibraryUnavailableBanner,
} from "./library-states";
export type {
  LibraryEmptyProps,
  LibraryNoMatchProps,
  LibraryRecoveryBannerProps,
  LibrarySkeletonProps,
  LibraryUnavailableBannerProps,
} from "./library-states";

export { LibraryPagination } from "./library-pagination";
export type { LibraryPaginationProps } from "./library-pagination";

export {
  applyLibraryQuery,
  defaultFacetValues,
  isLibraryQueryFiltered,
  matchesLibrarySearch,
  useLibraryQuery,
} from "./library-query";
export type {
  LibraryFacet,
  LibraryFacetOption,
  LibraryQueryController,
  LibraryQueryDefinition,
  LibraryQueryState,
  LibrarySort,
  UseLibraryQueryOptions,
} from "./library-query";

export { useLibrarySelection } from "./library-selection";
export type { LibrarySelectionController, UseLibrarySelectionOptions } from "./library-selection";

export { useLibraryConfirm } from "./use-library-confirm";
export type { LibraryConfirmController, LibraryConfirmRequest } from "./use-library-confirm";

export { formatLibraryTimestamp, formatLibraryTimestampFull, toLibraryDate } from "./library-format";
export type { LibraryTimestamp } from "./library-format";

export type { LibraryKindTag, LibraryRowContract } from "./row-contract";
