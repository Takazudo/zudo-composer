# Stylesheet architecture

Three separate CSS graphs share this tree, kept apart by document rather than
by namespace: the component pack and the editor declare the same `--color-*`
names, and a themeset is interchangeable and untrusted, so one merged sheet can
never be safe. A build-time `pnpm styles:isolation` gate, part of `pnpm check`,
fails the build if editor CSS reaches a preview or site document.

**Editor chrome.** `src/style.css` is the global entry loaded by
`src/main.tsx` for every authoring route. It imports `base.css` and
`features/composer/styles.css`; `base.css` imports `styles/app-tokens.css` and
Tailwind utilities. The editor document also imports the host's styles entry
(`virtual:zudo-composer-host-styles`) directly, because the Content route
renders the pack's `ProseMd` inline — the editor needs the pack's CSS
available even though its own chrome never reads a pack token.

Component barrels carry the CSS for components that own their presentation:
`ui/index.ts`, `editor-chrome/index.ts`, `outline-tree/index.ts`,
`overlay/index.ts`, and `library-page/index.ts` each import their sibling sheet.
Feature route entries import the content, assets, mapping, and sitemapper sheets;
the sitemapper sheet is a barrel for its canvas, inspector, shell, and token
leaves.

**Composer preview canvas chrome.** `/composer/preview` is a same-origin
iframe whose entry (`features/composer/preview/preview-entry.ts`) imports the
host's styles entry plus `features/composer/preview/preview.css`, and nothing
of the editor chrome sheet. `preview.css` owns its tokens outright: the
components in the canvas render with the themeset's own palette, since
`app-tokens.css` redeclares the same `--color-*` names the pack declares and
would repaint them in the editor palette. The canvas chrome around them
therefore reads a scoped `--zc-preview-*` set declared on
`html[data-composer-preview-doc]`, with the dark rungs on that selector plus
`[data-theme="dark"]`. Its values are copied from `app-tokens.css`, so the
chrome is unchanged; never point one of them at a pack token, since a themeset
is interchangeable and untrusted by design.

**Visitor documents.** `/site` and `/website-preview` open as their own
document, mounted by `features/delivery/preview-entry.ts`, which imports the
host's styles entry plus `features/delivery/visitor.css` — the same shape the
published static site ships, and none of the editor chrome sheet. The only
tool-owned UI inside that document is the preview strip
(`features/delivery/preview-strip.tsx`): it renders into an open Shadow DOM
with `all: initial` and its own sheet
(`features/delivery/preview-strip.css`), reading only `--zc-strip-*` tokens it
declares itself, so neither the host sheet nor the pack can style it.

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
