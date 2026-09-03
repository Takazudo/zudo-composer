import type { OutlineNode } from "../types";

/** The Sitemapper shape from the prototype, trimmed to what the suites need. */
export const NODES: readonly OutlineNode[] = [
  {
    id: "home",
    kind: "category",
    title: "Home",
    slug: "/",
    count: 11,
    status: { tone: "ok", label: "Composition assigned" },
    children: [
      {
        id: "products",
        kind: "group",
        title: "Products",
        slug: "/products",
        count: 2,
        children: [
          { id: "overview", kind: "leaf", title: "Product overview", slug: "/products/overview" },
          { id: "pricing", kind: "leaf", title: "Pricing", slug: "/products/pricing" },
        ],
      },
      { id: "about", kind: "leaf", title: "About", slug: "/about", status: { tone: "warn", label: "Unassigned" } },
      {
        id: "docs",
        kind: "group",
        title: "Docs",
        slug: "/docs",
        count: 1,
        children: [{ id: "started", kind: "leaf", title: "Getting started", slug: "/docs/getting-started" }],
      },
    ],
  },
  { id: "settings", kind: "category", title: "Site settings", slug: "site-settings", tag: "single" },
];

/** Visible rows in DOM order once everything is open. */
export const ROW_ORDER = ["home", "products", "overview", "pricing", "about", "docs", "started", "settings"];
