// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");

describe("sample styleguide host styles", () => {
  it("gives the host-owned homepage an explicit styled shell", () => {
    const page = readFileSync(
      resolve(repositoryRoot, "styleguide/sample/pages/index.tsx"),
      "utf8",
    );

    expect(page).toContain('<body class="sg-home">');
    expect(page).toContain('class="sg-home__title"');
    expect(page).toContain('class="sg-home__links"');
    expect(page).toContain('class="sg-home__link"');
  });

  it("loads the public component, docs, and catalog stylesheets", () => {
    const css = readFileSync(
      resolve(repositoryRoot, "styleguide/sample/src/styles/global.css"),
      "utf8",
    );

    expect(css).toContain('@import "@zudo-composer/ui/styles/composer.css"');
    expect(css).toContain('@import "@takazudo/zudo-doc/theme-no-reset.css"');
    expect(css).not.toContain('@import "@takazudo/zudo-doc/theme.css"');
    expect(
      css.indexOf('@import "@zudo-composer/ui/styles/composer.css"'),
    ).toBeLessThan(
      css.indexOf('@import "@takazudo/zudo-doc/theme-no-reset.css"'),
    );
    expect(css).not.toMatch(/--color-(?:border|surface-2)\s*:/);
    expect(css).toContain('@import "@takazudo/zudo-doc/safelist.css"');
    expect(css).toContain('@import "@takazudo/zudo-sg/styles.css"');
    expect(css).toContain('@import "@takazudo/zudo-sg/safelist.css"');
    expect(css.lastIndexOf('@import "tailwindcss/utilities"')).toBeGreaterThan(
      css.indexOf('@import "@takazudo/zudo-sg/safelist.css"'),
    );
    expect(css).toContain(".sg-home__main");
    expect(css).toContain(".sg-home__link:focus-visible");
    // zudo-doc 5.26.3 hides the inactive SidebarToggle icon with an inline
    // `display:none` (zudolab/zudo-doc#4355), which no consumer stylesheet can
    // outrank, so the host's unlayered override is retired — see
    // UPSTREAM-NOTES item 11.
    expect(css).not.toContain('[data-zfb-island="SidebarToggle"]');
    expect(css).not.toContain('@import "@zudo-composer/ui/src/');
  });

  it("ships the favicon assets advertised by the catalog head", () => {
    for (const fileName of [
      "favicon-16x16.png",
      "favicon-32x32.png",
      "favicon.ico",
      "favicon.svg",
    ]) {
      expect(
        readFileSync(
          resolve(repositoryRoot, "styleguide/sample/public", fileName),
        ),
      ).toEqual(readFileSync(resolve(repositoryRoot, "doc/public", fileName)));
    }
  });
});
