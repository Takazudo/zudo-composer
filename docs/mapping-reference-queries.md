# Qualified reference query filters

The Mapping Query pane supports a single Content `reference` field with the
existing `equals`, `not-equals`, and `exists` operators. It loads choices from that
field's declared provider and target model. Each option shows its label and full
`providerId/modelId/recordId`; duplicate labels and reordering do not change identity.
Reference sorting and `contains` remain unsupported. Reference lists and other
structured fields are not added to this picker.

Opening an existing query retains its exact qualified value. Catalog loading never
edits a query or chooses the first record. A new Reference filter starts with
`exists`; switch to equality and explicitly choose an Entry to filter membership.
The query uses the normal Mapping draft/save workflow. This UI does not replace
live reference membership with finite pins.

For example, a Results child Mapping can filter `result-entry-year` using:

```json
{"fieldId":"result-entry-year","operator":"equals","value":{"providerId":"content-filesystem","modelId":"result-year","recordId":"year-2015"}}
```

The equivalent FAQ group filter selects `faq-item-group` and a qualified
`content-filesystem/faq-group/faq-exam` Entry. The host still owns creation and
placement of the parent group, child Mapping, and any navigation/TOC entry.

Use **Refresh referenced Entries** after changing target records in another editor.
Missing/deleted targets, unavailable catalogs and wrong provider/model values remain
visible with an explanation; they are never silently converted to an unqualified ID
or another record. Choose a valid Entry, change the operator, or remove the condition
explicitly. A late catalog result from a previously selected model is ignored.

The existing pure collection evaluator validates a reference's shape and declared
provider/model; it does not fetch a target catalog. An absent but well-shaped Entry
ID can therefore yield zero matches. The picker separately reports missing targets
from the current catalog, while coherent project capture/build retains its existing
reference and rendering validation. This change adds no query schema or operator.

Consumer acceptance must use an independently installed immutable package: duplicate
or create a Results year and FAQ group, create their reference-filtered child Mappings,
place them through explicit parent/TOC ownership, then save, reload and build the exact
captured workspace. Preserve original records and restore test changes through guarded
inverses. Generic tests alone do not complete Pinsel acceptance.
