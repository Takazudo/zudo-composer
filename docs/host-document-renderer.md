# Trusted host document renderer

A host whose production components use a runtime other than Preact can opt into
whole-document preview. Per-component `adapters.render` remains Preact-specific.
The host document adapter is trusted installed code; model responses cannot
select modules or supply executable HTML.

```ts
hostDocument: {
  module: "my-site/renderer",
  rendererId: "my-site-production",
  rendererVersion: "1",
},
authoringAuthority: "workspace",
nativeEditing: { source: "workspace" },
```

The public/self-export module exports `renderDocument(input)`, returning a complete
HTML document. Input contains the compiled `route`, coherent captured `project`,
`identity`, and `targets`. Use the same production route renderer and stylesheet
as the static build. Annotate existing semantic roots with
`data-composer-target="<rendered node id>"`; do not introduce layout wrappers.
A fragment may mark multiple existing roots with the same target. Route-aware and
position-dependent behavior remains the host renderer's responsibility.

Preview identity binds workspace, capture revision, route, pack, renderer version
and renderer source digest. Only the current iframe source/origin and exact frame
identity can acknowledge the document or select an owner. The tool adds its
selection bridge only to authoring output. Static rendering must call the host
adapter without adding that bridge. Host CSS stays inside the iframe.

Open **Edit page** from Composer or **Open page** from Sitemap routes. The saved
snapshot is captured only after the native browser coordinator checks authoring
sessions and holds the authoring lease. The tree and inspector use the same
qualified `{providerId, recordId, nodeId}` target as the rendered element.
Linked template/local IDs are namespaced in a detached render copy; canonical IDs
are preserved. A changed workspace invalidates the preview.

The host inspector supports explicit typed property saves and same-slot sibling
reordering for local compositions. It validates through Composition commands,
recompiles the complete project, and commits canonical JSON/derived source/receipt
through the reviewed-edit journal with an exact snapshot token. Mapping-owned
source compositions and linked/global template structure are refused here. Bound
values link to their Content owners instead of becoming shadow props. Pending
requests are retained in browser-profile local storage before transmission, scoped
by origin, browser actor, workspace and renderer/pack identity. Each operation has
its own immutable pointer so tabs cannot overwrite one another. A new browser
session can explicitly recover an earlier request with the same operation ID;
recovery is never automatic. A later guard refusal does not erase an uncertain
original request. Receipt storage precedes pointer removal. Unavailable storage
disables saving. This survives browser restart when that profile retains local
storage; clearing browser data removes its recovery pointers, not server receipts.

This initial host document route does not yet implement structural insertion,
guarded Undo, mixed-domain proposals, or host-rendered Assistant candidates.
Those must be accepted separately before claiming full authoring adoption.

A mapped root can expose a separate **page placement** when its immediate
unmaterialized parent is a placeholder in the route's local Composition. The
`reorder-placement` operation moves that entire local placeholder within its
parent slot. The server derives the placement from the reviewed route and source
target; callers cannot supply arbitrary placement coordinates. The inspector
names the placement owner separately from the shared source. Nested shared
children have no such local placement, and shared Content, Mapping templates and
shared Composition bytes retain their existing mutation guards.

### Host JSX runtime

Set `hostDocument.jsxImportSource` to the host framework’s public JSX runtime prefix when its renderer imports TSX. The default is `@takazudo/zfb/zudo-react`, the runtime Composer itself uses. Composer evaluates this trusted server renderer in a separate module graph with the declared runtime, so the editor’s graph and previously loaded component pack cannot rewrite or cache its component output. The configured runtime is covered by the attested configuration file in renderer identity. This does not change Composer’s own UI or component-pack runtime.

### Component hierarchy

The page tree follows rendered parent and named-slot relationships, including local page roots inside a linked template outlet. Labels use the installed component manifest’s titles; canonical IDs and qualified owners remain available in inspector details. Expand contextual containers to reach their children, or select a rendered component to reveal all of its ancestors automatically. Arrow keys navigate and expand the tree; Enter or Space selects the exact owner. No component is omitted by a guessed prominence rule. Packs without semantic prominence metadata still expose their wrappers as contextual, initially collapsed branches; reducing excessive wrappers and mapping fragments remains part of the Pinsel T4 model normalization.

### Visitor navigation inside authoring

Captured previews are served at their actual route paths with short-lived opaque token queries with `Cache-Control: no-store`. The in-memory cache is bounded and performs no live canonical reads on GET. Before any host script runs, a trusted head bootstrap restores the real visitor pathname, query and fragment using the History API, removing only the transport token added to the request. The real request pathname also preserves relative asset resolution during speculative browser preloads; no synthetic `<base>` is inserted. The initial frame URL also carries the fragment so native anchor scrolling remains available. Host scripts therefore read their normal `location` values, including stable `?course=` references.

In Browse mode, same-origin links to captured routes request a fresh exact route capture through the guarded bridge. Same-page fragments scroll normally. The native-page editor URL retains the visited path/query/fragment in its validated `visitor` parameter so an authoring reload reopens that route. Assistant and ordinary Composition links reject this parameter. The source, origin, frame, full capture identity and current visitor URL are checked; destinations must belong to the captured route inventory. A single trailing slash may identify the same captured directory route (for example, `/lessons/` resolves to `/lessons`); explicit exact matches win and file outputs such as `/404.html` do not gain directory aliases. The visitor URL itself retains its slash, query and fragment. Unexpected loads, external navigation and programmatic departures revoke the old selection. Only the issued document marker, expected full URL and exact ready acknowledgement can restore editing. Refresh the saved page after leaving the captured preview. External delivery and form submission are not authorized by this navigation feature.
