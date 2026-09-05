# Global versioned Media

Media is independent of the four SiteProject providers. The development provider
persists one current schema (2) in `media-store/catalog.json`. That atomic file
contains records, logical folders, and a durable random `mutationToken`. There is
no migration reader, production authoring API, permanent purge, or version GC.

`MediaRecord.revision` protects mutable asset metadata. Its document contains
`fileName`, `folderId`, `note`, `state`, `currentVersionId`, and immutable
`versions`. `currentMediaVersion(record)` selects the head;
`summarizeMedia(record)` derives list metadata including both URLs and revision.
Version IDs equal their SHA-256 checksum. Reusing identical bytes reuses the
version, while still advancing metadata revision and the provider token.
Managed bytes live in private `media-store/versions`, outside Vite's publicDir.
Development exact URLs require catalog membership and verified bytes; direct
source and `/@fs` access to `media-store` is blocked. Uncommitted crash artifacts
remain private and cannot enter Vite's public-directory copy. Production inputs
remain the committed static public assets until release compilation explicitly
selects a catalog-verified pin manifest and copies those exact private versions.

## Consumer contract

- `snapshot()` reads the persisted `{schemaVersion, mutationToken, records,
  folders}` afresh. `mutationToken()` is a lightweight API convenience for that
  same persisted read, not a notification counter. Compare tokens around a
  candidate capture to detect concurrent Media mutations.
- `updateMetadata(id, {fileName?, folderId?, note?}, precondition)`,
  `trash(id, precondition)`, and `restore(id, precondition)` return the updated
  record. Every precondition requires `expectedRevision`; optionally include
  `expectedMutationToken` to require the entire snapshot as well. A conflict
  requires a fresh read and explicit resolution, not an automatic overwrite.
- `createFolder({name, parentId}, expectedMutationToken)` returns a new folder.
  `updateFolder(id, {name?, parentId?}, precondition)`, `trashFolder`, and
  `restoreFolder` use the folder's own revision.
- The filesystem provider accepts `upload({fileName, declaredMediaType, bytes,
  folderId?, note?, expectedMutationToken?, signal?})` and
  `replace(id, {bytes, signal?}, precondition)`. Bytes may be streamed. The browser
  provider accepts `upload(File, options?)` and `replace(id, Blob, precondition)`;
  its request body contains only bytes, with small encoded metadata in headers.
  Upload header metadata has an 8 KiB encoded limit; longer notes can be saved
  separately through `updateMetadata` (10,000 characters).
- `list({state?: 'active' | 'trash' | 'all', folderId?})` defaults to active
  assets. `get(id)` includes trash and reports missing or corrupted head bytes.
- `resolveVersion({providerId, assetId, versionId})` verifies exact retained bytes
  and returns a serializable `MediaVersionPin` containing the reference, checksum,
  size, MIME and immutable URL. `pinManifest(refs)` verifies and deduplicates
  references into a deterministically sorted `{schemaVersion: 1, pins}` manifest.
  Exact pins work for trashed assets and independently of the current head/token.
  A later compiler must verify/copy these pinned bytes into its immutable build.
- Authoring fields store `MediaAssetRef {providerId,assetId}`, not a version.
  `resolveCurrentMediaVersionRef(snapshot, asset)` selects the active head from
  one validated snapshot. Because `MediaSnapshot` is provider-neutral, this
  helper carries the asset's provider identity but cannot authenticate it;
  `resolveCurrentMediaVersionPin(store, asset)` validates that identity against
  the store before resolving, verifies the exact retained bytes, and re-reads
  the durable mutation token, returning a retryable conflict if Media changed
  during capture. Release code should resolve all deduplicated stable refs from
  one snapshot, request an exact sorted pin manifest, and verify the token
  again before approving it.

`mediaAuthoringUrl(id)` produces `/uploaded-media/asset-<id>`. Development delivery
resolves it to the active head with a non-cacheable redirect. Immutable URLs use
`/uploaded-media/sha256-<checksum>.<signature-derived extension>`. Renames and moves
change neither URL. Trashed assets do not resolve through the authoring URL;
retained exact-version URLs remain readable.

Folder IDs/parent IDs are opaque logical identities. Names never become disk
paths. `mediaFolderPath(folders, id)` returns display segments only. Active sibling
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
