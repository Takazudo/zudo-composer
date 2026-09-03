import type { ComponentChildren } from "preact";
import type { IconComponent } from "../icons";
import type { ChipTone } from "../ui/chip";
import type { LibraryTimestamp } from "./library-format";

// The row contract every library route implements (issue #164).
//
// `LibraryTable` is generic over the route's own record type — a
// `CompositionSummary`, a `SitemapRecord`, a media asset — and reads it only
// through these accessors. Routes therefore keep their domain types; nothing
// here names compositions, mappings, sitemaps or media.

/** The chip in the built-in `Kind` column. */
export interface LibraryKindTag {
  readonly label: ComponentChildren;
  readonly tone?: ChipTone;
}

export interface LibraryRowContract<Row> {
  /** Stable record id: the selection key, and the mono subline under the name. */
  id: (row: Row) => string;
  /** Primary label in the name cell. */
  name: (row: Row) => string;
  /**
   * Mono subline under the name. Defaults to the record id; return `null` to
   * render the name on its own.
   */
  subline?: (row: Row) => string | null;
  /**
   * Leading glyph in the name cell. Always an accessor, never a component —
   * an icon *is* a function, so a fixed icon reads as `() => ComposerIcon`.
   */
  icon?: (row: Row) => IconComponent | undefined;
  /** Deep link for the record; makes the name a link. */
  href?: (row: Row) => string | undefined;
  /** Drives the built-in `Kind` column. Omit the accessor to drop the column. */
  kind?: (row: Row) => LibraryKindTag | null;
  /** Drives the built-in `Updated` column. Omit the accessor to drop the column. */
  updatedAt?: (row: Row) => LibraryTimestamp | null;
}
