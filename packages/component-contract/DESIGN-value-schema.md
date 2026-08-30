# Recursive value schema design

Status: locked for implementation by issue #92.

This document defines contract v2's authorable JSON-value model. The central decision is a
recursive schema per prop with a separate, schema-compatible editor description. Component
nodes continue to persist plain JSON values; schemas remain in the component-pack manifest.

## Locked manifest shape

The public normalized manifest types are:

```ts
export type NonEmptyReadonlyArray<T> = readonly [T, ...T[]];

export interface FieldBase<TProp extends string = string> {
  readonly prop: TProp;
  readonly label: string;
  /** When true, the component default must contain this top-level prop. */
  readonly required?: boolean;
}

export interface ObjectFieldBase<TKey extends string = string> {
  readonly key: TKey;
  readonly label: string;
  /** When true, every object value must own this key. */
  readonly required?: boolean;
}

export interface StringTextValueDefinition {
  readonly schema: { readonly type: 'string' };
  readonly editor: {
    readonly kind: 'text';
    readonly multiline?: boolean;
    readonly mode?: 'plain' | 'markdown-source';
  };
}

export type NonInlineValueDefinition =
  | {
      readonly schema: { readonly type: 'string' };
      readonly editor: { readonly kind: 'color' };
    }
  | {
      readonly schema: {
        readonly type: 'string';
        readonly enum: NonEmptyReadonlyArray<string>;
      };
      readonly editor: { readonly kind: 'select' };
    }
  | NumberValueDefinition
  | BooleanValueDefinition
  | ArrayValueDefinition
  | TupleValueDefinition
  | ObjectValueDefinition;

export interface NumberValueDefinition {
  readonly schema: {
    readonly type: 'number';
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
  };
  readonly editor: { readonly kind: 'number' };
}

export interface BooleanValueDefinition {
  readonly schema: { readonly type: 'boolean' };
  readonly editor: { readonly kind: 'boolean' };
}

export interface ArrayValueDefinition {
  readonly schema: { readonly type: 'array'; readonly items: ValueDefinition };
  readonly editor: { readonly kind: 'list' };
}

export interface TupleValueDefinition {
  readonly schema: {
    readonly type: 'tuple';
    readonly items: readonly TupleItemDefinition[];
  };
  readonly editor: { readonly kind: 'tuple' };
}

export type TupleItemDefinition = {
  readonly label: string;
} & ValueDefinition;

export interface ObjectValueDefinition {
  readonly schema: {
    readonly type: 'object';
    readonly fields: readonly ObjectFieldDefinition[];
  };
  readonly editor: { readonly kind: 'group' };
}

export type ValueDefinition = StringTextValueDefinition | NonInlineValueDefinition;

export type ObjectFieldDefinition<TKey extends string = string> =
  ObjectFieldBase<TKey> & ValueDefinition;

export type FieldDefinition<TProp extends string = string> = FieldBase<TProp> & (
  | (StringTextValueDefinition & { readonly inlineEdit?: true })
  | (NonInlineValueDefinition & { readonly inlineEdit?: never })
);
```

`ValueDefinition`, rather than `ValueSchema` alone, is recursive so every nested value has both
shape and an editor. Object fields use `key`; only top-level component fields use `prop`.
Objects are closed: a value may contain only declared keys. Duplicate and reserved object keys
are authoring errors. Tuple `items` may be empty and fixes both length and per-position schemas;
arrays are homogeneous and unbounded in length.

The five current `kind`s are retained as editor kinds, not value kinds. `text`, `select`, and
`color` all edit strings; `select` moves its non-empty option domain to `schema.enum`.
`number` keeps `min`, `max`, and `step` on the schema. `number` and `color` stay in v2 despite
having no real provider usage yet: they are already public, cheap scalar cases and removing them
would create churn without simplifying recursion.

Issue #92 must bump `CONTRACT_VERSION` from 1 to 2 because normalized manifest field syntax
changes. To keep all 12 existing sidecars compiling, `AuthorFieldDefinition<TProps>` must also
accept the existing five scalar shorthands and normalize them in `defineComponentPack` to the
shape above. This is an authoring compatibility adapter only: `ComponentManifest.fields` and
parser output are always canonical v2 definitions. A directly parsed v2 manifest must use the
canonical shape. The scalar shorthand can be deprecated after provider migration; composite
values have no shorthand. Legacy text `inlineEdit` metadata normalizes to `inlineEdit: true`,
with its `multiline` and `mode` values on the text editor (defaulting to `false` and `plain`).

