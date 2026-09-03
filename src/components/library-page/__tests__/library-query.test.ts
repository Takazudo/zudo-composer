import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/preact";
import "./library-test-environment";
import {
  applyLibraryQuery,
  defaultFacetValues,
  isLibraryQueryFiltered,
  matchesLibrarySearch,
  useLibraryQuery,
  type LibraryQueryState,
} from "../library-query";
import { KIND_FACET, RECORDS, SORTS, searchText, type Record_ } from "./library-fixtures";

const UNFILTERED: LibraryQueryState = { search: "", facetValues: { kind: "all" }, sortId: null };
const names = (rows: readonly Record_[]) => rows.map((row) => row.name);

describe("matchesLibrarySearch", () => {
  it("matches everything while the box is empty", () => {
    expect(matchesLibrarySearch("Product overview", "")).toBe(true);
    expect(matchesLibrarySearch("Product overview", "   ")).toBe(true);
  });

  it("ignores case and word order, and requires every token", () => {
    expect(matchesLibrarySearch("Product overview product-overview", "OVER product")).toBe(true);
    expect(matchesLibrarySearch("Product overview", "product pricing")).toBe(false);
  });
});

describe("applyLibraryQuery", () => {
  const definition = { searchText, facets: [KIND_FACET], sorts: SORTS };

  it("returns every row when nothing narrows the list", () => {
    expect(applyLibraryQuery(RECORDS, definition, UNFILTERED)).toEqual(RECORDS);
  });

  it("filters on the row's own search text", () => {
    expect(names(applyLibraryQuery(RECORDS, definition, { ...UNFILTERED, search: "site" }))).toEqual(["Site frame"]);
  });

  it("treats a facet option with no matcher as the 'all' answer", () => {
    const state = { ...UNFILTERED, facetValues: { kind: "pattern" } };
    expect(names(applyLibraryQuery(RECORDS, definition, state))).toEqual(["Product overview", "Landing hero"]);
  });

  it("falls back to the facet's default when the stored option no longer exists", () => {
    const state = { ...UNFILTERED, facetValues: { kind: "retired-option" } };
    expect(applyLibraryQuery(RECORDS, definition, state)).toHaveLength(RECORDS.length);
  });

  it("orders by the chosen sort without mutating the source list", () => {
    const before = [...RECORDS];
    expect(names(applyLibraryQuery(RECORDS, definition, { ...UNFILTERED, sortId: "name" }))).toEqual([
      "Blog post",
      "Landing hero",
      "Product overview",
      "Site frame",
    ]);
    expect(RECORDS).toEqual(before);
  });

  it("leaves the source order alone when the sort id matches nothing", () => {
    expect(names(applyLibraryQuery(RECORDS, definition, { ...UNFILTERED, sortId: "retired-sort" }))).toEqual(names(RECORDS));
  });

  it("combines search and facet", () => {
    const state = { search: "o", facetValues: { kind: "plain" }, sortId: null };
    expect(names(applyLibraryQuery(RECORDS, definition, state))).toEqual(["Blog post"]);
  });
});

describe("isLibraryQueryFiltered", () => {
  it("is false while the search box holds only whitespace and every facet is on its default", () => {
    expect(isLibraryQueryFiltered([KIND_FACET], { ...UNFILTERED, search: "  " })).toBe(false);
  });

  it("is true for a search term or a narrowed facet", () => {
    expect(isLibraryQueryFiltered([KIND_FACET], { ...UNFILTERED, search: "site" })).toBe(true);
    expect(isLibraryQueryFiltered([KIND_FACET], { ...UNFILTERED, facetValues: { kind: "plain" } })).toBe(true);
  });
});

describe("defaultFacetValues", () => {
  it("puts every facet on its first option", () => {
    expect(defaultFacetValues([KIND_FACET])).toEqual({ kind: "all" });
  });
});

describe("useLibraryQuery", () => {
  function setup() {
    return renderHook(() =>
      useLibraryQuery({ rows: RECORDS, searchText, facets: [KIND_FACET], sorts: SORTS }),
    );
  }

  it("starts unfiltered on the first sort", () => {
    const { result } = setup();
    expect(result.current.sortId).toBe("updated");
    expect(result.current.facetValue("kind")).toBe("all");
    expect(result.current.filtered).toBe(false);
    expect(names(result.current.rows)).toEqual(["Product overview", "Blog post", "Site frame", "Landing hero"]);
  });

  it("honours an explicit default sort", () => {
    const { result } = renderHook(() =>
      useLibraryQuery({ rows: RECORDS, searchText, sorts: SORTS, defaultSortId: "name" }),
    );
    expect(names(result.current.rows)[0]).toBe("Blog post");
  });

  it("narrows on search and on a facet, and reports that it is filtered", () => {
    const { result } = setup();
    act(() => result.current.setSearch("hero"));
    expect(names(result.current.rows)).toEqual(["Landing hero"]);
    expect(result.current.filtered).toBe(true);

    act(() => result.current.setSearch(""));
    act(() => result.current.setFacetValue("kind", "template"));
    expect(names(result.current.rows)).toEqual(["Site frame"]);
    expect(result.current.facetValue("kind")).toBe("template");
  });

  it("clears the filters but keeps the chosen order", () => {
    const { result } = setup();
    act(() => result.current.setSortId("name"));
    act(() => result.current.setSearch("hero"));
    act(() => result.current.setFacetValue("kind", "pattern"));

    act(() => result.current.clearFilters());
    expect(result.current.search).toBe("");
    expect(result.current.facetValue("kind")).toBe("all");
    expect(result.current.filtered).toBe(false);
    expect(result.current.sortId).toBe("name");
    expect(names(result.current.rows)[0]).toBe("Blog post");
  });
});
