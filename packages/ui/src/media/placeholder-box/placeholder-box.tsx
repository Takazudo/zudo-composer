import type { JSX } from "preact";
import { cx } from "../../lib/cx";

export type PlaceholderBoxSize = "sm" | "md" | "lg";

export type PlaceholderBoxProps = {
  /** Explicit label. Falls back to `alt`, then `src`, then "image". */
  label?: string;
  /** Alt text, as passed by an MDX `img` override. Also used as a label fallback. */
  alt?: string;
  /** Original image path, as passed by an MDX `img` override. Used only as a label fallback — never rendered. */
  src?: string;
  /** CSS `aspect-ratio` value, e.g. "16/9", "4/3", "1/1". */
  aspect?: string;
  /** Size preset. Only affects the min-height fallback used when `aspect` is unset. */
  size?: PlaceholderBoxSize;
  class?: string;
  [key: string]: unknown;
};

const SIZE_MIN_HEIGHT: Record<PlaceholderBoxSize, string> = {
  sm: "var(--spacing-vsp-lg)",
  md: "var(--spacing-vsp-xl)",
  lg: "var(--spacing-vsp-2xl)",
};

/**
 * Image stand-in used wherever the library has no real asset yet — an `img`
 * MDX-override target. Root element is a `<span>` (phrasing content): MDX
 * wraps `![alt](src)` in a `<p>`, and a block-level `<div>` here would
 * produce invalid `<p><div></p>` nesting.
 */
export function PlaceholderBox({
  label,
  alt,
  src,
  aspect,
  size = "md",
  class: cls,
  ...rest
}: PlaceholderBoxProps) {
  const displayLabel = label ?? alt ?? src ?? "image";
  const style: JSX.CSSProperties = aspect
    ? { aspectRatio: aspect }
    : { minHeight: SIZE_MIN_HEIGHT[size] };

  return (
    <span
      class={cx(
        "flex items-center justify-center",
        "border border-border bg-surface text-muted",
        "text-caption rounded px-hsp-md py-vsp-sm text-center",
        cls,
      )}
      style={style}
      role="img"
      aria-label={displayLabel}
      {...rest}
    >
      <span class="text-muted">[{displayLabel}]</span>
    </span>
  );
}
