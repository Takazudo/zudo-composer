// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("sample styleguide host styles", () => {
  it("loads the public component, docs, and catalog stylesheets", () => {
    const css = readFileSync(
      resolve(repositoryRoot, "styleguide/sample/src/styles/global.css"),
      "utf8",
    );

    expect(css).toContain('@import "@zudo-composer/ui/styles/composer.css"');
    expect(css).toContain('@import "@takazudo/zudo-doc/safelist.css"');
    expect(css).toContain('@import "@takazudo/zudo-sg/styles.css"');
    expect(css).toContain('@import "@takazudo/zudo-sg/safelist.css"');
    expect(css).not.toContain('@import "@zudo-composer/ui/src/');
  });
});
