# Demo sites

## Lists

Every list on a demo site — product grids, pricing tiers, article lists,
testimonials, FAQ items, comments — is rendered through one tool mechanism:
**collection attachments** (`src/site-project/compiler/compiler.ts`,
`materializeCollectionAttachments`). There is no prop array of items anywhere.

### The contract

A `SiteProject` carries `collectionAttachments: [{ id, order, composition,
mapping, target: { nodeId, slotId } }]`. During compilation of a route whose
composition owns an attachment:

1. The Mapping named by `mapping` must be in **collection mode**
   (`mode.kind === "collection"`); its query is evaluated against the Content
   model (`published-only` at release time, with the query's `conditions`,
   `sort`, `pins` and `limit`).
2. The Mapping's composition — the **item composition** — must be
   **detached**: no `document.binding`. A composition linked into a global
   template cannot be an item.
3. The **target node** (`target.nodeId`) must exist in the owning composition
   and its component must declare the **target slot** (`target.slotId`). If
   the slot declares `accepts`, every mapped root component id must be listed
   there; otherwise the attachment blocks with `attachment-slot-incompatible`.
4. **One attachment per slot.** A second attachment on the same
   `{ nodeId, slotId }` blocks with `attachment-slot-conflict`.
5. The item composition is materialised **once per query entry**, each copy
   evaluated through the Mapping bindings for that entry, then appended to the
   target node's slot after any statically authored children. Node ids are
   rewritten to stable repeated ids so authored and generated nodes never
   collide.
6. `cardinality: "single"` on the target slot caps the output at one node in
   total (authored + generated); list slots must declare `cardinality:
   "many"`.
7. Nested attachments are allowed (an item composition may own attachments
   itself) but cycles block, and the whole route shares one
   `MAX_MATERIALIZED_NODES` budget.

### Consequence: list items are rendered child nodes

The component that renders a list receives its items as **children in a named
slot**, already materialised. It never receives an array prop. Therefore:

- **Filter, sort, search and pagination are client-side operations over
  children.** The list component (`shop.product-grid`, `land.pricing-table`,
  `blog.article-list`, …) creates a Preact context holding the current filter /
  sort / search / page state and the toolbar that edits it. Each item component
  subscribes to the context and decides for itself whether to render hidden
  (`hidden` attribute; the node stays mounted) and which CSS `order` to take.
  Sorting is expressed with `order` on the items inside a flex/grid parent, so
  the DOM order — which matches the Mapping query's sort — is never mutated.
- **Item components carry the data they need to be filtered as props** (a
  category id, a price number, a tag list, a date) even when the visible
  rendering does not show them. These props are ordinary contract fields
  filled by the Mapping.
- **Counts come from children.** "12 products", "3 results" and "page 2 of 3"
  are computed by the list component from the number of subscribed items, not
  from a prop.
- **Without a provider, an item renders normally.** An item component used
  outside its list (in the Composer canvas, or authored statically) must treat
  a missing context as "visible, natural order".
- **The Mapping query does the server-side share.** Category pages, tag pages
  and "featured" strips are separate attachments with query `conditions`
  (`equals` on a `reference`/`choice`/`slug` field, `contains` on a `list`
  field) and `sort`. Client-side filtering only narrows further within one
  page.

### What a Mapping can put into an item

A binding writes one **scalar** component prop (`text`, `select`, `number`,
`boolean`, `color`); structured props (`list`, `group`, `tuple`) are not
mapping targets (`structured-target-unsupported`). The compatibility matrix is
`src/mapping/resolver/compatibility.ts`. The projections the demo docs rely on:

| Need | Content field | Projection → transform | Target prop kind |
| --- | --- | --- | --- |
| Title, intro, body markdown, date text | `text` / `long-text` / `markdown` / `date` | `value` → `identity`, `truncate-160`, `date-medium` | `text` |
| Link to the entry's own page | `slug` | `value` → `prefix "/products/"` (or `/journal/`) | `text` (`href`) |
| Link to another entry's page | `reference` | `route-link` → `identity` | `text` (`href`) |
| Category / author id as a variant | `reference` | `reference-id` → `identity` | `select` (options = record ids) or `text` |
| Number (price, stock, columns) | `number` | `value` → `identity` | `number` |
| Flag (featured, published-in-nav) | `boolean` | `value` → `identity` | `boolean` |
| Image URL | `url` field holding `/uploaded-assets/asset-<id>` (nested in an `object` image field is fine: `object-field` projection) | `value` / `object-field` → `identity` | `text` (a prop named `src`, `href`, `poster` or `url`) |
| Image alt | `text` field beside the URL (same `object`) | `object-field` → `identity` | `text` |
| Tag list as filter data | `list<text>` | not bindable — see below | — |

Images: the asset pass (`src/site-project/assets/impact.ts`) recognises the
canonical authoring URL `/uploaded-assets/asset-<id>` in Content `url` fields
and in component props named `src` / `href` / `poster` / `url`, records the
reference for the exact-version Assets lock, and rewrites it to the immutable
`/uploaded-assets/sha256-….webp` URL at release. That is the only path from an
asset to an `<img>`. `asset-ref` projects the `{ providerId, assetId }` object
and `reference-list-ids` projects an id array; neither is accepted by any
scalar target (`incompatible-binding`), so the demo content models keep images
as `object { src: url, alt: text }` and expose related items through a second
attachment rather than a `reference-list` binding (tool gap tracked in #506;
the demos do not wait for it).

Lists inside an entry (tags, spec rows, feature bullets) that must reach a
component are flattened at authoring time into fixed scalar fields (`tag1`,
`tag2`, `tag3`; `spec1Label` / `spec1Value` …) — the demo-tools generator owns
that flattening, and the Content model keeps the real `list` / `object` field
for querying (`contains`) and for editors.

### Standard shapes used by every demo

```text
Catalog page composition (owned by a sitemap node)
└─ shop.product-grid            ← target node, declares slot "items"
   └─ slot items (many, accepts: ["shop.product-card"])
      ├─ (authored children: none)
      └─ attachment "catalog-cards" → Mapping "product-card" (collection)
           item composition "product-card" (detached)
           └─ shop.product-card ← root; every prop bound from the products model
```

- One item composition per list kind (product card, tier, article card,
  testimonial, FAQ item, comment). Several attachments may reuse it with
  different queries (all products; category = desk; featured = true).
- The list component's slot always names `accepts: [<item component id>]` so
  the compiler rejects a wrong item root before the browser does.
- A page that shows two lists owns two attachments on two different target
  nodes (home: featured grid + FAQ), never two on one slot.
