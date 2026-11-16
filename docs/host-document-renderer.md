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
