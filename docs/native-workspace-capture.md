# Native workspace capture and exact static input

A host opting into `authoringAuthority: "workspace"` owns one selected native
workspace. Root `site-project.ts` and `site-project.json` may remain historical
import inputs; they are not the build authority for this mode. The ordinary
source generation and seeding commands refuse this authority. Initialize a new
staged workspace explicitly with `initializeAuthoringWorkspace` and verify it
before selecting it as the owner's active workspace.

Initialization writes the four native filesystem stores in stages and completes
the workspace registry last. It is not one cross-domain database transaction and
does not configure hybrid D1 Content with filesystem structure. A ready workspace
is never reseeded by capture. Missing or malformed state requires recovery.

## Save, stop, capture, review, build

The offline API acquires the same exclusive authoring lease as the editor. Save
all browser tabs and stop the editor before running it. A live editor causes an
`authoring-busy` error; an offline process cannot flush another browser's pending
input. The live host-document integration must flush browser sessions and invoke
capture within its existing coordinated authoring lease.

```js
import { writeFile, readFile } from "node:fs/promises";
import { loadHostContext } from "zudo-composer/vite";
import {
  captureAuthoringWorkspace,
  isAuthoringWorkspaceSnapshotCurrent,
  resolveAuthoringPackIdentity,
  resolveAuthoringRendererIdentity,
} from "zudo-composer/authoring";
import { compileAuthoringWorkspaceSnapshot } from "zudo-composer/site-build";

async function inputs() {
  const host = await loadHostContext({ workspaceRoot: process.cwd() });
  return {
    composerConfig: host.composerConfig,
    pack: host.pack,
    packIdentity: await resolveAuthoringPackIdentity(host),
    renderer: await resolveAuthoringRendererIdentity(host),
  };
}

const snapshot = await captureAuthoringWorkspace(await inputs());
await writeFile("reviewed-workspace.json", JSON.stringify(snapshot));
// Review snapshot.digest and the rendered routes before authorizing a build.
if (!await isAuthoringWorkspaceSnapshotCurrent(await inputs(), snapshot)) {
  throw new Error("Authoring changed since review; capture and review again.");
}

// This can run in a fresh process. Never recreate the snapshot from live files.
const reviewed = JSON.parse(await readFile("reviewed-workspace.json", "utf8"));
const compiled = await compileAuthoringWorkspaceSnapshot({
  ...await inputs(), snapshot: reviewed,
});
// Render compiled.build.routes with the host's production document renderer.
// Write compiled.assetFiles to their exact fileName paths beneath build output.
// Do not copy live public assets over the captured files afterward.
```

Retain the reviewed digest separately with the review receipt. A digest checks
integrity, not authorization: replacing both a snapshot and its digest is a new
candidate requiring review. Snapshot files contain authoring data and recovery
material; keep them out of public output.

Capture uses the existing before/embedded/after durable token barrier across
workspace metadata, Composition, Content, Mapping, Sitemap and Assets. It refuses
incoherent captures and verifies current tokens after reading immutable asset
bytes. Content and the transactional stores retain generation tokens across an
edit/revert; Composition's token represents canonical record bytes. Do not use
capture as a replacement for guarded editing receipts or operation history.

## Renderer and public asset identity

Configure `hostDocument` with its public package module, renderer ID and version.
`resolveAuthoringRendererIdentity` additionally hashes the actual resolved source
graph, including dependencies, config and styles. Human-readable versions alone
are not evidence of unchanged runtime code. `resolveAuthoringPackIdentity` binds
the installed component pack, the compiler source identity and component-contract
digest. Resolve identities again when reviewing or building; never manufacture
them from labels or reuse an identity after changing code. Restart a running
renderer when its source graph changes so cached modules cannot masquerade as new
source bytes.

Managed Assets are captured with their exact version lock, checksums and byte
payloads. For committed public files, configure an explicit host-relative
`hostDocument.publicDir`, such as `.native-public`. Capture walks only that tree,
refuses links and nonregular files, and retains each output-relative path and its
bytes. Prepare the shipping CSS, fonts, images and visitor scripts there before
capture; exclude provenance and review-only files. The parent of another asset
directory is never guessed as a public root.

A trusted host may instead supply `publicFiles: [{ fileName, sourcePath }]` to
capture. `sourcePath` must be a normalized workspace-relative regular file;
`fileName` must be a unique normalized artifact-relative path. This explicit list
is the host's shipping manifest. Use the same manifest during currentness checks;
it overrides the configured public tree for that capture. The build returns these
bytes together with managed Assets in `compiled.assetFiles` and rejects duplicate
paths, modified bytes, corrupt locks and mismatched renderer/pack identities.

The exact snapshot compiler deliberately does not read the current workspace,
root JSON or live asset directory. A later draft does not destroy an earlier
reviewed build input. This is local artifact generation, not deployment, release
activation or owner-data cutover.

## Focused verification

```sh
corepack pnpm exec vitest run server/authoring-workspace/__tests__/capture.test.ts
corepack pnpm exec vitest run server/edit/__tests__/service.test.ts
corepack pnpm public:check
corepack pnpm typecheck:public
```

Tests cover restarting from serialized capture without live storage, referenced
Assets, Content edit/revert currentness, a live-writer lease conflict, missing-state
preservation, authority overrides, shipping-file bytes/path validation, and actual
renderer source changes without changing its declared version. Consumer acceptance
must additionally run these APIs from an independent immutable package install
with the consumer's real renderer and static-output verification.


## Staged migration source verification

`isAuthoringWorkspaceSourceCurrent({ composerConfig, pack, publicFiles? }, snapshot)`
from `zudo-composer/authoring` verifies a saved source after installing a different
pack or renderer. It checks the snapshot digest, coherent native domain tokens and
full project, Assets catalog and referenced immutable bytes, and prepared public
files. The current `pack` opens inspection; its manifest does not reinterpret the
old data. Missing or busy canonical source can throw; changed or incoherent data
returns false. It never initializes missing stores.

A true result means source-data equivalence. It does not prove compatibility with
the new runtime, authenticate the physical original root (an identical copied
root is equivalent), reserve a writer lock after return, or authorize activation.
The migration caller must choose the authorized original source root, keep its
writer fenced throughout staging and selection, and recheck before switching.
Keep original stores/history and leave their authority intact on failure. Validate
and render the staged project separately before an explicit switch. Actual owner
data cutover still needs that owner's current data and authorized reachable host.
The existing `isAuthoringWorkspaceSnapshotCurrent` and exact build retain their
strict component-pack and renderer identity requirements.
