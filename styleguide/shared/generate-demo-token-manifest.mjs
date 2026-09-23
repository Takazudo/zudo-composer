import { readFile, writeFile } from "node:fs/promises";

/** Adapt a demo host's real CSS variables to the zudo-sg token dashboard API.
 * zudo-sg's bundled generator is specific to @zudo-composer/ui token names.
 * Keep this independent of any one demo's palette or token values.
 */
export async function generateDemoTokenManifest(cssPath, outputPath, namespace) {
  const css = await readFile(cssPath, "utf8");
  const declarations = [...css.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)]
    .map(([, cssVar, value]) => ({ cssVar, value: value.trim() }));
  const variables = new Map(declarations.map(({ cssVar, value }) => [cssVar, value]));
  const prefix = `--${namespace}-palette-`;
  const palette = declarations.filter(({ cssVar }) => cssVar.startsWith(prefix));
  const semantic = declarations.filter(({ cssVar }) => cssVar.startsWith(`--color-${namespace}-`));
  const spacing = declarations.filter(({ cssVar }) => cssVar.startsWith(`--spacing-${namespace}-`));
  const fonts = declarations.filter(({ cssVar }) =>
    cssVar.startsWith(`--text-${namespace}-`) || cssVar.startsWith(`--font-${namespace}-`) ||
    cssVar.startsWith(`--font-weight-${namespace}-`) || cssVar.startsWith(`--tracking-${namespace}-`));
  const sizes = declarations.filter(({ cssVar }) =>
    cssVar.startsWith(`--radius-${namespace}-`) || cssVar.startsWith(`--shadow-${namespace}-`) ||
    cssVar.startsWith(`--container-${namespace}-`) || cssVar.startsWith(`--breakpoint-${namespace}-`));
  const token = ({ cssVar, value }, group, control = "text") => ({
    id: cssVar.slice(2), cssVar, label: cssVar.slice(2).replaceAll("-", " "),
    group, default: value, step: 0.05, unit: "", control,
  });
  const colorGroup = (name) => /accent|focus/.test(name) ? "accent" : /success|danger/.test(name) ? "state" : /fg|muted|faint|link|price/.test(name) ? "text" : "surface";
  const manifest = {
    // The installed dashboard assumes palette names expand to --palette-*.
    // Shop declares --shop-palette-*; expose those actual vars as color rows.
    UI_PALETTE_COLORS: [],
    UI_COLOR_TOKENS: [...palette, ...semantic].map((entry) => token(entry, colorGroup(entry.cssVar))),
    UI_SPACING_TOKENS: spacing.map((entry) => token(entry, entry.cssVar.includes("-hsp-") ? "hsp" : "vsp")),
    UI_FONT_TOKENS: fonts.map((entry) => token(entry,
      entry.cssVar.includes("--line-height") ? "font-size-lh" :
      entry.cssVar.startsWith("--text-") ? "font-size" :
      entry.cssVar.startsWith("--font-weight-") ? "font-weight" :
      entry.cssVar.startsWith("--font-") ? "font-family" : "line-height")),
    UI_SIZE_TOKENS: sizes.map((entry) => token(entry, entry.cssVar.startsWith("--radius-") ? "radius" : "shadow")),
  };
  if (!palette.length || !semantic.length || !spacing.length || !fonts.length || !sizes.length || variables.size !== declarations.length) {
    throw new Error(`Incomplete or duplicate ${namespace} tokens in ${cssPath}`);
  }
  const output = [
    '/* Generated from the demo host CSS. Do not edit. */',
    'import type { TokenDef } from "@takazudo/zdtp";',
    'export const UI_PALETTE_COLORS: readonly { name: string; value: string }[] = [];',
    ...Object.entries(manifest).filter(([name]) => name !== "UI_PALETTE_COLORS")
      .map(([name, values]) => `export const ${name}: readonly TokenDef[] = ${JSON.stringify(values, null, 2)};`),
    '',
  ].join("\n");
  await writeFile(outputPath, output);
  return manifest;
}