Issue #92 adds exactly two issue codes, alphabetized in `ContractIssueCode`:
`DUPLICATE_OBJECT_FIELD_KEY` for repeated keys within one object schema and
`INVALID_VALUE_SCHEMA` for malformed, cyclic, over-depth, or incompatible schema/editor
declarations. Default/value domain failures continue using `INVALID_FIELD_DOMAIN`; missing
required values use `REQUIRED_DEFAULT_MISSING`; non-JSON/cyclic/over-depth values use
`INVALID_JSON_VALUE`; exact-key and reserved-key errors retain their existing codes.

The implementation also exports the downstream validation seam:

```ts
export function validateFieldValue(
  field: FieldDefinition,
  value: unknown,
  path?: string,
): asserts value is JsonValue;
```

An omitted `path` defaults to `'$value'`. `validateDefaults` and issue #93's model command use
this same function so default-time and edit-time rules cannot drift.

## 1. Recursion, tuples, depth, and cycles

**Decision:** Support scalar, homogeneous array, fixed tuple, and closed object nodes exactly as
shown above, with a shared maximum depth of 32 schema/value nodes (root is depth 0).

**Rationale:** These four forms cover the verified provider shapes without generic JSON, while a
hard shared limit makes hostile or accidental recursion terminate predictably.

The manifest parser walks schema objects with an ancestor-identity set and a depth counter. It
rejects a schema object encountered again on its current ancestor chain as cyclic and rejects a
node when its depth exceeds `MAX_VALUE_SCHEMA_DEPTH = 32`. Reuse of the same object in separate
completed branches is allowed. The value validator first applies the existing JSON guarantees
(finite numbers, dense arrays, plain enumerable string-keyed objects, no custom array members,
no symbols, no cycles), extended to use the same depth limit, and then matches the value against
the schema with another bounded walk. Errors carry the exact path.

There is no `$ref` in v2. The verified `NavSection.children` type is `NavLeaf[]`, not
`NavSection[]`; “recursive” here means recursive schema nesting. A future genuinely
self-referential data type would require a separately designed named-reference grammar.

## 2. Relationship to the five existing kinds

**Decision:** The five kinds are subsumed as scalar editors paired with three scalar schema
types (`string`, `number`, `boolean`); they do not remain a parallel manifest construct.

**Rationale:** Shape validation and UI choice change for different reasons, and the pairing union
prevents nonsensical combinations such as a color editor for a number.

The canonical pairings are exhaustive: plain string → text/color, enum string → select, number
→ number, boolean → boolean, array → list, tuple → tuple, and object → group. A new schema or
editor kind must make every contract-side switch fail its `never` exhaustiveness guard until it
is handled.

## 3. Persisted shape and round-trip

**Decision:** `PersistedComponentNode` and the document format do not change; structured values
remain raw JSON under `node.props[prop]`.

**Rationale:** Arrays and objects already round-trip through the document parser, renderer prop
spread, cloning, and JSX generator's JSON-literal path.

Array and tuple order is significant. Object key order is not semantic. No editor metadata,
item IDs, schema tags, or wrapper objects are stored in a node. `documentVersion` and
`COMPOSITION_SCHEMA_VERSION` therefore do not bump merely for this feature. The pack manifest
does move to contract v2 as described above.

## 4. `schemaVersion` rules

**Decision:** Increment a component's `schemaVersion` whenever a schema edit can invalidate or
reinterpret any previously valid persisted prop value; do not increment for presentation-only
or purely widening edits.

**Rationale:** `componentVersion` gates whether persisted props may be interpreted, so its version
must track compatibility of persisted meaning rather than editor appearance.

A bump is required for: changing a value type; array/tuple conversion; tuple length or position
meaning changes; object-key rename/removal; optional → required; adding a required object key;
tightening an enum/range/step; or changing what a stored key means. No bump is required for:
adding an optional object field; reordering object field declarations; widening an enum/range;
labels; collapse state conventions; or changing between compatible editors without changing the
schema domain. Tuple item reorder is breaking; object field reorder is not. A migration may
transform data, but it does not waive the bump.

## 5. Defaults and nested classification

**Decision:** `validateDefaults` recursively validates every declared structured default, and
closed object schemas classify every nested key.

