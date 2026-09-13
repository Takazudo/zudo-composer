# Disposable editor artifact contract

Each host builds `dist-editor/demo-editor-manifest.json` with schema version 1
and mode `disposable-demo-editor`. `hostId` is the host's package name (for
example `demo-webshop`); `projectId` is the bundled SiteProject's id.
`sourceRevision` is the full Git SHA of the tool checkout, while
`projectSourceRevision` is the SHA-256 of the canonical bundled SiteProject.

`assets` maps each immutable `uploaded-assets/sha256-…` path to its `sha256`,
`byteLength`, and `mimeType`. `files` hashes every emitted file except the
manifest itself, including deployment `_headers` and `demo-editor-seed.json`.
The verifier requires exact equality between the files on disk, `files`, the
uploaded paths in `assets`, and the versions referenced by the bundled seed.
There is no fixed asset count. Shared version URLs ship once; conflicting
metadata for a shared version fails preparation.

The snapshot comes from the selected host's configured Assets catalog. Every
active record keeps **all** its immutable versions, including historical ones.
Every active folder is kept, including empty folders, to preserve authored
organization. Catalog validation guarantees that active records and folders
have active ancestors. Trash and unreferenced bytes are omitted, and the
disposable snapshot starts with a zero mutation token. Display filenames do
not select bytes or constrain the historical versions' MIME types.

`demo-editor-seed.json` contains the same project, component-pack metadata and
active asset snapshot injected into the client, plus the host id. During both
manifest creation and verification, trusted tool code validates that JSON and
the uploaded bytes, then compiles its project with the same captured-asset
release policy as the editor's working site preview. It never imports code
from the artifact. The resulting site routes, prefixed with `/site`, plus the
authoring routes (including `/review` and `/website-preview`) must equal the
manifest's `routes`. Editor live checks consume this verified list. Local host
and packed-install site proofs continue to use their own verified static-site
manifests; they have no dependency on an editor build or a central route list.

Every emitted JavaScript chunk is scanned for server/filesystem/test markers,
including chunks outside the preview graph. A small set of ambiguous words
(`styleguide`, `.stories`, `/src/`, `projects/`, `builds/`) is permitted in pack
prose and source metadata, while executable code and module imports retain
those exclusions. Server capabilities such as `node:fs` and
`server/site-project-local` remain forbidden throughout emitted JavaScript.
The preview import graph additionally rejects authoring-UI markers.
