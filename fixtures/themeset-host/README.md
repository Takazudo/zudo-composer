# Themeset host fixture

`fixtures/host` and this directory are the same host, with one difference: the
`pack` specifier. That is the whole swap.

The pack is a real installed package — `@zudo-composer/fixture-themeset`,
resolved out of `node_modules/` — not a relative path, because
`parseSource` in `@zudo-composer/component-contract` admits only public
bare-package imports. Its component set (`themeset.panel`, `themeset.note`)
deliberately shares no id with `@zudo-sg/ui`, so a project authored against one
pack is rejected by a server validating against the other.

Run it the same way:

```
corepack pnpm dev
```
