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

The package is self-contained on the permanent package-only branch
`package/component-contract-v1`. Its `prepare` script builds from the package
root, and the package-local workspace boundary prevents preparation from
depending on the repository root. Consumers should use the exact `rootGitSpec`
in the repository's `contract-handoff.json`; the handoff deliberately avoids a
Git subdirectory `path:` selector because pnpm may install the repository root
for that form. CI proves the full-SHA package-root handoff with a fresh
temporary consumer.
