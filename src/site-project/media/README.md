# Managed Media references

Media remains global, outside the four SiteProject provider domains. Authoring
documents retain typed asset identities or canonical `/uploaded-media/asset-ID`
URLs. `captureSiteProjectMediaLock` inspects a project and its authoring-preview
materializations, verifies retained bytes, and captures a sorted exact-version
lock. Capture failures return diagnostics; incomplete impact is not authoritative.

`createMediaReferenceLock` records the immutable checksum, MIME, byte size and URL
alongside the captured asset revision, head and catalog mutation token.
`checkMediaLockPreconditions` checks live publication preconditions;
`verifyMediaLockIntegrity` verifies only exact historical versions, never latest.
`serializeMediaReferenceLock` produces canonical JSON. Release callers pass the
lock explicitly to `compileSiteProject`; required managed references without pins
block compilation. The compiler never fetches a mutable Media head itself.

`resolveSiteProjectMedia` and `inspectSiteProjectMedia` expose provider-qualified
Content fields, Composition properties, Markdown source ranges, rendered routes,
and materialization source nodes plus entry chains. Supported string destinations
are declared `src`, `href`, `poster`, and `url` properties and Content URL fields.
Markdown uses the CommonMark syntax tree, including used reference definitions;
only destination spans change. Arbitrary prose/code/HTML and external URLs are
preserved. Unsupported managed-looking text makes destructive impact incomplete;
external/unrecognized references remain advisory. Immutable URLs never retarget.

`createProjectMediaUsageInspection` supplies the injected authoritative impact
service. It compares exact serialized project revisions and coalesces in-flight
reads. Content-only usage cannot authorize trash. App invalidation subscribes to
the four project domains and active workspace metadata, not Media/session writes.

Preview hosts resolve detached snapshots before crossing the iframe boundary.
`LiveMediaReferenceResolver` shares event invalidation and clears stale heads;
unavailable/corrupt managed assets hide the unresolved preview. Canvas edit mode
retains canonical source values so inline editing cannot persist a pinned rewrite.
These changes do not add iframe capabilities, authoring endpoints, byte export,
or release storage; release capture/publication must use the exported checks.
