import { describe, expect, it } from "vitest";
import { cloneJson, isJsonSafe } from "../json";

describe("exact JSON safety", () => {
  it("rejects sparse arrays and custom array data", () => {
    const sparse = Array.from({ length: 1 });
    delete sparse[0];
    const custom = ["safe"] as unknown[] & { extra?: string };
    custom.extra = "lost";
    expect(isJsonSafe(sparse)).toBe(false);
    expect(isJsonSafe(custom)).toBe(false);
  });

  it("rejects symbols and non-enumerable object data", () => {
    const symbol = { safe: true } as Record<PropertyKey, unknown>;
    symbol[Symbol("lost")] = true;
    const hidden = { safe: true };
    Object.defineProperty(hidden, "lost", { value: true, enumerable: false });
    expect(isJsonSafe(symbol)).toBe(false);
    expect(isJsonSafe(hidden)).toBe(false);
  });

  it("refuses to clone values that would change during JSON serialization", () => {
    const sparse = Array.from({ length: 1 });
    delete sparse[0];
    expect(() => cloneJson(sparse)).toThrow(TypeError);
  });
});
