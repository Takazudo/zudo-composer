import { describe, expect, it } from "vitest";
import { createContentEntryRecord, createContentModelRecord, type ContentEntryRecord, type ContentModelSummary } from "../../../content";
import { buildContentOutline, contentMoreRowId, isContentMoreRowId } from "../content-outline";

const stamp = "2026-01-01T00:00:00.000Z";

const journal = createContentModelRecord({
  name: "Journal articles",
  kind: "collection",
  fields: [
    { id: "heading", key: "heading", label: "Heading", required: true, kind: "text" },
    { id: "slug", key: "slug", label: "Slug", required: false, kind: "slug" },
  ],
}, { id: "journal-articles", timestamp: stamp });

function summaryOf(id: string, name: string, kind: "collection" | "single"): ContentModelSummary {
  return { id, name, kind, fieldCount: 2, createdAt: stamp, updatedAt: stamp };
}

const models: readonly ContentModelSummary[] = [
  summaryOf("journal-articles", "Journal articles", "collection"),
  summaryOf("site-settings", "Site settings", "single"),
];

function entry(id: string, values: Record<string, string>): ContentEntryRecord {
  return createContentEntryRecord(journal.id, values, { id, timestamp: stamp });
}

const first = entry("entry-1", { heading: "Start with the question", slug: "start-with-the-question" });
const second = entry("entry-2", {});

function build(overrides: Partial<Parameters<typeof buildContentOutline>[0]> = {}) {
  return buildContentOutline({
    models,
    entryCounts: { "journal-articles": 26, "site-settings": 1 },
    incompleteCounts: { "journal-articles": 3, "site-settings": 0 },
    openModel: journal,
    entries: [first, second],
    hasMoreEntries: true,
    isEntryIncomplete: (candidate) => Object.keys(candidate.values).length === 0,
    ...overrides,
  });
}

describe("buildContentOutline", () => {
  it("renders every model as a category carrying its id, count, kind tag and warn dot", () => {
    const [journalNode, settingsNode] = build();

    expect(journalNode).toMatchObject({ id: "journal-articles", kind: "category", title: "Journal articles", slug: "journal-articles", count: 26 });
    expect(journalNode!.tag).toBeUndefined();
    expect(journalNode!.status).toEqual({ tone: "warn", label: "3 incomplete" });

    expect(settingsNode).toMatchObject({ id: "site-settings", kind: "category", count: 1, tag: "single" });
    expect(settingsNode!.status).toEqual({ tone: "ok", label: "Complete" });
  });

  it("shows no dot for a model whose Entries have not been scanned", () => {
    const [journalNode] = build({ incompleteCounts: {} });
    expect(journalNode!.status).toBeUndefined();
  });

  it("gives Entries only to the open model, as leaves named by their title field", () => {
    const [journalNode, settingsNode] = build();

    expect(journalNode!.children?.map((child) => [child.id, child.kind, child.title, child.slug])).toEqual([
      ["entry-1", "leaf", "Start with the question", "start-with-the-question"],
      ["entry-2", "leaf", "Untitled Entry", "entry-2"],
      [contentMoreRowId("journal-articles"), "leaf", "24 more entries…", undefined],
    ]);
    // A category with no children is not expandable, so a model that is not
    // open cannot be opened by its caret — selecting it is what loads it.
    expect(settingsNode!.children).toEqual([]);
  });

  it("dots the Entries that are missing a required value", () => {
    const [journalNode] = build();
    const [complete, incomplete] = journalNode!.children!;
    expect(complete!.status).toBeUndefined();
    expect(incomplete!.status).toEqual({ tone: "warn", label: "Incomplete" });
  });

  it("offers the further page as one trailing row, and none when the page is the whole model", () => {
    expect(build({ hasMoreEntries: false })[0]!.children).toHaveLength(2);
    // The count is what is left, not what is loaded.
    expect(build({ entryCounts: { "journal-articles": 3 } })[0]!.children!.at(-1)!.title).toBe("1 more entry…");
    // A total that has not caught up with the page yet still names the row.
    expect(build({ entryCounts: {} })[0]!.children!.at(-1)!.title).toBe("More entries…");
  });

  it("keeps the paging row distinguishable from a record id", () => {
    expect(isContentMoreRowId(contentMoreRowId("journal-articles"))).toBe(true);
    expect(isContentMoreRowId("journal-articles")).toBe(false);
  });
});
