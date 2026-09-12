# Demo sites

zudo-composer is an installable authoring tool; a website built with it is a
**host project**. The three demo sites under `packages/demo-*` are such host
projects kept as workspace members of this repository, so the tool is exercised
the way a real host exercises it — through its `bin`, its `zudo-composer/config`
subpath and a host-owned component pack — without any of them leaking into the
published package.

| Package | Site | Token namespace | One-off dev port |
| --- | --- | --- | --- |
| `packages/demo-webshop` | `demo-shop.zudolab.dev` | `shop-` | 4181 |
| `packages/demo-landing` | `demo-landing.zudolab.dev` | `land-` | 4182 |
| `packages/demo-blog` | `demo-blog.zudolab.dev` | `blog-` | 4183 |

`packages/demo-tools` is the private helper every demo depends on. It is not a
host; it is this repository's authoring, generation and seeding tooling, and it
imports the tool's own `src/` directly.

## What a demo package is

Each demo is a complete host in the **self-reference** pack shape
(`fixtures/self-host` is the minimal model; README section "Component packs and
themesets" explains the rule):

```text
packages/demo-<name>/
├── package.json               name "demo-<name>", exports {"./components": "./components/pack.ts"}
├── zudo-composer.config.ts    pack: "demo-<name>/components" via `zudo-composer/config`
├── components/
│   ├── pack.ts                defineComponentPack({ packId: "demo-<name>", ... })
│   └── *.tsx                  the host's own Preact components
├── styles/base.css            Tailwind preflight + utilities, one @theme namespace, @source "../components"
├── site-project.ts            the authored site, written with demo-tools
├── site-project.json          generated from site-project.ts; committed; guarded by a test
├── images-src/manifest.json   source images to seed into the Assets store
├── cms/assets/                the committed Assets store (catalog.json + versions/)
├── public/uploaded-assets/    publicAssetsDir (kept with .gitkeep)
├── __tests__/                 currency test, pack assertions, component render tests
└── README.md
```

Rules that fall out of the tool's contract, and that the package tests assert:

- `pack` and every `source.module` are exactly `demo-<name>/components`; no
  exported subpath contains a `src` segment; `exports` targets are plain strings
  because the pack is resolved with `createRequire`.
- The pack imports nothing from `@zudo-sg/ui`. A demo owns its whole themeset.
- Tailwind v4 runs with **no default theme**: only `tailwindcss/preflight` and
  `tailwindcss/utilities` are imported, so every utility a component uses must
  come from a token in the package's own `@theme` block. Tokens live in one
  namespace per demo (`--color-shop-*`, `--color-land-*`, `--color-blog-*`).
- `site-project.json` is never edited by hand. `pnpm generate` is the only
  writer; the package test fails while the committed file is stale.
- Every setting except `pack` keeps its default, so `cms/` is `dataDir` and
  `public/uploaded-assets` is `publicAssetsDir`, exactly as in a fresh host.

## generate → seed → dev

```sh
corepack pnpm --filter demo-webshop generate
corepack pnpm --filter demo-webshop seed
corepack pnpm --filter demo-webshop dev -- --port 4181
```

1. **generate** (`demo-tools generate`) imports `site-project.ts`, builds the
   SiteProject aggregate, validates it against the package's pack manifest with
   the tool's own `validateSiteProject`, and writes `site-project.json` as
   canonical JSON (sorted keys, compact, trailing newline — the same form as
   `src/test/site-project-fixture.json`). Validation failures list the
   diagnostics and write nothing.
2. **seed** (`demo-tools seed`) runs two idempotent steps:
   - `seedAssets`: uploads every `images-src/manifest.json` entry into
     `cms/assets` through the filesystem Assets store, skipping any file whose
     name and checksum already exist — active, trashed or historical — so an
     author's edits are never undone.
   - `seedRelease`: activates `site-project.json` through
     `zudo-composer release` (see below).
3. **dev** boots the authoring server rooted at the package. `/site` delivers
   the activated release, `/composer` and the other authoring routes edit the
   host's CMS data. Several children may boot demos concurrently, so always pass
   the package's port from the table above and stop the server when done.

Ordinary Assets edits under `pnpm dev` dirty `cms/assets/catalog.json`. That is
by design, as the root README says of the repository's own dogfood store: the
Assets store is the one CMS directory a host commits.

## How `zudo-composer release` is used

On-disk CMS records are a transactional pointer format, so the demos never
write them. `seedRelease(packageRoot)` spawns the installed bin —
`node_modules/zudo-composer/bin/zudo-composer.mjs release`, resolved from the
package's own `package.json` — **with cwd set to the package root**, because
`release` has no `--root`: the host is resolved from the working directory and
only `ZUDO_ASSETS_STORE_ROOT` is env-overridable. Each call is one JSON request
on stdin and one canonical JSON response on stdout, in the sequence
`scripts/run-site-project-browser.mjs` drives:

1. `list` — read the project's current head revision and the active triple;
   both are CAS preconditions the store compares verbatim.
2. `plan` — the whole aggregate plus a selection that **publishes every content
   entry**, with `expectedRevision` and `expectedActive` from step 1 (`null`
   before the first release).
3. `apply` — the exact plan; returns `revision` and `buildId`.
4. `build` — compiles the pinned candidate.
5. `activate` — swaps the active pointer under the same CAS precondition.

Release state lands in `.zudo-site-project/` under the package and the
published records in `cms/{compositions,content,mappings,sitemaps}/`; all of it
is gitignored and regenerable by re-running `seed`. Re-seeding an already
activated package replaces the active release rather than failing. The full
protocol is documented in [`docs/site-project.md`](../site-project.md).

## Authoring with `demo-tools`

```ts
import { defineSite, node } from "demo-tools";
import { componentPack } from "./components/pack";

const site = defineSite({ id: "demo-blog", name: "Demo Blog", componentPack });

const frame = site.template({
  name: "Site frame",
  root: [node("blog.frame", {}, {}, "frame")],
  outlet: { target: { parentId: "frame", slotId: "content" } },
});
const articles = site.model({
  name: "Articles",
  kind: "collection",
  fields: [{ key: "heading", kind: "text" }, { key: "publishedOn", kind: "date" }, { key: "slug", kind: "slug" }],
});
site.entry(articles, { values: { heading: "First post", publishedOn: "2026-09-01", slug: "first-post" } });

const card = site.page({ name: "Article card", root: [node("blog.card", { title: "" }, {}, "card")] });
const cards = site.mapping({
  name: "Article card mapping",
  model: articles,
  composition: card,
  mode: { kind: "collection", sort: [{ field: "publishedOn", direction: "desc" }] },
  bindings: [
    { field: "heading", nodeId: "card", prop: "title" },
    { field: "slug", nodeId: "card", prop: "href", transform: { kind: "prefix", prefix: "/journal/" } },
  ],
});
const journal = site.page({ name: "Journal", template: frame, root: [node("blog.grid", {}, {}, "journal-grid")] });
site.attach(cards, { nodeId: "journal-grid", slotId: "items" });

const home = site.page({ name: "Home", template: frame, root: [node("blog.hero", { heading: "Welcome" })] });
const homeRoute = { title: "Home", page: home, children: [{ title: "Journal", slug: "journal", page: journal }] };
site.sitemap({ name: "Demo Blog sitemap", root: homeRoute, navigation: { primary: [homeRoute].map((route) => ({ route })) } });

export default site;
```

- Ids are derived from names (`"Article card"` → `article-card`) and field ids
  from `<modelId>-<key>`; pass `id` to pin one. Node ids default to
  `<compositionId>-<componentId>-<n>`; give any node a mapping targets an
  explicit id, as above.
- Content entries are keyed by field **key**; `Model.fieldId(key)` is the
  translation every mapping, query and sitemap route uses.
- `attach(mapping, { nodeId, slotId })` materialises a **collection** mapping's
  composition once per entry into a named slot of `nodeId`. The owner
  composition is found among the pages declared so far (pass
  `target.composition` if a node id is reused). The mapped composition must be
  detached (no template), the slot's `accepts` must admit the mapped root, and
  one attachment per slot — the compiler refuses anything else.
- `route: "entry-field"` on a mapping route gives one page per entry, addressed
  by that field (a `slug`) and titled by `titleField` (defaults to the model's
  first `text` field).
- `assertSiteProjectCurrent(packageRoot)` is the currency test; each demo's
  `__tests__/site-project.test.tsx` calls it.

## Gate wiring

- **TypeScript.** Each demo package and `packages/demo-tools` has its own
  `tsconfig.json` (Preact JSX, Bundler resolution) referenced from the root
  `tsconfig.json`; `tsconfig.app.json` deliberately includes only `src` and the
  image editor. Every `packages/demo-*/zudo-composer.config.ts` is named in
  `tsconfig.host-config.json`, the one program that resolves
  `zudo-composer/config` the way a host does.
- **Vitest.** A third project, `demos`, collects
  `packages/demo-*/**/*.test.{ts,tsx}` in a Node environment with the Preact JSX
  runtime and none of the `app` project's `virtual:*` aliases, which a host pack
  must never depend on; the `app` project excludes `packages/demo-*/**`.
  Component render tests use `preact-render-to-string`.
- **ESLint.** `eslint .` covers the packages with the root config; only the
  `packages/*/bin/**/*.mjs` Node globals were added.
- **Packaging.** The root `files` allowlist already keeps `packages/demo-*` out
  of the tarball; `scripts/check-package-conformance.mjs` now asserts it.
- **Install.** The lockfile was regenerated once for the new workspace members;
  `corepack pnpm install --frozen-lockfile` must pass afterwards.
- **Browser lanes** are not run by implementation tasks. The demos lane (port
  4176) and the static build lane (4177) belong to later tasks in the epic.

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
