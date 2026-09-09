# Managed Assets references

Assets remains global, outside the four SiteProject provider domains. Authoring
documents retain typed asset identities or canonical `/uploaded-assets/asset-ID`
URLs. `captureSiteProjectAssetLock` inspects a project and its authoring-preview
materializations, verifies retained bytes, and captures a sorted exact-version
lock. Capture failures return diagnostics; incomplete impact is not authoritative.

`createAssetReferenceLock` records the immutable checksum, MIME, byte size and URL
alongside the captured asset revision, head and catalog mutation token.
`checkAssetLockPreconditions` checks live publication preconditions;
`verifyAssetLockIntegrity` verifies only exact historical versions, never latest.
`serializeAssetReferenceLock` produces canonical JSON. Release callers pass the
lock explicitly to `compileSiteProject`; required managed references without pins
block compilation. The compiler never fetches a mutable Assets head itself.

Live visitor delivery and Mapping attachment previews use
`compileWithCapturedAsset`. Visitor delivery with Assets uses the production
aggregate `captureWorkspace` project and Assets snapshot, constructs the lock from
that snapshot, and invokes `isCaptureCurrent` around compilation. There is no
second project or Assets snapshot capture to select newer versions. Assets-absent
static visitor output is explicitly `consistency: "detached"`, not release-current.
Mapping previews are also detached preflight. Attachment creation compares its
persisted baseline separately from the unpersisted candidate under the workspace
lock, checks exact Assets integrity/token, then performs the metadata CAS update.
It never compares candidate serialization to the persisted baseline. Failure
blocks without recapturing latest or retrying implicitly.
Identityless URLs always use that injected provider identity; impact inspection
without the identity is incomplete. Malformed or unsupported managed-looking
values block release and preview, even when no valid reference was collected.
Already immutable preview URLs remain exact and need no mutable provider lookup.

`resolveSiteProjectAsset` and `inspectSiteProjectAsset` expose provider-qualified
Content fields, Composition properties, Markdown source ranges, rendered routes,
and materialization source nodes plus entry chains. Supported string destinations
are declared `src`, `href`, `poster`, and `url` properties and Content URL fields.
Markdown uses the CommonMark syntax tree, including used reference definitions;
only destination spans change. Arbitrary prose/code/HTML and external URLs are
preserved. Unsupported managed-looking text makes destructive impact incomplete;
external/unrecognized references remain advisory. Immutable URLs never retarget.

`createProjectAssetUsageInspection` supplies the injected authoritative impact
service. It compares exact serialized project revisions and coalesces in-flight
reads. Content-only usage cannot authorize trash. App invalidation subscribes to
the four project domains and active workspace metadata, not Assets/session writes.

Preview hosts resolve detached snapshots before crossing the iframe boundary.
`LiveAssetReferenceResolver` shares event invalidation and clears stale heads;
unavailable/corrupt managed assets hide the unresolved preview. Canvas edit mode
retains canonical source values so inline editing cannot persist a pinned rewrite.
These changes do not add iframe capabilities, authoring endpoints, byte export,
or release storage; release capture/publication must use the exported checks.