**Rationale:** A default that merely passes generic JSON validation can still crash the real
component, and undeclared nested keys recreate the top-level unauthorable-orphan problem.

At the top level, today's rule remains: `required: true` requires an owned default for that prop.
Within an object schema, every TypeScript-required member must appear once in `fields` with
`required: true`; optional members may be declared with `required` absent/false, and undeclared
optional members are intentionally unauthorable and rejected if present in a value. At runtime,
`required: true` requires an own property in every object occurrence, including objects inside
arrays/tuples. Optional means the key may be absent, not present as `undefined` (undefined is not
JSON). Defaults and later authored values use the identical recursive matcher. Select defaults
must be in `schema.enum`; number defaults must satisfy finite/min/max/step rules.

## 6. Editor mapping

**Decision:** The inspector maps the exhaustive schema/editor pairs directly. List structural
operations replace the whole top-level prop value atomically.

**Rationale:** Deterministic conventions are sufficient for v1 UI and avoid premature layout
configuration in the contract.

- `list`: render ordered items with add, remove, move up/down, and drag reorder. Object items are
  collapsible; newly added items start expanded, existing items start collapsed. The summary is
  the first present string field, otherwise `Item N`. New items are constructed only when every
  required descendant has a deterministic seed: empty string, first enum option, `false`, a
  finite number satisfying constraints (choose the valid value with smallest absolute magnitude,
  preferring the nonnegative value on a tie), empty array,
  recursively seeded tuple, or recursively seeded object. If not constructible, Add is disabled
  with a validation message.
- `group`: render declared fields in declaration order. Optional absent fields expose Add/Remove;
  required fields cannot be removed.
- `tuple`: render fixed, labeled positions in order; it has no add/remove/reorder controls.
- scalar editors preserve their current controls. `text` owns multiline/mode, `select` reads
  options from `schema.enum`, and number constraints come from the schema.

Collapse state is ephemeral UI state and is never persisted in component props.

## 7. Inline editing

**Decision:** Nested text leaves are inspector-only in contract v2 and cannot declare inline
editing. The existing limit remains at most one top-level inline-editable text field per component.

**Rationale:** The runtime adapter identifies only a top-level prop and DOM resolver; nested paths,
list item identity, and selection semantics do not exist yet.

Only a top-level string/text field may set `inlineEdit: true`; its text editor's `multiline` and
`mode` settings are used by both inspector and inline editing. Nested text editors may use those
settings in the inspector, but cannot carry `inlineEdit` and do not count as or create an inline
target. Enabling nested inline editing later requires a path-aware adapter and stable item
identity first.

## 8. Type-level authoring boundary

**Decision:** Preserve `defineComponent<Props>()(Component, definition)` and recursively check
known JSON-compatible props, while keeping runtime validation authoritative.

**Rationale:** The inference-safe two-stage API retains the literal field/object tuples needed to
check totality and tuple positions without disconnecting the schema from the component's props.

`AuthorFieldDefinition<TProps>` maps each real prop key to
`AuthorValueDefinition<Exclude<TProps[K], undefined>>`. It checks scalar type/editor pairing, string
enum members, homogeneous array items, tuple length and positions, object keys, absence of
duplicate literal keys, and that every required object member is declared `required: true`.
The existing author scalar shorthand participates in the same checks before normalization.

Static checking deliberately stops at `any`/`unknown`, index signatures, unresolved generics,
cross-field business invariants, and unsupported unions (notably explicit `null` and discriminated
object unions; v2 has neither a null editor nor `oneOf`). Optional `undefined` is removed because
absence is represented by an omitted key; explicit `null` is not silently removed. Static checking
also cannot prove finite numbers, runtime plain-object prototypes, cycles,
depth, or values arriving from JSON. Those remain parser/validator checks. Type recursion should
use an internal tuple budget so TypeScript terminates; reaching that compiler budget yields a
useful unsupported-depth type error rather than silently widening. Runtime depth remains 32.

## 9. Undo/redo coalescing

**Decision:** Structured scalar-leaf typing coalesces by exact nested path; add/remove/reorder and
optional-key add/remove use `coalesceKey: null` and therefore create standalone checkpoints.

**Rationale:** Typing bursts in one leaf are one user action, while structural mutations change
identity/index meaning and must not merge with adjacent typing.

This is a controller/history seam for issue #93, not contract-package work for issue #92. Replace
the top-level-only key with:

