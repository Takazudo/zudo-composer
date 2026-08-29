import { describe, expect, it } from "vitest";

describe("Mapping boundary", () => {
  it("stays headless", () => {
    const modules = import.meta.glob("../**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const source = Object.entries(modules).filter(([path]) => !path.includes("/__tests__/")).map(([, value]) => value).join("\n");
    expect(source).not.toMatch(/from\s+["'](?:preact|preact\/|\.\.\/features|\.\.\/app)/);
    expect(source).not.toMatch(/\b(?:window|localStorage)\b/);
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function\b/);
  });
});
