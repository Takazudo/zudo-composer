import type { ComponentChildren } from "preact";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { Button, cx } from "../ui";

// The line under the table (issue #164): what is on screen and where it came
// from — "6 compositions · Browser storage". The page controls appear only
// when a route actually pages; a library that fits on one screen gets the
// summary and no dead buttons.

export interface LibraryPaginationProps {
  /** The left-hand line: counts, and the provider the records came from. */
  summary: ComponentChildren;
  /** 1-based. */
  page?: number;
  pageCount?: number;
  onPageChange?: (page: number) => void;
  previousLabel?: string;
  nextLabel?: string;
  class?: string;
}

export function LibraryPagination({
  summary,
  page = 1,
  pageCount = 1,
  onPageChange,
  previousLabel = "Previous page",
  nextLabel = "Next page",
  class: className,
}: LibraryPaginationProps) {
  return (
    <div class={cx("cms-library-pager", className)}>
      <span class="cms-library-pager__summary">{summary}</span>
      {onPageChange ? (
        <div class="cms-library-pager__nav">
          <span class="cms-library-pager__position">{`Page ${page} of ${pageCount}`}</span>
          <Button size="sm" iconOnly aria-label={previousLabel} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeftIcon size="sm" />
          </Button>
          <Button size="sm" iconOnly aria-label={nextLabel} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            <ChevronRightIcon size="sm" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
