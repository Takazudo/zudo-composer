# Global versioned Assets

Assets is independent of the four SiteProject providers. The development provider
persists one current schema (1) in `<assetsDir>/catalog.json`. That atomic file
contains records, logical folders, and a durable random `mutationToken`. There is
no migration reader, production authoring API, permanent purge, or version GC.

`AssetRecord.revision` protects mutable asset metadata. Its document contains
`fileName`, `folderId`, `note`, `state`, `currentVersionId`, and immutable
`versions`. `currentAssetVersion(record)` selects the head;
`summarizeAsset(record)` derives list metadata including both URLs and revision.
Version IDs equal their SHA-256 checksum. Reusing identical bytes reuses the
version, while still advancing metadata revision and the provider token.
Managed bytes live in private `<assetsDir>/versions`, outside Vite's publicDir.
Development exact URLs require catalog membership and verified bytes; direct
source and `/@fs` access to the assets store is blocked. Uncommitted crash artifacts
remain private and cannot enter Vite's public-directory copy. Production inputs
remain the committed static public assets until release compilation explicitly
selects a catalog-verified pin manifest and copies those exact private versions.

## MIME and delivery contract

`ASSET_KINDS` is the single allowlist. It currently contains PNG, JPEG, GIF, WebP,
PDF, ZIP, plain text, CSV, and JSON. Its extension map, file-picker `accept` value,
checksum URL patterns, and delivery policy are derived from the table. Signature
sniffing identifies the five image/PDF signatures and ZIP's `PK\x03\x04` header.
Plain text, CSV, and JSON have no byte signature, so they are accepted only when
their normalized declared MIME is one of those three entries. Office documents are
stored as `application/zip` in v1 when their container begins with the ZIP header;
the container contents are not inspected.

Every local, release, and hosted immutable URL sends its MIME type, byte length,
`Cache-Control: public, max-age=31536000, immutable`, and
`X-Content-Type-Options: nosniff`. Images and PDF are inline. ZIP and text kinds
send `Content-Disposition: attachment; filename="<checksum>.<extension>"`, using
the checksum already present in the URL. The mutable authoring URL redirects to
the immutable URL, so its final response follows the same policy.

## Consumer contract

- `snapshot()` reads the persisted `{schemaVersion, mutationToken, records,
  folders}` afresh. `mutationToken()` is a lightweight API convenience for that
  same persisted read, not a notification counter. Compare tokens around a
  candidate capture to detect concurrent Assets mutations.
- `updateMetadata(id, {fileName?, folderId?, note?}, precondition)`,
  `trash(id, precondition)`, and `restore(id, precondition)` return the updated
  record. Every precondition requires `expectedRevision`; optionally include
  `expectedMutationToken` to require the entire snapshot as well. A conflict
  requires a fresh read and explicit resolution, not an automatic overwrite.
- `createFolder({name, parentId}, expectedMutationToken)` returns a new folder.
  `updateFolder(id, {name?, parentId?}, precondition)`, `trashFolder`, and
  `restoreFolder` use the folder's own revision.
- The filesystem provider accepts `upload({fileName, declaredMimeType, bytes,
  folderId?, note?, expectedMutationToken?, signal?})` and
  `replace(id, {bytes, signal?, declaredMimeType?}, precondition)`. Bytes may be streamed. The browser
  provider accepts `upload(File, options?)` and `replace(id, Blob, precondition)`;
  its request body contains only bytes, with small encoded metadata in headers.
  Upload header metadata has an 8 KiB encoded limit; longer notes can be saved
  separately through `updateMetadata` (10,000 characters).
- `list({state?: 'active' | 'trash' | 'all', folderId?})` defaults to active
  assets. `get(id)` includes trash and reports missing or corrupted head bytes.
- `resolveVersion({providerId, assetId, versionId})` verifies exact retained bytes
  and returns a serializable `AssetVersionPin` containing the reference, checksum,
  size, MIME and immutable URL. `pinManifest(refs)` verifies and deduplicates
  references into a deterministically sorted `{schemaVersion: 1, pins}` manifest.
  Exact pins work for trashed assets and independently of the current head/token.
  A later compiler must verify/copy these pinned bytes into its immutable build.
- Authoring fields store `AssetAssetRef {providerId,assetId}`, not a version.
  `resolveCurrentAssetVersionRef(snapshot, asset)` selects the active head from
  one validated snapshot. Because `AssetSnapshot` is provider-neutral, this
  helper carries the asset's provider identity but cannot authenticate it;
  `resolveCurrentAssetVersionPin(store, asset)` validates that identity against
  the store before resolving, verifies the exact retained bytes, and re-reads
  the durable mutation token, returning a retryable conflict if Assets changed
  during capture. Release code should resolve all deduplicated stable refs from
  one snapshot, request an exact sorted pin manifest, and verify the token
  again before approving it.

