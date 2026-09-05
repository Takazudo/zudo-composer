import { describe, expect, it } from "vitest";
import { document } from "../../model/__tests__/fixtures";
import { editSitemapNavigation } from "../navigation";

describe("independent navigation commands", () => {
  it("inserts and reorders exact menu indices without changing the page tree or other menu", () => {
    let value = document();
    const item = (id: string) => ({ id, label: id, visible: true, destination: { kind: "route" as const, nodeId: "home" } });
    for (const [id, index] of [["a", 0], ["c", 1], ["b", 1]] as const) {
      const result = editSitemapNavigation(value, "primary", { kind: "put", item: item(id), index });
      expect(result.ok).toBe(true); if (result.ok) value = result.document;
    }
    expect(value.navigation.primary.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    const moved = editSitemapNavigation(value, "primary", { kind: "put", item: { ...item("c"), label: "Renamed", visible: false }, index: 0 });
    expect(moved.ok).toBe(true); if (!moved.ok) return;
    expect(moved.document.navigation.primary.map(({ id }) => id)).toEqual(["c", "a", "b"]);
    expect(moved.document.root).toEqual(value.root); expect(moved.document.navigation.footer).toEqual([]);
    expect(value.navigation.primary.map(({ id }) => id)).toEqual(["a", "b", "c"]);
    expect(editSitemapNavigation(value, "primary", { kind: "put", item: item("x"), index: 8 })).toEqual({ ok: false, code: "invalid-index" });
    expect(editSitemapNavigation(value, "footer", { kind: "remove", id: "a" })).toEqual({ ok: false, code: "item-not-found" });
  });
});
