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

  it("keeps published Wind shell styles separate from actual Preact pack CSS", () => {
    const css = readFileSync(
      resolve(repositoryRoot, "styleguide/sample/src/styles/global.css"),
      "utf8",
    );

    const previewCss = readFileSync(
      resolve(repositoryRoot, "styleguide/sample/src/styles/preview-entry.css"),
      "utf8",
    );

    // SG 0.5/doc 7 use Wind in the shell; the actual Git-installed UI's
    // Tailwind stylesheet is compiled separately for the Preact iframe.
    for (const stylesheet of [
      "@takazudo/zudo-doc/theme.css",
      "@takazudo/zudo-doc/content.css",
      "@takazudo/zudo-doc/features.css",
      "@takazudo/zudo-doc/page-loading.css",
      "@takazudo/zdtp/dashboard/styles.css",
      "@takazudo/zudo-sg/styles.css",
    ]) {
      expect(css).toContain(`@import "${stylesheet}"`);
    }
    expect(css).toContain("@layer zw-reset, zd-flow;");
    expect(css).not.toMatch(/@import ["'](?:@zudo-composer\/ui\/|tailwindcss)/);
    expect(css).not.toContain("theme-no-reset.css");
    expect(css).not.toContain("safelist.css");
    expect(css).not.toMatch(/--color-(?:border|surface-2)\s*:/);
    expect(previewCss).toContain('@import "@zudo-composer/ui/styles/composer.css"');
    expect(previewCss).toContain('@source "../../stories"');
    expect(previewCss).toContain('@source "../../preview"');
    expect(previewCss).toContain('@source "../../node_modules/@zudo-composer/ui/src"');
    expect(previewCss).not.toMatch(/@takazudo\/(?:zudo-doc|zudo-sg)/);
    expect(css).toContain(".sg-home__main");
    expect(css).toContain(".sg-home__link:focus-visible");
    // zudo-doc hides the inactive SidebarToggle icon
    // with an inline `display:none` (zudolab/zudo-doc#4355), which no consumer
    // stylesheet can outrank, so the host's unlayered override is retired —
    // see UPSTREAM-NOTES item 11.
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

describe("demo styleguide host contracts", () => {
  it.each(["shop", "landing", "blog"])("serves %s checksum assets with immutable cache and nosniff headers", (slug) => {
    const headers = readFileSync(resolve(repositoryRoot, `styleguide/${slug}/public/_headers`), "utf8");
    expect(headers).toBe("/uploaded-assets/*\n  Cache-Control: public, max-age=31536000, immutable\n  X-Content-Type-Options: nosniff\n");
  });

  it.each(["shop", "landing", "blog"])("keeps %s on its own pack and the exact shared contract pin", (slug) => {
    const manifest = JSON.parse(readFileSync(resolve(repositoryRoot, `styleguide/${slug}/package.json`), "utf8"));
    const handoff = JSON.parse(readFileSync(resolve(repositoryRoot, "contract-handoff.json"), "utf8"));
    const readme = readFileSync(resolve(repositoryRoot, `styleguide/${slug}/README.md`), "utf8");

    expect(manifest.name).toBe(`zc-sg-${slug}`);
    expect(manifest.dependencies["@zudo-composer/component-contract"]).toBe(handoff.rootGitSpec);
    expect(manifest.dependencies).not.toHaveProperty("@zudo-composer/ui");
    expect(readme).toContain(`https://zc-sg-${slug}.zudolab.dev`);
    expect(readme).toContain(`sg:build-styleguide ${slug}-sg`);
  });

  it.each([
    ["shop", "demo-webshop"],
    ["landing", "demo-landing"],
    ["blog", "demo-blog"],
  ])("keeps %s catalog chrome separate from the demo preview stylesheet", (slug, demoPackage) => {
    const globalCss = readFileSync(resolve(repositoryRoot, `styleguide/${slug}/src/styles/global.css`), "utf8");
    const previewCss = readFileSync(resolve(repositoryRoot, `styleguide/${slug}/src/styles/preview-entry.css`), "utf8");

    expect(globalCss).toContain('@import "@takazudo/zudo-doc/theme.css"');
    expect(globalCss).toContain('@import "@takazudo/zudo-sg/styles.css"');
    expect(globalCss).not.toContain('@import "@zudo-composer/ui/');
    expect(previewCss).toContain(`packages/${demoPackage}/styles/base.css`);
    expect(previewCss).not.toContain("@takazudo/zudo-doc");
    expect(previewCss).not.toContain("@takazudo/zudo-sg");
  });
});
