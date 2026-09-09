# Media workspace

The workspace reads the configured global Media provider. An absent provider is
an unavailable authoring surface, never a fixture-backed library. Mutations use
the provider's explicit capabilities and revision preconditions. Replacement
retains stable asset identity and historical immutable versions; trash retains
records and bytes. Uncertain acknowledgement or a failed post-commit refresh
disables further writes until deliberate authoritative reload succeeds; this
does not bypass any storage-level recovery lock. Uploads in either state cannot
be blindly retried. Workspace save sessions retain pending writes after unmount
and drain edits accepted during saves before resolving the barrier.

Folder insertion and movement use an exact sibling index plus the captured
catalog mutation token. Folder IDs are logical identities, not disk paths.

`createAssetContentServices` is a headless domain adapter injected by App. It
flushes workspace sessions and scans whole Content provider snapshots, including
nested structured uses. Trash requires a complete scan without typed uses and
rechecks Content tokens immediately before each asset write. Content and Media
are separate stores, so these checks are not a cross-domain atomic transaction.
Raw URL/Markdown references remain advisory and never establish non-use.
The injected `subscribeChanges` shares project-usage persistence hints across
active inspector and trash-dialog surfaces. Those scans read Content,
Compositions, Mappings, Sitemaps, and workspace metadata, so each authoring
domain invalidates them. No asset selected means no inspector subscription;
the last subscriber releases the source. Hints remain wide across workspaces
because they carry only a domain. Media/session events do not trigger these scans. Events
invalidate scans without polling or reading the graph. Active surfaces share
one cached scan per asset/event, including its in-flight promise; guarded trash
execution forces a fresh authoritative scan and rechecks mutation tokens.

`MediaFieldPicker` emits an awaited typed `AssetUse` callback to the invoking
field; that field owns persistence. Route insertion uses Content transactions.
Image alternative text/caption, link labels, and card text belong to each usage,
not the Media note. Both insertion paths recheck current asset availability.

Usage navigation is injected as `usageHref(AssetContentLocation)`. Media supplies
provider/model/entry/field identities and a field-relative typed `valuePath`.
App owns URL formatting and omits an empty path for top-level fields. Content
owns deep selection, focus, and stale-target feedback.

The browser-dev Media test uses synthetic real bytes and actual providers;
cleanup soft-trashes its own records and does not purge retained versions.
