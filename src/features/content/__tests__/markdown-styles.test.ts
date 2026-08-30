import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/features/content/styles.css"), "utf8");

describe("Markdown editor styling contract", () => {
  it("uses semantic variables for editor chrome and syntax", () => {
    for (const variable of [
      "--sg-content-markdown-editor-bg",
      "--sg-content-markdown-editor-fg",
      "--sg-content-markdown-editor-selection",
      "--sg-content-markdown-syntax-heading",
      "--sg-content-markdown-syntax-emphasis",
      "--sg-content-markdown-syntax-link",
      "--sg-content-markdown-syntax-code",
      "--sg-content-markdown-syntax-quote",
    ]) expect(css).toContain(variable);
  });

  it("keeps Split usable on narrow layouts and imports the shared ProseMd styles", () => {
    expect(css).toContain('@import "@zudo-sg/ui/src/content/prose-md/prose-md.css"');
    expect(css).toContain("@media (max-width: 42rem)");
    expect(css).toMatch(/\.sg-content-markdown-editor__workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});