```ts
export type PropPath = readonly [prop: string, ...segments: (string | number)[]];

export interface CoalesceKey {
  readonly kind: 'updateProps';
  readonly nodeId: string;
  readonly propPaths: readonly PropPath[];
}
```

Keys are copied and sorted lexicographically by typed segment (`string` sorts before `number`),
then compared segment-by-segment. Top-level typing uses `[['heading']]`; list typing uses paths
such as `[['actions', 0, 'label']]`. A leaf update still snapshots and writes the whole `actions`
array, so undo/redo restores the whole prior/new array. A structural `null` push also breaks the
preceding typing group, ensuring the next leaf edit starts a new group even within 1000 ms.

## Worked examples

### `HeroAction[]`

Verified source type: `{ label: string; href: string; variant?: 'primary' | 'secondary' }[]`.

```ts
{
  prop: 'actions',
  label: 'Actions',
  schema: {
    type: 'array',
    items: {
      schema: {
        type: 'object',
        fields: [
          { key: 'label', label: 'Label', required: true, schema: { type: 'string' }, editor: { kind: 'text' } },
          { key: 'href', label: 'URL', required: true, schema: { type: 'string' }, editor: { kind: 'text' } },
          { key: 'variant', label: 'Variant', schema: { type: 'string', enum: ['primary', 'secondary'] }, editor: { kind: 'select' } },
        ],
      },
      editor: { kind: 'group' },
    },
  },
  editor: { kind: 'list' },
}
```

The current default validates unchanged. The inspector edits records, the node stores the raw
array, preview receives records (never VNodes), and JSX emission uses the existing JSON literal.

### `NavSection[]` with nested `children`

Verified source has `NavSection.children: NavLeaf[]`; it is nested, not self-referential. Its
complete definition is:

```ts
{
  prop: 'sections',
  label: 'Navigation sections',
  required: true,
  schema: {
    type: 'array',
    items: {
      schema: {
        type: 'object',
        fields: [
          { key: 'label', label: 'Label', required: true, schema: { type: 'string' }, editor: { kind: 'text' } },
          { key: 'href', label: 'Section URL', schema: { type: 'string' }, editor: { kind: 'text' } },
          { key: 'order', label: 'Order', required: true, schema: { type: 'number' }, editor: { kind: 'number' } },
          {
            key: 'children',
            label: 'Child links',
            required: true,
            schema: {
              type: 'array',
              items: {
                schema: {
                  type: 'object',
                  fields: [
                    { key: 'label', label: 'Label', required: true, schema: { type: 'string' }, editor: { kind: 'text' } },
                    { key: 'href', label: 'URL', required: true, schema: { type: 'string' }, editor: { kind: 'text' } },
                    { key: 'slug', label: 'Slug', required: true, schema: { type: 'string' }, editor: { kind: 'text' } },
                    { key: 'order', label: 'Order', required: true, schema: { type: 'number' }, editor: { kind: 'number' } },
                  ],
                },
                editor: { kind: 'group' },
              },
            },
            editor: { kind: 'list' },
          },
        ],
      },
      editor: { kind: 'group' },
    },
  },
  editor: { kind: 'list' },
}
```

A missing child `slug`, extra child key, non-finite `order`, cyclic value, or depth above 32 is
rejected with its nested path. Because the top-level field is required, its component default
must contain `sections`; nested `children` may be an empty array but may not be absent.

### `BusinessLinePortal.only?: string[]`

`only` is verified caller configuration selecting line keys, not collection-derived feed data:

```ts
{
  prop: 'only',
  label: 'Visible line keys',
  schema: {
    type: 'array',
    items: { schema: { type: 'string' }, editor: { kind: 'text' } },
  },
  editor: { kind: 'list' },
}
```

The inspector authors an ordered string list. Omission remains distinct from `[]`, both
round-trip as today, and item typing coalesces at paths such as `['only', 0]`.

## Explicit boundaries

Collection-derived arrays such as `NewsList.items` and `SearchResults.docs` are excluded. They
must be classified static until a collection/query binding supplies them; a list editor must not
turn remote/feed records into copied component props.

Data-slots become justified only when records need independent stable identity across reorder,
reuse in more than one component, their own nested component composition, cross-references,
independent mapping/binding/history, or partial loading. Until one of those requirements is real,
plain JSON values plus recursive schemas are the smaller correct model.
