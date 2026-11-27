import { h, signal } from "@takazudo/zfb/zudo-react";
import { describe, expect, it } from "vitest";
import { render, settle } from "../../../test/render";
import "./library-test-environment";
import { createLibrarySelection, type LibrarySelectionController, type LibrarySelectionOptions } from "../library-selection";
import { RECORDS, type Record_ } from "./library-fixtures";

const rowId = (row: Record_) => row.id;
const ids = (rows: readonly Record_[]) => rows.map(rowId);

/** The controller sweeps in its caller's scope, so it is created inside a mounted component. */
function mountSelection(options: LibrarySelectionOptions<Record_>): LibrarySelectionController<Record_> {
  let controller: LibrarySelectionController<Record_> | null = null;
  function Harness() {
    controller = createLibrarySelection(options);
    return null;
  }
  render(h(Harness, null));
  if (!controller) throw new Error("selection harness did not run");
  return controller;
}

describe("createLibrarySelection", () => {
  it("starts empty and reports the count the bulk bar shows", () => {
    const selection = mountSelection({ rows: RECORDS, rowId });
    expect(selection.selectedCount.value).toBe(0);
    expect(selection.selectedIds.value.size).toBe(0);
  });

  it("keeps the selected records in the source list's order", () => {
    const selection = mountSelection({ rows: RECORDS, rowId });
    selection.toggleRow("landing-hero", true);
    selection.toggleRow("blog-post", true);
    expect(ids(selection.selectedRows.value)).toEqual(["blog-post", "landing-hero"]);
    expect(selection.isSelected("blog-post")).toBe(true);
  });

  it("deselects a row and clears the whole selection", () => {
    const selection = mountSelection({ rows: RECORDS, rowId });
    selection.toggleAll(true);
    expect(selection.selectedCount.value).toBe(RECORDS.length);

    selection.toggleRow("blog-post", false);
    expect(selection.isSelected("blog-post")).toBe(false);

    selection.clear();
    expect(selection.selectedCount.value).toBe(0);
  });

  it("survives filtering: a row hidden by the filter stays selected", async () => {
    const visible = RECORDS.filter((row) => row.kind === "pattern");
    const visibleRows = signal<readonly Record_[]>(RECORDS);
    const selection = mountSelection({ rows: RECORDS, visibleRows, rowId });
    selection.toggleRow("blog-post", true);
    visibleRows.value = visible;
    await settle();
    expect(selection.isSelected("blog-post")).toBe(true);
    expect(selection.selectedCount.value).toBe(1);
  });

  it("does not survive deletion: a record that left the library leaves the selection", async () => {
    const rows = signal<readonly Record_[]>(RECORDS);
    const selection = mountSelection({ rows, rowId });
    selection.toggleRow("blog-post", true);
    selection.toggleRow("site-frame", true);

    rows.value = RECORDS.filter((row) => row.id !== "blog-post");
    await settle();
    expect(ids(selection.selectedRows.value)).toEqual(["site-frame"]);
    expect(selection.selectedIds.value.has("blog-post")).toBe(false);
  });

  it("does not re-select a later record that reuses a deleted record's id", async () => {
    // A route slugging ids from names hands out the same `untitled-record`
    // again as soon as the first one is deleted.
    const reused: Record_ = { ...RECORDS[1], name: "Untitled" };
    const rows = signal<readonly Record_[]>(RECORDS);
    const selection = mountSelection({ rows, rowId });
    selection.toggleRow("blog-post", true);

    const without = RECORDS.filter((row) => row.id !== "blog-post");
    rows.value = without;
    await settle();
    expect(selection.selectedCount.value).toBe(0);

    rows.value = [...without, reused];
    await settle();
    expect(selection.selectedCount.value).toBe(0);
    expect(selection.isSelected("blog-post")).toBe(false);
  });

  it("covers exactly the visible rows when selecting and deselecting all", () => {
    const visible = RECORDS.filter((row) => row.kind === "pattern");
    const selection = mountSelection({ rows: RECORDS, visibleRows: visible, rowId });

    selection.toggleAll(true);
    expect(ids(selection.selectedRows.value)).toEqual(["product-overview", "landing-hero"]);

    selection.toggleRow("blog-post", true);
    selection.toggleAll(false);
    expect(ids(selection.selectedRows.value)).toEqual(["blog-post"]);
  });
});
