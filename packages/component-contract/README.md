# `@zudo-composer/component-contract`

The component contract is the generic boundary between independently installed
component providers and zudo-composer consumers. It has no UI-framework or
application dependencies.

Provider sidecars use `defineComponent` for prop-key checking and
`defineComponentPack` to produce two deliberately separate values:

- a JSON-safe `ComponentPackManifest` that may cross a package or persistence
  boundary; and
- a trusted `ComponentRuntimeRegistry` that remains executable provider code.

Consumers must call `validateRuntimeParity` before resolving nodes. This checks
pack identity and exact component ID/schema-version parity, including explicit
missing-runtime diagnostics. `resolveComponentNode` preserves unknown or
schema-version-mismatched persisted nodes as opaque values so current document
formats can recover them without interpreting stale props, fields, or slots.

Contract version, provider pack version, per-component schema version, and
document version are separate identities. Changing a declared scalar `prop`,
field ID, or slot ID is a persisted-schema change and requires incrementing the
component's `schemaVersion`.

The package is self-contained for Git subdirectory consumers. Its `prepare`
script builds from this package directory, and the package-local workspace
boundary prevents preparation from depending on the repository root. CI proves
the quoted full-SHA handoff with a fresh temporary consumer.