`assetAuthoringUrl(id)` produces `/uploaded-assets/asset-<id>`. Development delivery
resolves it to the active head with a non-cacheable redirect. Immutable URLs use
`/uploaded-assets/sha256-<checksum>.<allowlisted extension>`. Renames and moves
change neither URL. Trashed assets do not resolve through the authoring URL;
retained exact-version URLs remain readable.

Folder IDs/parent IDs are opaque logical identities. Names never become disk
paths. `assetFolderPath(folders, id)` returns display segments only. Active sibling
folder names collide case-insensitively after NFC normalization. Cycles, missing
parents and active children under trashed ancestors are invalid. Folder trash is
explicitly non-recursive: first move or trash active child folders/assets. Trash
keeps parent IDs. Restore requires an active parent and a free sibling name, so
restore ancestors first. Asset display names may repeat within a folder; their
stable IDs distinguish them.

## Commit and recovery

Bytes are signature-checked, bounded to 25 MiB, hashed, and synced into a private
temporary file before metadata mutation. Publication uses an atomic hard link
that cannot overwrite an existing immutable byte path. Existing matching bytes
are integrity-checked and reused; corrupted bytes are never overwritten. A
kernel-exclusive `.mutation.lock` protects metadata across cooperating processes;
the per-record revision is checked again under that lock after streaming. The
new catalog and token switch together via one atomic rename. All failures before
that point leave the old catalog/head and old byte versions unchanged. A failed
catalog commit can leave private unreferenced immutable bytes; no GC removes
them. `put(record, bytes)` is a validated, create-only single-version import, not
a way around replacement CAS.

Directory fsync support is checked before any metadata mutation. Published byte
entries are synced before the catalog references them, and the catalog parent is
synced after rename before success is acknowledged. Unsupported/failed preflight
or byte-publication sync reports a typed write failure with the old catalog intact.
A failure syncing the parent after catalog rename reports non-retryable
`commit-uncertain`: the visible head may have changed, durability is unknown, and
the writer lock is retained. Inspect the exact catalog/token and filesystem state
before recovery; never treat this outcome as an unchanged head or blindly retry.

Reads remain possible while a writer holds the lock. A retained lock after a
crash fails closed: inspect `.mutation.lock`, confirm that no writer is running,
then manually remove only that lock before retrying. The provider never guesses
that a live lock is stale. A malformed/unsupported catalog reports recovery and
preserves the source and every version; automatic `clear`/`startFresh` is blocked.
The inherited `delete` operation means soft trash and rejects missing revision
preconditions; feature callers must use the explicit current trash contract.


## Download uses in Content and Markdown

A Content `asset-use` field can use the `download` presentation:
`{ kind: "download", asset: { providerId, assetId }, label, showSize, showType }`.
The label and visibility flags belong to that Content usage. ZIP and text assets
start with this presentation in the Assets picker; PDF keeps its Link default.

Map a Download field using **Download block** (`asset-download`) to the stock
ProseMd component's Markdown field. **Copy Markdown** on non-previewable assets
also produces a standalone managed download block, surrounded by blank lines for
pasting. Images and PDF retain their existing Markdown references.

The canonical block is `<!--zudo-asset-download:<URI-encoded JSON>-->`, where JSON
contains `use` with the exact download shape above. Use `assetDownloadMarkdown`
from `assets/integration/content` to construct it rather than hand-authoring it.
Only standalone top-level comment blocks are interpreted; code fences and inline
comments remain ordinary Markdown. Separate consecutive blocks with blank lines.

Capture resolves the explicit reference and adds a validated `resolved` object
with `url`, `fileName`, `mimeType`, and `byteLength`. The lock records display
filenames with the metadata revision; release always rewrites resolved fields
from that lock, so pasted metadata cannot override the captured asset. Renaming
or replacing an asset later leaves an earlier captured release unchanged. Legacy
locks without filenames still work for old image/link uses; downloads require a
new capture. Filename extensions come from the MIME allowlist, avoiding repeated
or stale known extensions while retaining meaningful dots in display names.

Composer preview, site delivery, and generated JSX render these blocks as native
`<a href="/uploaded-assets/sha256-…zip" download="display-name.zip">` elements.
Normal clicks fetch at most the Assets byte limit and download a temporary Blob
URL so the browser honors the human filename despite checksum-named server
attachment headers. The same self-contained handler is embedded in generated
JSX; it needs no private imports. Modified clicks retain native link behavior.
Failures are visible inside the link and can be retried; fetches time out, abort
on every exit, and temporary Blob URLs are revoked. Labels and attributes are
escaped by the normal JSX/DOM renderer. Other Markdown
chunks still go through the trusted pack's renderer and sanitizer. The supported
component seam has exactly one declared Markdown-source field and no slots (as
stock ProseMd does), so splitting never duplicates other fields or children. No
component is added to the stock chooser. Unsupported component shapes, malformed
blocks, and missing capture metadata block release instead of dropping downloads.

Direct JSX export of an unresolved authoring block is blocked with an actionable
Assets-resolution diagnostic. Captured site export contains exact links and
needs no asset provider at runtime. Only the compiler's internal authoring
inspection can temporarily generate unavailable placeholders before capture.
