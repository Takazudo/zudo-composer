/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Dismissible load/recovery notice for the Sitemapper workspace (issue #409).
//
// Recovery is intentionally visible and separate from the live save pill: a
// malformed record may have produced a writable sample, while a future-schema
// record is quarantined and must not be overwritten until the user explicitly
// chooses a reset path in the controller.

import type { JSX } from "preact";

export type SitemapperLoadNotice =
  | { kind: "recovered"; reason: string }
  | { kind: "quarantined"; foundSchemaVersion: number };

export interface SitemapperLoadNoticeBannerProps {
  notice: SitemapperLoadNotice;
  onDismiss: () => void;
}

export function describeSitemapperLoadNotice(notice: SitemapperLoadNotice): string {
  switch (notice.kind) {
    case "recovered":
      return `The saved Sitemap could not be read (${notice.reason}) — recovered the sample so you can keep working.`;
    case "quarantined":
      return `Storage holds a newer Sitemap (schema v${notice.foundSchemaVersion}) this version does not understand. Working from the sample — nothing is saved until you reset.`;
  }
}

export function SitemapperLoadNoticeBanner({
  notice,
  onDismiss,
}: SitemapperLoadNoticeBannerProps): JSX.Element {
  return (
    <div class="sg-sitemapper-load-notice" role="status">
      <span>{describeSitemapperLoadNotice(notice)}</span>
      <button type="button" class="sg-sitemapper-toolbar-button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}

export default SitemapperLoadNoticeBanner;
