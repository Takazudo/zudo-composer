import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DIRECTORY = resolve("src/components/outline-tree");
const css = readFileSync(resolve(DIRECTORY, "outline-tree.css"), "utf8");
const appTokens = readFileSync(resolve("src/styles/app-tokens.css"), "utf8");

/** Comments legitimately mention issue numbers and geometry; rules do not. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** The declaration block of the first rule whose selector list starts with `selector`. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} is not a rule in outline-tree.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

function atRule(prelude: string): string {
  const start = css.indexOf(prelude);
  expect(start, `${prelude} is not in outline-tree.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("outline-tree.css", () => {
  it("carries no colour literal — every colour is a token", () => {
    const rules = stripComments(css);
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/);
  });

  it("reads only properties the app declares, its own locals, or the provider font namespace", () => {
    const declared = new Set([
      ...(appTokens.match(/--[a-z0-9-]+(?=\s*:)/g) ?? []),
      ...(stripComments(css).match(/--[a-z0-9-]+(?=\s*:)/g) ?? []),
      // The provider owns the font namespace, as it owns `--text-*`.
      "--font-mono",
    ]);
    const used = new Set([...stripComments(css).matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]));
    expect([...used].filter((token) => !declared.has(token))).toEqual([]);
  });

  it("keeps the geometry the prototype fixed", () => {
    const root = block(".cms-tree");
    for (const declaration of [
      "--tree-indent: 16px",
      "--tree-offset: 7px",
      "--tree-connector: 10px",
      "--tree-row: 28px",
      "--tree-cat-row: 32px",
      "--tree-base-pad: 10px",
    ]) {
      expect(root).toContain(declaration);
    }
  });

  it("draws every connector dashed — never a solid rule", () => {
    // Matched across the file: these selectors also appear in the shared
    // positioning group, which carries no border of its own.
    expect(css).toMatch(/\.cms-tree-vline \{[^}]*border-inline-start: 1px dashed/);
    expect(css).toMatch(/\.cms-tree-spine \{[^}]*border-inline-start: 1px dashed/);
    expect(css).toMatch(/\.cms-tree-hline \{[^}]*border-block-start: 1px dashed/);
    expect(block(".cms-tree-add-root")).toContain("1px dashed");
    expect(block(".cms-tree-insert::before")).toContain("border-block-start: 1px dashed");
  });

  it("shortens the toolbar labels against the tree's own width", () => {
    expect(block(".cms-tree")).toContain("container-type: inline-size");
    expect(atRule("@container (max-width: 400px)")).toContain(".cms-tree__opt { display: none; }");
  });

  it("keeps the insert point at zero height, with the tile and editor off the flow", () => {
    const insert = block(".cms-tree-insert");
    expect(insert).toContain("position: relative");
    expect(insert).toContain("height: 0");
    expect(block(".cms-tree-insert__hit")).toContain("inset-block: -0.55rem");

    const tile = block(".cms-tree-insert__btn");
    expect(tile).toContain("position: absolute");
    expect(tile).toContain("width: 26px");
    expect(tile).toContain("height: 26px");
    expect(tile).toContain("border: 0");
    // Ringed with the page background so the tile reads as a break in the line.
    expect(tile).toContain("box-shadow: 0 0 0 3px var(--color-bg)");
    expect(tile).toContain("opacity: 0");

    expect(block(".cms-tree-insert > .cms-tree-inline")).toContain("position: absolute");
  });

  it("reveals the tile on hover, focus-within and while the editor is open", () => {
    expect(css).toContain(".cms-tree-insert:focus-within .cms-tree-insert__btn");
    expect(css).toContain(".cms-tree-insert.is-active .cms-tree-insert__btn");
    expect(atRule("@media (hover: hover)")).toContain(".cms-tree-insert:hover .cms-tree-insert__btn");
  });

  it("gives coarse pointers a 44px row, a 44px hit zone and a permanently visible tile", () => {
    const coarse = atRule("@media (pointer: coarse)");
    expect(coarse).toContain("--tree-row: 44px");
    expect(coarse).toContain("--tree-cat-row: 44px");
    expect(coarse).toContain("inset-block: -22px");
    expect(coarse).toContain("opacity: .55");
    expect(coarse).toContain("pointer-events: auto");
  });

  it("reserves no width for the hover-only actions", () => {
    const acts = block(".cms-tree-acts");
    expect(acts).toContain("width: 0");
    expect(acts).toContain("padding: 0");
    expect(acts).toContain("opacity: 0");
    expect(css).toContain(".cms-tree-leaf-wrap:hover .cms-tree-acts");
  });
});

describe("outline-tree components", () => {
  it("carry no colour literal of their own", () => {
    const sources = readdirSync(DIRECTORY).filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"));
    expect(sources.length).toBeGreaterThan(0);
    for (const name of sources) {
      const source = stripComments(readFileSync(resolve(DIRECTORY, name), "utf8"));
      expect(source, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(source, name).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(/);
    }
  });
});
