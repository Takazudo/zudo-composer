# `@zudo-composer/component-contract`

The component contract is the generic boundary between independently installed
component providers and zudo-composer consumers. It has no UI-framework or
application dependencies.

Provider sidecars use `defineComponent` to check defaults, editable field
props/options, structural slot props, and inline-editor targets against the
real component props. `defineComponentPack` then produces two deliberately
separate values:

- a JSON-safe `ComponentPackManifest` that may cross a package or persistence
  boundary; and
- a trusted `ComponentRuntimeRegistry` that remains executable provider code.

Serializable definitions contain single-sourced title/category/description
metadata, one public source import, JSON-safe defaults, discriminated editable
fields, and structural slots. Runtime entries retain the actual component and
optional render/inline-editor adapters. Consumers call `validateRuntimeParity`
before resolving nodes; it checks pack identity, exact component ID/version
parity, and the one-to-one inline field/adapter relationship.

`resolveComponentNode` preserves unknown or schema-version-mismatched nodes as
opaque values so current document formats can recover them without interpreting
stale props or slots. The package's document boundary is intentionally minimal:
nodes persist arbitrary JSON-safe `props` plus stable structural slot maps. It
does not own application-specific composition naming or reuse metadata.

Contract version, provider pack version, per-component schema version, and
document version are separate identities. A field's `prop` is the persisted
editable key. Slots have a stable persisted `id` distinct from their real
component `prop`; changing either persisted meaning requires incrementing the
component's `schemaVersion`.

## Slot bounds

A slot may declare optional `min` and `max` bounds on its direct children:

- Both are non-negative safe integers, and `min <= max` when both are given.
- A `cardinality: "single"` slot already holds at most one node, so `min > 1`
  or `max > 1` is rejected with `INVALID_SLOT_BOUNDS`.
- `max` is a hard cap: consumers reject inserts beyond it and treat documents
  that exceed it as violations, exactly as a second node in a `single` slot.
- `min` is a completeness requirement: consumers surface it as a diagnostic, but
  it never blocks rendering or export. A published global-template outlet's slot
  is intentionally empty in its source and stays valid.
- Omitted bounds leave behaviour unchanged, and a manifest without bounds
  validates exactly as it did before they existed.

Combined with `accepts`, these bounds are what the zudo-composer consumer
calls a "page kind": a Global template whose outlet targets a restricted
slot, so every bound consumer inherits that slot's `accepts`/cardinality/
`min`/`max` as its own root policy. This package defines the bounds; the
worked example and every authoring surface that displays them live in
zudo-composer's own
[Page Kinds guide](https://github.com/Takazudo/zudo-composer/blob/main/doc/src/content/docs/guides/page-kinds.mdx).

The package is self-contained on the permanent package-only branch
`package/component-contract-v1`. Its `prepare` script builds from the package
root, and the package-local workspace boundary prevents preparation from
depending on the repository root. Consumers should use the exact `rootGitSpec`
in the repository's `contract-handoff.json`; the handoff deliberately avoids a
Git subdirectory `path:` selector because pnpm may install the repository root
for that form. CI proves the full-SHA package-root handoff with a fresh
temporary consumer.
