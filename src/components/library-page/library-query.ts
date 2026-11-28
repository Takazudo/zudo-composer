import { computed, signal, type ReadonlySignal, type Signal } from "@takazudo/zfb/zudo-react";
import type { IconComponent } from "../icons";
import { read, type MaybeSignal } from "../reactive";

// Filter and sort for a library route (issue #164).
//
// The matching and ordering live in pure functions so a route can reuse them
// outside a component (a keyboard command, a dashboard panel), and the
// controller is only the signals around them. Facets are single-select by design: the
// prototype's toolbar reads `Kind: All`, one answer per facet.

export interface LibraryFacetOption<Row> {
  readonly id: string;
  readonly label: string;
  /** Omitted on the "All" option — it matches every row. */
  readonly match?: (row: Row) => boolean;
}

export interface LibraryFacet<Row> {
  readonly id: string;
  /** Prefix on the toolbar trigger: `Kind: All`. */
  readonly label: string;
  readonly icon?: IconComponent;
  /** The FIRST option is the default, and the one `clearFilters` returns to. */
  readonly options: readonly LibraryFacetOption<Row>[];
}

export interface LibrarySort<Row> {
  readonly id: string;
  readonly label: string;
  readonly compare: (a: Row, b: Row) => number;
}

export interface LibraryQueryState {
  readonly search: string;
  readonly facetValues: Readonly<Record<string, string>>;
  readonly sortId: string | null;
}

export interface LibraryQueryDefinition<Row> {
  /** The text the filter input matches against — name and id, typically. */
  readonly searchText: (row: Row) => string;
  readonly facets?: readonly LibraryFacet<Row>[];
  readonly sorts?: readonly LibrarySort<Row>[];
}

/** Every facet on its first option — the unfiltered state. */
export function defaultFacetValues<Row>(facets: readonly LibraryFacet<Row>[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const facet of facets) {
    const first = facet.options[0];
    if (first) values[facet.id] = first.id;
  }
  return values;
}

/**
 * Every whitespace-separated token must appear somewhere in the row's text, so
 * `product over` finds "Product overview" and word order does not matter.
 */
export function matchesLibrarySearch(text: string, search: string): boolean {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = text.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function resolveFacetOption<Row>(facet: LibraryFacet<Row>, state: LibraryQueryState): LibraryFacetOption<Row> | undefined {
  const chosen = state.facetValues[facet.id];
  return facet.options.find((option) => option.id === chosen) ?? facet.options[0];
}

/** True while anything is narrowing the list — what drives the no-match state. */
export function isLibraryQueryFiltered<Row>(facets: readonly LibraryFacet<Row>[], state: LibraryQueryState): boolean {
  if (state.search.trim() !== "") return true;
  return facets.some((facet) => resolveFacetOption(facet, state) !== facet.options[0]);
}

export function applyLibraryQuery<Row>(
  rows: readonly Row[],
  definition: LibraryQueryDefinition<Row>,
  state: LibraryQueryState,
): readonly Row[] {
  const { searchText, facets = [], sorts = [] } = definition;
  let visible = rows;

  if (state.search.trim() !== "") {
    visible = visible.filter((row) => matchesLibrarySearch(searchText(row), state.search));
  }
  for (const facet of facets) {
    const match = resolveFacetOption(facet, state)?.match;
    if (match) visible = visible.filter(match);
  }

  const sort = sorts.find((candidate) => candidate.id === state.sortId);
  // Sorting last: it is the only step that copies, and it copies once.
  return sort ? [...visible].sort(sort.compare) : visible;
}

export interface LibraryQueryController<Row> {
  /** The rows to render, after filtering and sorting. */
  readonly rows: ReadonlySignal<readonly Row[]>;
  /** Writable so the filter input can bind it as its `modelValue`. */
  readonly search: Signal<string>;
  setSearch: (value: string) => void;
  readonly facets: readonly LibraryFacet<Row>[];
  /** The chosen option id, falling back to the facet's default. Tracked when read in a computed. */
  facetValue: (facetId: string) => string;
  setFacetValue: (facetId: string, optionId: string) => void;
  readonly sorts: readonly LibrarySort<Row>[];
  readonly sortId: ReadonlySignal<string | null>;
  setSortId: (sortId: string) => void;
  /** True while a filter is narrowing the list; sort order does not count. */
  readonly filtered: ReadonlySignal<boolean>;
  clearFilters: () => void;
}

export interface LibraryQueryOptions<Row> extends LibraryQueryDefinition<Row> {
  /** Every record; a signal keeps the filtered rows following the library. */
  readonly rows: MaybeSignal<readonly Row[]>;
  /** Defaults to the first sort. */
  readonly defaultSortId?: string;
}

export function createLibraryQuery<Row>({
  rows,
  searchText,
  facets = [],
  sorts = [],
  defaultSortId,
}: LibraryQueryOptions<Row>): LibraryQueryController<Row> {
  const search = signal("");
  const facetValues = signal<Readonly<Record<string, string>>>(defaultFacetValues(facets));
  const sortId = signal<string | null>(defaultSortId ?? sorts[0]?.id ?? null);
  const state = computed<LibraryQueryState>(() => ({ search: search.value, facetValues: facetValues.value, sortId: sortId.value }));

  return {
    rows: computed(() => applyLibraryQuery(read(rows), { searchText, facets, sorts }, state.value)),
    search,
    setSearch: (value) => {
      search.value = value;
    },
    facets,
    facetValue: (facetId) => {
      const facet = facets.find((candidate) => candidate.id === facetId);
      return facetValues.value[facetId] ?? facet?.options[0]?.id ?? "";
    },
    setFacetValue: (facetId, optionId) => {
      facetValues.value = { ...facetValues.value, [facetId]: optionId };
    },
    sorts,
    sortId,
    setSortId: (value) => {
      sortId.value = value;
    },
    filtered: computed(() => isLibraryQueryFiltered(facets, state.value)),
    clearFilters: () => {
      search.value = "";
      facetValues.value = defaultFacetValues(facets);
    },
  };
}
