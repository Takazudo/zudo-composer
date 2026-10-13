import { describe, expect, it } from "vitest";
import { exactInsertion, isCompositionEnter } from "../request";
describe("exact supplied native input", () => {
  it("preserves Japanese text and line breaks and accepts explicitly empty alt", () => {
    const text = "正確な日本語。\n\n二行目。";
    expect(exactInsertion("text", text, "", "")).toEqual({ kind: "text", text });
    expect(exactInsertion("image", "", "managed-image", "")).toEqual({ kind: "image", assetId: "managed-image", alt: "" });
  });
  it("requires exactly supplied rectangular table values", () => {
    expect(exactInsertion("table", '{"columns":["項目","値"],"rows":[["数量","3"]]}', "", "")).toEqual({ kind: "table", columns: ["項目", "値"], rows: [["数量", "3"]] });
    expect(() => exactInsertion("table", '{"columns":["A","B"],"rows":[["one"]]}', "", "")).toThrow();
    expect(() => exactInsertion("table", '{"columns":["A"],"rows":[["one"]],"caption":"invented"}', "", "")).toThrow();
  });
  it("recognizes composition Enter without treating it as a submission", () => {
    expect(isCompositionEnter({ key: "Enter", isComposing: true })).toBe(true);
    expect(isCompositionEnter({ key: "Enter", keyCode: 229 })).toBe(true);
    expect(isCompositionEnter({ key: "Enter", isComposing: false })).toBe(false);
  });
});
