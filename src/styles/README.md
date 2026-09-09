# Stylesheet architecture

`src/style.css` is the global entry loaded by `src/main.tsx`. It imports
`base.css`, `features/composer/styles.css`, and `features/delivery/styles.css`;
`base.css` imports `styles/app-tokens.css` and Tailwind utilities.

Component barrels carry the CSS for components that own their presentation:
`ui/index.ts`, `editor-chrome/index.ts`, `outline-tree/index.ts`,
`overlay/index.ts`, and `library-page/index.ts` each import their sibling sheet.
Feature route entries import the content, assets, mapping, and sitemapper sheets;
the sitemapper sheet is a barrel for its canvas, inspector, shell, and token
leaves. Preview CSS is imported by the preview entry and stays in the iframe.

App chrome classes use a `cms-` or `sg-` prefix; the public delivery surface uses
`site-delivery`. `src/base.css` has `@source "./"`, so Tailwind scans the whole
source tree; prefixes keep authored names identifiable and avoid collisions with
generated or provider classes.

The compact chrome spacing tokens use two interleaved ladders:

- Ladder A: `--sp-1..4` = 4 / 8 / 16 / 32px.
- Ladder B: `--sp-b1..4` = 6 / 12 / 24 / 48px.

At a grouping boundary, pair within-group and between-group gaps from the same
ladder, with the boundary one rung up (`same ladder, one rung up`).

Recurring geometry has role names: `--page-inset` for route insets,
`--row-chrome`, `--row-pick`, and `--control-h`. Callers should reference the
role name instead of copying a scale value when the surface has a named job.

`scripts/check-class-names.mjs` is the class gate: tests may not name dead
classes, and TSX may not emit numeric spacing utilities that the theme cannot
generate. The hsp/vsp ladder lives in the composer/content sheets; never mix
those ladders with the `--sp` ladders inside one file.
