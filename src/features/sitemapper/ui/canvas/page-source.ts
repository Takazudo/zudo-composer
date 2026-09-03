// What renders one page, resolved for display (issue #165).
//
// The canvas nodes, the Tree table and the inspector all say the same thing
// about a page's source, so the resolution happens once in the editor and
// arrives here as data. A page with no entry in the map is unassigned.

import type { SitemapNodeRouteInfo } from "../../../../sitemapper/routes";

export interface PageSourceLabel {
  readonly kind: "composition" | "mapping";
  /** The Composition's or Mapping's own name. */
  readonly name: string;
  /** Secondary line: the provider, or a Mapping's slug field and route count. */
  readonly detail?: string;
}

export type PageSourceLabels = ReadonlyMap<string, PageSourceLabel>;

/** "Ready" / "Needs attention" — never the raw `ready` / `blocked` value. */
export function describeRouteStatus(status: SitemapNodeRouteInfo["status"]): string {
  return status === "ready" ? "Ready" : "Needs attention";
}
