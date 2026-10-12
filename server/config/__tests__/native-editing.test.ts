import { describe, expect, it } from "vitest";
import { composer } from "../config";
import { parseNativeEditing } from "../native-editing";

describe("native host declarations", () => {
  it("preserves explicit declarations outside string settings", () => {
    const nativeEditing = { source: "workspace" as const, paragraph: { componentId: "text", textProp: "body" } };
    const config = composer({ pack: "host/components", nativeEditing });
    expect(config.nativeEditing).toEqual(nativeEditing);
    expect(config.settings).not.toHaveProperty("nativeEditing");
  });
  it.each([
    { source: "generated" }, { source: "workspace", prose: {} },
    { source: "workspace", paragraph: { componentId: "text", textProp: "body", alias: "x" } },
    { source: "workspace", image: { componentId: "photo", srcProp: "src" } },
    { source: "workspace", paragraph: { componentId: " text", textProp: "body" } },
    { source: "workspace", image: { componentId: "photo", srcProp: "x", altProp: "x" } },
  ])("rejects ambiguous or malformed declarations %#", (value) => expect(() => parseNativeEditing(value)).toThrow());
});
