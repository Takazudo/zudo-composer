# Selected Content entry identity

A presentation can bind the selected Content record's ID to a scalar text prop.
This is read-only record metadata, independent of collection order, display labels,
and Content field values. The Mapping supplies the provider and model; evaluation
supplies the actual selected Entry. It never accepts a replacement identity from
an editable field. Applied-binding provenance retains provider, model, and record ID.

Use the public authoring API:

```ts
import { entryRef } from "zudo-composer/authoring";

const mapping = site.mapping({
  name: "Consultation presentation",
  model: courses,
  composition: courseCard,
  mode: {
    kind: "collection",
    pins: [entryRef(consultation)],
    limit: 1,
  },
  bindings: [
    { field: "price", nodeId: "course-card", prop: "price" },
    { source: { kind: "entry-id" }, nodeId: "course-card", prop: "courseId" },
  ],
});
```

`courses`, `courseCard`, and `consultation` are handles returned by `site.model`,
`site.page`, and `site.entry`. The host component must declare `courseId` as a
scalar text field. `entryRef` returns the qualified pin
`{ providerId, modelId, recordId }`. Attach the collection Mapping to its owning
Composition slot using `site.attach`; pins do not change Sitemap route selection.

The stored binding is:

```json
{
  "id": "consultation-presentation-entry-id-courseid",
  "source": { "kind": "entry-id" },
  "target": { "nodeId": "course-card", "prop": "courseId" },
  "transform": { "kind": "identity" }
}
```

Entry identity accepts only the identity transform and scalar text destinations.
It has neither `sourceFieldId` nor `projection`. Mixed source shapes, extra metadata
keys, field projections, and transformations that alter identity are rejected.
Select, number, color, boolean, structured, missing, or unsupported targets produce
blocking diagnostics. Existing field bindings continue to require `sourceFieldId`
and `projection` with their existing compatibility rules.

Mapping schema version remains 2: existing field documents keep their exact
meaning and do not require rewriting. The union is additive in this release;
older installed Composer versions do not understand the new metadata branch and
must not be used to open newly authored identity bindings. Pin the verified
Composer revision with the consumer's workspace compatibility record.

The Mapping editor exposes **Entry identity** under read-only metadata and in
compatible text-target menus. It displays the source as record metadata, never as
a Content field. Rebinding to a field removes the metadata source entirely. Content
preview shows the qualified source. The generated grammar includes the same
source, transform, target-kind, and ownership rules. This does not add an AI
mutation operation: providers must still declare their supported operations, and
neither human nor AI editing may shadow bound metadata in Composition props.

## Pins and publication

Pins retain authored order, deduplicate repeated records, and precede sorted query
matches. They retain existing query semantics: they bypass query conditions, but
must satisfy the publication policy. The combined result obeys `limit`.

A missing, foreign-provider, foreign-model, or publication-ineligible explicit pin
now blocks evaluation with a diagnostic and no selected entries. It never falls
through to a different record. This intentionally strengthens the previous
nonblocking skip behavior. Release compilation still enforces published-only
Content: an explicitly pinned draft blocks until the author publishes it or
changes the pin. Unpinned drafts continue to be excluded from release queries.
Removing a pin is an explicit authoring decision, not automatic repair.

## Verification

Run focused source checks:

```sh
pnpm exec vitest run src/mapping/__tests__/mapping.test.ts src/features/mapping/__tests__ src/composer/grammar/__tests__ src/site-project/compiler/__tests__/compiler.test.ts
```

After public façade regeneration, `server/__tests__/authoring-dsl.test.ts` compiles
real `defineSite` identity bindings and pins, renames/reorders Content while keeping
the selected identity, and refuses a deleted pin. `pnpm contract:conformance` runs
the separate packed-install fixture, including public declaration rejection tests
and compilation of an identity-bound route. These checks use disposable known
inputs; they do not migrate an owner's current Content database.
