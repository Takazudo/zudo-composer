import { ComposerIcon } from "../../icons";
import type { LibraryFacet, LibrarySort } from "../library-query";
import type { LibraryRowContract } from "../row-contract";

// A route-shaped record: the suite exercises the components through a domain
// type they know nothing about, which is the point of the row contract.

export interface Record_ {
  readonly id: string;
  readonly name: string;
  readonly kind: "plain" | "pattern" | "template";
  readonly nodes: number;
  readonly updatedAt: number;
}

const AUG = (day: number) => new Date(2026, 7, day, 9, 0, 0).getTime();

export const RECORDS: readonly Record_[] = [
  { id: "product-overview", name: "Product overview", kind: "pattern", nodes: 8, updatedAt: AUG(29) },
  { id: "blog-post", name: "Blog post", kind: "plain", nodes: 11, updatedAt: AUG(28) },
  { id: "site-frame", name: "Site frame", kind: "template", nodes: 5, updatedAt: AUG(27) },
  { id: "landing-hero", name: "Landing hero", kind: "pattern", nodes: 6, updatedAt: AUG(25) },
];

const KIND_LABELS: Readonly<Record<Record_["kind"], string>> = {
  plain: "Plain",
  pattern: "Pattern",
  template: "Global template",
};

export const CONTRACT: LibraryRowContract<Record_> = {
  id: (row) => row.id,
  name: (row) => row.name,
  icon: () => ComposerIcon,
  href: (row) => `/composer?record=${row.id}`,
  kind: (row) => ({ label: KIND_LABELS[row.kind], tone: row.kind === "plain" ? "plain" : "accent" }),
  updatedAt: (row) => row.updatedAt,
};

export const searchText = (row: Record_): string => `${row.name} ${row.id}`;

export const KIND_FACET: LibraryFacet<Record_> = {
  id: "kind",
  label: "Kind",
  options: [
    { id: "all", label: "All" },
    { id: "plain", label: "Plain", match: (row) => row.kind === "plain" },
    { id: "pattern", label: "Pattern", match: (row) => row.kind === "pattern" },
    { id: "template", label: "Global template", match: (row) => row.kind === "template" },
  ],
};

export const SORTS: readonly LibrarySort<Record_>[] = [
  { id: "updated", label: "Updated", compare: (a, b) => b.updatedAt - a.updatedAt },
  { id: "name", label: "Name", compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "nodes", label: "Nodes", compare: (a, b) => b.nodes - a.nodes },
];
