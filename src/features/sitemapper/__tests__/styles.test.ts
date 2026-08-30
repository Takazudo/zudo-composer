import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const cssPath = resolve(process.cwd(), "src/features/sitemapper/styles.css");
const css = readFileSync(cssPath, "utf8");

describe("Sitemapper feature CSS aggregator", () => {
  it("imports every owned leaf stylesheet", () => {
    for (const leaf of ["tokens", "library", "shell", "canvas", "tree", "inspector"]) {
      expect(css).toContain(`@import "./styles/${leaf}.css";`);
    }
  });
});
