import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/preact";
import "./library-test-environment";
import { useLibrarySelection } from "../library-selection";
import { RECORDS, type Record_ } from "./library-fixtures";

const rowId = (row: Record_) => row.id;
const ids = (rows: readonly Record_[]) => rows.map(rowId);

describe("useLibrarySelection", () => {
  it("starts empty and reports the count the bulk bar shows", () => {
    const { result } = renderHook(() => useLibrarySelection({ rows: RECORDS, rowId }));
    expect(result.current.selectedCount).toBe(0);
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("keeps the selected records in the source list's order", () => {
    const { result } = renderHook(() => useLibrarySelection({ rows: RECORDS, rowId }));
    act(() => result.current.toggleRow("landing-hero", true));
    act(() => result.current.toggleRow("blog-post", true));
    expect(ids(result.current.selectedRows)).toEqual(["blog-post", "landing-hero"]);
    expect(result.current.isSelected("blog-post")).toBe(true);
  });

  it("deselects a row and clears the whole selection", () => {
    const { result } = renderHook(() => useLibrarySelection({ rows: RECORDS, rowId }));
    act(() => result.current.toggleAll(true));
    expect(result.current.selectedCount).toBe(RECORDS.length);

    act(() => result.current.toggleRow("blog-post", false));
    expect(result.current.isSelected("blog-post")).toBe(false);

    act(() => result.current.clear());
    expect(result.current.selectedCount).toBe(0);
  });

  it("survives filtering: a row hidden by the filter stays selected", () => {
    const visible = RECORDS.filter((row) => row.kind === "pattern");
    const { result, rerender } = renderHook(
      ({ visibleRows }: { visibleRows: readonly Record_[] }) =>
        useLibrarySelection({ rows: RECORDS, visibleRows, rowId }),
      { initialProps: { visibleRows: RECORDS } },
    );
    act(() => result.current.toggleRow("blog-post", true));
    rerender({ visibleRows: visible });
    expect(result.current.isSelected("blog-post")).toBe(true);
    expect(result.current.selectedCount).toBe(1);
  });

  it("does not survive deletion: a record that left the library leaves the selection", () => {
    const { result, rerender } = renderHook(
      ({ rows }: { rows: readonly Record_[] }) => useLibrarySelection({ rows, rowId }),
      { initialProps: { rows: RECORDS } },
    );
    act(() => result.current.toggleRow("blog-post", true));
    act(() => result.current.toggleRow("site-frame", true));

    rerender({ rows: RECORDS.filter((row) => row.id !== "blog-post") });
    expect(ids(result.current.selectedRows)).toEqual(["site-frame"]);
    expect(result.current.selectedIds.has("blog-post")).toBe(false);
  });

  it("covers exactly the visible rows when selecting and deselecting all", () => {
    const visible = RECORDS.filter((row) => row.kind === "pattern");
    const { result } = renderHook(() => useLibrarySelection({ rows: RECORDS, visibleRows: visible, rowId }));

    act(() => result.current.toggleAll(true));
    expect(ids(result.current.selectedRows)).toEqual(["product-overview", "landing-hero"]);

    act(() => result.current.toggleRow("blog-post", true));
    act(() => result.current.toggleAll(false));
    expect(ids(result.current.selectedRows)).toEqual(["blog-post"]);
  });
});
