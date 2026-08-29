import type { SitemapNode } from "../model";
import type { SitemapRecord, SitemapSummary } from "./types";

function countPages(nodes: readonly SitemapNode[]): number {
  let count = 0;
  for (const node of nodes) count += 1 + countPages(node.children);
  return count;
}

export function countSitemapPages(record: Pick<SitemapRecord, "document">): number {
  return countPages(record.document.root);
}

/** The single provider-neutral summary builder. */
export function summarizeSitemap(record: SitemapRecord): SitemapSummary {
  return {
    id: record.id,
    name: record.document.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    pageCount: countSitemapPages(record),
  };
}

/** Newest updated record first; equal timestamps use ascending id order. */
export function compareSitemapSummariesNewestFirst(
  a: Pick<SitemapSummary, "id" | "updatedAt">,
  b: Pick<SitemapSummary, "id" | "updatedAt">,
): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

