import { computed, type Child } from "@takazudo/zfb/zudo-react";
import { ChevronLeftIcon, ChevronRightIcon } from "../icons";
import { read, type MaybeSignal } from "../reactive";
import { liveSlot, type LiveChild } from "../rebuild";
import { Button, cx } from "../ui";

// The line under the table (issue #164): what is on screen and where it came
// from — "6 compositions · Browser storage". The page controls appear only
// when a route actually pages; a library that fits on one screen gets the
// summary and no dead buttons.

export interface LibraryPaginationProps {
  /** The left-hand line: counts, and the provider the records came from. */
  summary: LiveChild;
  /** 1-based. */
  page?: MaybeSignal<number>;
  pageCount?: MaybeSignal<number>;
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
}: LibraryPaginationProps): Child {
  return (
    <div class={cx("cms-library-pager", className)}>
      <span class="cms-library-pager__summary">{liveSlot(summary)}</span>
      {onPageChange ? (
        <div class="cms-library-pager__nav">
          <span class="cms-library-pager__position">{computed(() => `Page ${read(page)} of ${read(pageCount)}`)}</span>
          <Button size="sm" iconOnly aria-label={previousLabel} disabled={computed(() => read(page) <= 1)} on:click={() => onPageChange(read(page) - 1)}>
            <ChevronLeftIcon size="sm" />
          </Button>
          <Button size="sm" iconOnly aria-label={nextLabel} disabled={computed(() => read(page) >= read(pageCount))} on:click={() => onPageChange(read(page) + 1)}>
            <ChevronRightIcon size="sm" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
