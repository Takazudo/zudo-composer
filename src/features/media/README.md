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

`createMediaContentServices` is a headless domain adapter injected by App. It
flushes workspace sessions and scans whole Content provider snapshots, including
nested structured uses. Trash requires a complete scan without typed uses and
rechecks Content tokens immediately before each asset write. Content and Media
are separate stores, so these checks are not a cross-domain atomic transaction.
Raw URL/Markdown references remain advisory and never establish non-use.
The injected `subscribeChanges` observes authoritative Content provider tokens
every second (including external writes/read failures) and invalidates displayed
usage scans. Each display is a captured snapshot, not a continuous atomic claim.

`MediaFieldPicker` emits an awaited typed `MediaUse` callback to the invoking
field; that field owns persistence. Route insertion uses Content transactions.
Image alternative text/caption, link labels, and card text belong to each usage,
not the Media note. Both insertion paths recheck current asset availability.

Usage navigation is injected as `usageHref(MediaContentLocation)`. Media supplies
provider/model/entry/field identities and a field-relative typed `valuePath`.
App owns URL formatting and omits an empty path for top-level fields. Content
owns deep selection, focus, and stale-target feedback.

The browser-dev Media test uses synthetic real bytes and actual providers;
cleanup soft-trashes its own records and does not purge retained versions.
