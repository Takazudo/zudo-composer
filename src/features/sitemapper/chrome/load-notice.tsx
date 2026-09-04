/** @jsxRuntime automatic */
/** @jsxImportSource preact */
// Why a Sitemap could not be opened, said out loud.
//
// Recovery is intentionally visible and never destructive: a record this build
// cannot read — malformed, or written by a newer schema — is left exactly as it
// is rather than repaired in place or overwritten by an empty document. The
// notice therefore reports and offers the way back, and nothing else.

import type { JSX } from "preact";
import { Banner, Button } from "../../../components/ui";

export type SitemapperLoadNotice =
  | { kind: "missing"; sitemapId: string }
  | { kind: "unreadable"; sitemapId: string; reason?: string }
  | { kind: "future-schema"; sitemapId: string; foundSchemaVersion?: number };

export interface SitemapperLoadNoticeBannerProps {
  notice: SitemapperLoadNotice;
  /** The only way forward: back to the library. */
  onBack: () => void;
  backLabel?: string;
}

export function describeSitemapperLoadNotice(notice: SitemapperLoadNotice): string {
  switch (notice.kind) {
    case "missing":
      return `Sitemap “${notice.sitemapId}” no longer exists. It may have been deleted from this browser.`;
    case "unreadable":
      return notice.reason
        ? `Sitemap “${notice.sitemapId}” could not be read (${notice.reason}) and was left untouched.`
        : `Sitemap “${notice.sitemapId}” could not be read and was left untouched.`;
    case "future-schema":
      return notice.foundSchemaVersion === undefined
        ? `Sitemap “${notice.sitemapId}” was written by a newer build. It is held back rather than rewritten.`
        : `Sitemap “${notice.sitemapId}” was written by a newer build (schema v${notice.foundSchemaVersion}). It is held back rather than rewritten.`;
  }
}

export function SitemapperLoadNoticeBanner({
  notice,
  onBack,
  backLabel = "Back to Sitemaps",
}: SitemapperLoadNoticeBannerProps): JSX.Element {
  return (
    <div class="sg-sitemapper-load-notice">
      <Banner
        tone="err"
        title="This sitemap could not be opened."
        action={<Button size="sm" onClick={onBack}>{backLabel}</Button>}
      >
        {describeSitemapperLoadNotice(notice)}
      </Banner>
    </div>
  );
}

export default SitemapperLoadNoticeBanner;
