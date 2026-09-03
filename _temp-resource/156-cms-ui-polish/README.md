# zudo-composer — CMS UI proposal prototypes

Standalone HTML prototypes (no build step). Open `index.html` in a browser, or any page directly.
The bottom-right widget on every page switches **Sidebar / Top** navigation and **Light / Dark** theme; the choice persists in localStorage.

| File | Proposal |
| --- | --- |
| `index.html` | Findings from the current build, shared rules, before/after gallery, suggested production order |
| `01-dashboard.html` | Home as a dashboard: counts, recent activity, needs-attention, storage |
| `02-library.html` | One library pattern (header → toolbar → table → row menu / bulk bar / empty + recovery states), shown for Compositions, Mappings, Sitemaps |
| `03-composer-editor.html` | Composer on the shared editor chrome; inspector tabs Properties / Slots / Reuse; Add-component palette |
| `04-content-editor.html` | Content: Entry / Schema switch, real field widgets, field table + type popover, preview in inspector |
| `05-mapping-editor.html` | Mapping as a binding board: one row per binding, inline diagnostics, unbound targets |
| `06-sitemapper-editor.html` | Sitemapper: assignment status in tree and canvas; Page source as None / Composition / Mapping |
| `07-media-library.html` | Media: search, type filter, sort, grid/list, compact drop strip, detail panel with copyable references |

Tree pattern: every navigator tree uses the `.ztree` outline primitive in `proto.css` (contract documented in a comment block there), modelled on the zudo-doc outline: no row icons, » category mark, dashed connectors, mono slug column with Show slug / Show count toggles, inline Add rows, and a hover-the-gap insert affordance (`proto.js` injects `.ztree-insert` between siblings; `+` and Add rows open an inline title input).

Shared files: `proto.css` (tokens mirror `src/styles/app-tokens.css`, primitives, shell, editor pattern), `shell.js` (injects the rail and the widget), `proto.js` (menus, tabs, resizers, dialogs, collapse), `icons.js` (inline 16px sprite).

`screenshots-current/` = the production build on 2026-09-03 at 1440×900. `screenshots-proposal/` = these pages in side / top / dark / mobile variants.
