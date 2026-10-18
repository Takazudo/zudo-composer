import { describe, expect, it } from "vitest";
import { buildReviewAnnotations, stringLeaves, wordDiff } from "../review-model";
import type { DraftChange } from "../types";

const slice = (text: string, spans: [number, number][]) => spans.map(([start, end]) => text.slice(start, end));
const change = (patch: Partial<DraftChange>): DraftChange => ({ id: "c", kind: "field", page: { sitemapId: "s", pageId: "p" }, recordId: "home", nodeId: "n1", componentId: "c.text", componentTitle: "Text", operationIds: [], reasons: [], ...patch });

describe("Assistant review model", () => {
  it("marks only changed words, joins adjacent words, and ignores whitespace-only edits", () => {
    const before = "Plan your week in minutes.", after = "Plan your whole week in a few minutes.";
    const diff = wordDiff(before, after);
    expect(slice(after, diff.insert)).toEqual(["whole", "a few"]);
    expect(diff.remove).toEqual([]);
    expect(wordDiff("Start  free", "Start free")).toEqual({ insert: [], remove: [] });
    const shortened = wordDiff("Drag a block into next month and everyone sees it move.", "Drag a block to any day.");
    expect(slice("Drag a block into next month and everyone sees it move.", shortened.remove).join(" ")).toContain("next month");
  });

  it("diffs Japanese per character, so a changed phrase is marked without the unchanged surroundings", () => {
    const before = "初心者向けの説明です。", after = "初心者にやさしい説明です。";
    expect(slice(after, wordDiff(before, after).insert)).toEqual(["にやさしい"]);
  });

  it("addresses list items and table cells by path", () => {
    expect(stringLeaves({ columns: ["A", "B"], rows: [["1", "2"]] })).toEqual([
      { path: "/columns/0", text: "A" }, { path: "/columns/1", text: "B" }, { path: "/rows/0/0", text: "1" }, { path: "/rows/0/1", text: "2" },
    ]);
  });

  it("builds node-anchored annotations per view, skipping non-text fields and absent nodes", () => {
    const changes = [
      change({ prop: "title", before: "Old title", after: "New title" }),
      change({ id: "img", nodeId: "n2", componentId: "c.image", prop: "src", before: "/uploaded-assets/a.png", after: "/uploaded-assets/b.png" }),
      change({ id: "add", kind: "added", nodeId: "n3", props: { title: "Shared agendas", icon: "people" } }),
    ];
    const isText = (componentId: string, prop: string) => prop === "title";
    const draft = buildReviewAnnotations(changes, "k|draft", "draft", isText);
    expect(draft.items.map(item => [item.nodeId, item.kind, item.label, item.ordinal, item.total])).toEqual([["n1", "changed", "Changed", 1, 3], ["n2", "changed", "Changed", 2, 3], ["n3", "added", "Added", 3, 3]]);
    expect(draft.items[0]!.texts).toEqual([{ text: "New title", ranges: [[0, 3]], tone: "insert" }]);
    // An image change is a block marker with exact detail in the review list, never words.
    expect(draft.items[1]!.texts).toEqual([]);
    expect(draft.items[2]!.texts).toEqual([{ text: "Shared agendas", ranges: [[0, 14]], tone: "insert" }]);
    const current = buildReviewAnnotations(changes, "k|current", "current", isText);
    expect(current.items.map(item => item.nodeId)).toEqual(["n1", "n2"]);
    expect(current.items[0]).toMatchObject({ label: "Will change", texts: [{ text: "Old title", ranges: [[0, 3]], tone: "delete" }] });
  });
});
