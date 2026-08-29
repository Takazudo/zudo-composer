// Permanent native Sitemap sample. It is built from the shared deterministic
// factory, never ambient randomness, so recovery fixtures and UI snapshots are
// stable across processes.

import { createSequentialIdFactory } from "../../shared";
import type { SitemapDocument, SitemapNode } from "../model";
import { SITEMAP_SCHEMA_VERSION } from "../model";

/** Build a fresh, deterministic sample document. */
export function createSampleSitemap(): SitemapDocument {
  const id = createSequentialIdFactory("page");
  const page = (title: string, buildChildren: () => SitemapNode[] = () => []): SitemapNode => {
    const nodeId = id(title);
    return { id: nodeId, title, source: { kind: "unassigned" }, children: buildChildren() };
  };

  return {
    schemaVersion: SITEMAP_SCHEMA_VERSION,
    id: "sample-sitemap",
    name: "Sample sitemap",
    root: [
      page("Home", () => [
        page("Products", () => [
          page("Product List", () => [page("Product Detail")]),
          page("Categories", () => [page("Category Detail")]),
        ]),
        page("Cart", () => [
          page("Cart Overview"),
          page("Checkout", () => [page("Order Confirmation")]),
        ]),
        page("Account", () => [
          page("Sign In"),
          page("Profile", () => [page("Orders")]),
        ]),
        page("Other Pages", () => [
          page("About"),
          page("Contact", () => [page("Support")]),
        ]),
      ]),
    ],
  };
}

/** Canonical JSON sample. Use the builder when a mutable copy is required. */
export const SAMPLE_SITEMAP: SitemapDocument = createSampleSitemap();
