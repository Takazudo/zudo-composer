# Concrete route and navigation contract

Sitemap v3 requires independent `navigation.primary` and `navigation.footer`
arrays. Array order is menu order; item IDs, labels, visibility and destinations
are persisted independently of the page hierarchy. Empty menus are valid.
`editSitemapNavigation` updates one menu with exact post-removal insertion indices.
No older Sitemap schema is read or migrated.

`expandSitemapRoutes` prepares each authored node once, bounds depth and authored
size, and preflights the Cartesian route count before materialization. The hard
limit is 10,000 routes. Both static and generated descendants expand beneath
every concrete parent. Paths normalize Unicode NFC and reject encoded dot aliases.

Every route carries `selectedEntry` (provider/model/record), a display title,
and exact ancestor node/path/entry contexts. Compiler identities include stable
qualified context, not display titles. Breadcrumbs resolve these concrete paths,
never the first ready member of a repeated family.

`selected-entry` route mode binds a fixed collection entry to one authored path;
it validates ownership independently of the collection query selection. `single`
requires a singleton model and exactly one entry. `policy: "release"` is the safe
default and excludes drafts even if a saved Mapping query includes them.
`policy: "authoring-preview"` explicitly permits draft inclusion according to the
Mapping query; no boolean or route metadata can enable release drafts. Collection
attachment evaluation uses the same compiler policy and existing Mapping query API.

`resolveSitemapDestination`/`resolveSitemapNavigation` are headless. A route target
may qualify its entry and ordered generated ancestor selections. Multiple matches
are ambiguous; zero matches are stale. External destinations require absolute
HTTP(S) without credentials, controls or backslashes. Hidden items do not deliver.
Unsafe persisted items fail validation even when hidden.

Compiler route-link projection closures use the concrete current ancestor context
to disambiguate repeated collections. Ambiguity remains explicit when context is
insufficient. Compiled navigation and materialized collection links feed actual
visitor delivery. `SiteBuildPlan.activeSitemap` and the current document's `name`
remain the metadata seam for shell/Sitemap presentation; no presentation-specific
state is introduced here.
