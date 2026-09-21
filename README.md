# `@zudo-composer/ui`

Preact components and the typed component provider pack for zudo-composer.
This package owns the 12 Composer building-block components, their Composer
sidecars, the generated component pack, and the CSS needed to render that
pack. The Composer authoring tool itself lives in
[Takazudo/zudo-composer](https://github.com/Takazudo/zudo-composer), the
repository this package is part of.

## Public provider boundary

```ts
import {
  componentPack,
  componentPackManifest,
  componentRuntimeRegistry,
} from "@zudo-composer/ui/composer-pack";
import "@zudo-composer/ui/styles/composer.css";
```

`componentPackManifest` is JSON-safe provider data. The runtime registry keeps
the trusted Preact components and optional render/inline-editor adapters. Both
are generated from co-located `src/**/*.composer.tsx` sidecars.

## Stylesheet cascade

- `composer.css` declares two cascade layers: `zc-preflight` (Tailwind
  preflight) and `zc-base` (the `body` background/foreground).
- Import `composer.css` before any other stylesheet, or put
  `@layer zc-preflight, zc-base;` as the first line of the host entry, so both
  sort below every host layer.
- Utilities are emitted unlayered by design, so a host's cascade-layered rules
  never beat them.

## Component authoring rule

- Put the definition beside the component as `<name>.composer.tsx`.
- Author it with `defineComponent` from `@zudo-composer/component-contract`.
- Assign a stable persisted component `id` and `schemaVersion`.

## Provenance

The 12 components, `src/lib/cx.ts`, the prose-md runtime and CSS, and
`styles/` were ported byte-for-byte from:

- Source repository: `Takazudo/zudo-sg` (private)
- Package commit: `6b0826cdaa14d9888e58c795ee015f70e2c5cbdf`
- Tree: `1c3cbfd3a25d1425f447cdadd5ba538916394309`
- Date taken into ownership: 2026-09-15

`src/index.ts` is not a byte copy: it is a barrel trimmed to the 12 shipped
components from the source repository's fuller `src/index.ts`, which also
exported components this package does not own.

zudo-sg is a private repository with no `LICENSE` file and no `license`
field, at this commit or at its current `main`; the copied files are by this
repository's author. `LICENSE` here is a copy of the workspace root's MIT
`LICENSE`.

This README, not `CLAUDE.md`, is the permanent record of the source tree
hash after the cutover in zudo-composer#701.
