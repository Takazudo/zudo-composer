import type { ComponentChildren } from "preact";
import { SearchIcon, type IconComponent } from "../icons";
import { Banner, Button, EmptyState, cx } from "../ui";

// The states a library route moves through (issue #164): loading, empty,
// no-match, a recoverable store, and an unavailable one. They are separate
// components rather than one `state` prop because each carries a different
// promise to the author — "wait", "start here", "you filtered it away",
// "some records need a decision", "nothing can be read".

export interface LibrarySkeletonProps {
  /** Placeholder rows; roughly a screenful, not the real count. */
  rows?: number;
  /** Bars per row — match the route's column count so the shape does not jump. */
  columns?: number;
  label?: string;
  class?: string;
}

export function LibrarySkeleton({ rows = 5, columns = 4, label = "Loading records…", class: className }: LibrarySkeletonProps) {
  return (
    <div class={cx("cms-library-skeleton", className)} role="status" aria-busy="true">
      <span class="cms-sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} class="cms-library-skeleton__row" aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => (
            <span key={column} class="cms-library-skeleton__bar" />
          ))}
        </div>
      ))}
    </div>
  );
}

export interface LibraryEmptyProps {
  icon?: IconComponent;
  title: ComponentChildren;
  /** One line saying what the library holds once it has records. */
  description?: ComponentChildren;
  /** The primary action — the same one the page header offers. */
  action?: ComponentChildren;
  class?: string;
}

export function LibraryEmpty({ icon, title, description, action, class: className }: LibraryEmptyProps) {
  return (
    <div class={cx("cms-library-state", className)}>
      <EmptyState icon={icon} title={title} description={description} action={action} />
    </div>
  );
}

export interface LibraryNoMatchProps {
  /** The active filter text, quoted in the default title. */
  search?: string;
  title?: ComponentChildren;
  description?: ComponentChildren;
  onClearFilters: () => void;
  clearLabel?: string;
  class?: string;
}

export function LibraryNoMatch({
  search,
  title,
  description = "Try a different name or ID, or clear the filters.",
  onClearFilters,
  clearLabel = "Clear filters",
  class: className,
}: LibraryNoMatchProps) {
  const query = search?.trim() ?? "";
  return (
    <div class={cx("cms-library-state", "cms-library-state--inline", className)}>
      <EmptyState
        inline
        icon={SearchIcon}
        title={title ?? (query ? `No matches for “${query}”` : "No matching records")}
        description={description}
        action={
          <Button size="sm" onClick={onClearFilters}>
            {clearLabel}
          </Button>
        }
      />
    </div>
  );
}

export interface LibraryRecoveryBannerProps {
  title: ComponentChildren;
  /** What Retry keeps and what Start fresh discards. */
  description?: ComponentChildren;
  onRetry: () => void;
  /** Destructive, so it always ends in an ellipsis and opens a `ConfirmDialog`. */
  onStartFresh: () => void;
  retryLabel?: string;
  startFreshLabel?: string;
  class?: string;
}

export function LibraryRecoveryBanner({
  title,
  description,
  onRetry,
  onStartFresh,
  retryLabel = "Retry",
  startFreshLabel = "Start fresh…",
  class: className,
}: LibraryRecoveryBannerProps) {
  return (
    <Banner
      tone="warn"
      title={title}
      class={className}
      action={
        <>
          <Button size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
          <Button size="sm" variant="danger" onClick={onStartFresh}>
            {startFreshLabel}
          </Button>
        </>
      }
    >
      {description}
    </Banner>
  );
}

export interface LibraryUnavailableBannerProps {
  title: ComponentChildren;
  /** Why the store could not be read. */
  description?: ComponentChildren;
  onRetry: () => void;
  retryLabel?: string;
  class?: string;
}

export function LibraryUnavailableBanner({
  title,
  description,
  onRetry,
  retryLabel = "Retry",
  class: className,
}: LibraryUnavailableBannerProps) {
  return (
    <Banner
      tone="err"
      title={title}
      class={className}
      action={
        <Button size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      }
    >
      {description}
    </Banner>
  );
}
