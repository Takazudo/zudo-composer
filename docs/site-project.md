# SiteProject release operator and API guide

SiteProject is the canonical four-domain JSON graph: provider-qualified,
provider-scoped
Compositions, Content models/entries, Mappings, and Sitemaps. Assets remain global
and separate. Release inputs include an exact Assets lock without adding a fifth
project provider domain.

The current local release API is **protocol 2**. There are no protocol-1 readers,
migrations, compatibility adapters, or second active-build pointer. An old local
layout is refused and preserved for explicit operator inspection/reset.

## Committed ready workspace

`zudo-composer seed --ready-workspace` produces a reproducible, selected CMS
workspace from the host's committed `site-project.json`. Import the host's Assets
first when the project references them, then generate the workspace:

```sh
zudo-composer assets import images-src/manifest.json
zudo-composer seed --ready-workspace
```

`--root <host>` selects the host config and pack. `--from <file>` selects another
committed JSON file, relative to the caller's working directory. Domain paths
come from that config, including a moved `dataDir` and explicit domain overrides;
the global Assets store stays separate. This mode uses the existing seed
publish/plan/apply/build/activate service in disposable staging, so all committed
entries are published and blocking release checks fail before CMS publication.
It does not create or require the host's `.zudo-site-project` directory. Plain
`seed` still activates a host-local release for website delivery.

The generated `initial` workspace is selected through the real registry
`complete()` operation. Its ready record has the completed mutation token and
has no `seed`, `requiresBeforeComplete`, or `seedCleanupPending`. Transactional
writers compute every current-generation document digest. All four scoped
domain directories are included, even when empty; an empty Composition
directory contains `.gitkeep` so Git retains it. Normal development opens this
selected workspace without creation options, even when the dev source reports
`no-active`. A ready workspace supplies authoring data; website delivery still
requires its own activated release.

The command prints one JSON object with `projectId`, `revision`, `buildId`,
`workspaceId`, `status` (`created` or `unchanged`), `directories`, and `files`.
`directories` lists every generated directory, including empty ones; `files`
lists `{ "path": "…", "digest": "<sha256>" }` for every generated file. Both
inventories are sorted and relative to the output root. Commit the listed files
with their source. Fresh generation uses deterministic, domain-scoped tokens
derived from the release identity, format/schema, generation, prior token, and
canonical records. Ordinary authoring stores continue to use random tokens.

Rerunning with identical source, Assets, toolchain, and destination bytes returns
`unchanged` without rewriting files. Existing authored, partial, or otherwise
different destinations are refused and preserved. Generate source changes into
a fresh output tree for review before replacing previously generated files:

```sh
zudo-composer seed --ready-workspace --output /tmp/my-site-ready-review
```

`--output` is relative to the caller's working directory and retains the host's
configured relative directory layout. The source host still provides its config,
pack, and Assets. This command and its exact inventory support repository
regeneration/check commands through the installed CLI. No generation or registry
JSON should be edited by hand. The producer owns the four `workspace-v1-initial` directories and the
whole `<dataDir>/workspaces` registry; it refuses to merge another workspace into
that registry. Run generation while authoring is stopped. Publication copies the
completed registry last and refuses destination collisions; an I/O failure may
leave partial generated destinations requiring inspection and a fresh output
tree, and is always a nonzero error.

### Regenerating committed hosts

For this repository's hosts, `site-project.ts` is authored source.
`site-project.json`, the four ready CMS domain trees, and the workspace registry
are generated material that happens to be tracked. Keep changes to content in
the source file; never fix generated records or their digests by hand.

From the repository root:

```sh
corepack pnpm cms:regenerate
corepack pnpm cms:check
```

The check is also part of `corepack pnpm check`. It discovers source-bearing
hosts under `packages/` and `fixtures/`, including a future `demo-studio`, and
requires previously registered hosts to remain present. It runs the installed
`zudo-composer generate --check`, then `seed --ready-workspace --output` in fresh
staging. Every directory (including empty directories), filename and byte digest
must match the producer. Extra generations, stale JSX, missing files and
untracked files inside managed trees fail. The current registry reader and all
four domain readers open copies of the committed records; incompatible schemas
fail even if a file's transactional digest was updated to match. Reader repairs
cannot alter committed files or conceal differences.

Regeneration evaluates `site-project.ts` with installed `generate` in a
disposable copy, then seeds fresh output using the original host's pack and
Assets. It prepares and checks every host before replacing anything.
`scripts/cms-fixtures.json` is automatically generated directory ownership,
not a digest baseline. Old ownership comes from Git HEAD so moved or obsolete
generated trees can be removed without decoding their old format. New hosts
with absent or already-current generated trees register automatically.

Stop authoring and preserve local CMS edits separately before regeneration.
Only trees matching Git HEAD or fresh producer output may be replaced; edited,
untracked, ignored, symlinked or overlapping destinations are refused.
Assets, public uploads, other workspaces, release state and unrelated host files
remain outside replacement. Identical reruns do not rewrite files. If a prior
run's generated output has not been committed, commit or preserve that output
before changing source again. Interrupted filesystem publication can leave
partial output: inspect it and restore the generated trees from the committed
baseline before retrying, while retaining any authored changes separately.

For a clean break to a record schema or workspace layout, update the writers
and current readers together, run both commands above, and commit **all hosts,
their aggregate JSON, and ownership metadata in the same PR**. The same rule
applies when compiler or pack bytes change a build identity without changing
the aggregate. Do not exempt an old identity, add old-schema readers, or add
migrations. Generated consumer repositories must use the new tool's installed
`generate` and fresh-output `seed --ready-workspace` commands to replace their
provisional generated data as part of adopting the break; this repository gate
cannot update external repositories.

## Review, stage, build, activate

1. `plan` constructs a detached delivery candidate, real Changes, Checks and
   Affected identities, publication reconciliation instructions, exact Assets
   pins, toolchain identity, and `planDigest`.
2. `apply` recomputes the plan, verifies approval and preconditions, then stages
   immutable project/build inputs. It **does not activate** or overwrite an old
   project revision. A conflicting approval requires a fresh review.
3. `build` reads only staged inputs and writes immutable output keyed by
   `buildId`. It **does not activate**. Later workspace edits and current Assets
   replacements are not re-resolved into the staged candidate.
4. `activate` verifies every completed output digest and CAS-selects the exact
   `{projectId, revision, buildId}` identity. Unbuilt, partial, missing, corrupt,
   or conflicting targets cannot become active. It does not compile again.

There is one pointer, `active.json`, containing exactly those three identity
fields. Previous revisions, completed builds, and copied Assets bytes remain
available after later staging, building, activation, or failures. `discard`
removes only an uncompleted stage from the visible stage catalog; it cannot
discard active or completed release dependencies. No permanent release GC is
implemented. Private abandoned files are not listed as committed stages.

Activation returns a separate `activationGeneration` and reconciliation outcome.
The generation is reserved durably in release metadata; `active.json` remains
only the required triple. The cross-process writer lock covers pointer CAS and
the injected reconciliation callback. Content records a monotonic fence in its
own metadata transaction, including empty batches; late older callbacks cannot
overwrite a newer reconciled lifecycle.

`projectRevision` is SHA-256 of canonical four-domain SiteProject UTF-8 JSON,
including its trailing newline. `buildId` is SHA-256 of canonical JSON containing
`projectRevision`, sorted `assetLock`, and `toolchain`. Thus unchanged project JSON
with a new Assets version gets a different build ID. Completion digests bind the
active identity and all output-file digests.

The Assets lock contains provider/asset/version/checksum/MIME/size/immutable URL,
captured metadata revision/head, and the persisted catalog token. Builds copy and
checksum/signature/size-verify exact retained versions; they do not copy all Assets
files or fetch latest. Each build's `asset-sha256-…` file maps to its pin's
`/uploaded-assets/sha256-…` URL for a later explicit artifact exporter.

The local toolchain records the component pack as a package, because that is
what it is: `packSpecifier` is the configured `pack` value, `packSource` is the
host's dependency spec for it (or `self` for a host self-reference), and
`installedPackDigest` is a SHA-256 attestation of the actual resolved package's
stable relative paths, permission modes and file bytes. A nested `node_modules`
is skipped — it is never part of a package's published bytes — while the
traversal otherwise rejects internal symlinks/special files and detects
entry/root changes. Altering installed runtime bytes changes the build identity,
regardless of package URL. The toolchain also binds component-pack identity, the
contract package digest, and a fingerprint of production headless
compiler/domain source. An incomplete stage cannot be compiled using a
different toolchain. Already completed artifacts remain readable/activatable
without recompiling them through newer tools.

## Selected Content publication

The baseline is the immutable **activated** project, not the latest staged
revision and not the working entry's lifecycle flag alone.

- Explicitly selected new/changed entries replace their baseline delivery value.
- Unselected new drafts remain excluded.
- Unselected edits to published entries retain the activated baseline values.
- Selected `delete` requires a missing working entry; selected `unpublish`
  requires working draft intent. Both remove the entry from the delivery candidate.
- Model/schema, Composition, Mapping, Sitemap and project metadata changes are
  reviewed whole-project. They do not silently select pending Content values.

The resulting candidate is validated again. Missing/unpublished dependencies,
incoming references to removed entries, incompatible baseline values after schema
edits, unresolved Assets, and route/materialization failures produce blocking
Checks. Planning may return `ok:true` with blocking Checks so a review UI can
show them; apply never stages such a plan.

Apply does not modify the mutable working project. Activation returns publication
reconciliation status independently of successful activation. The injected
`reconcileActivatedPublication` helper uses Content's atomic generation **and**
exact-value-digest preconditions; newer edits, lifecycle intent, and deletions
remain untouched. No release values are copied over newer workspace values.
Failure to reconcile is reported as `unavailable`/`changed`, with the activated
release still selected; retrying activation is safe and can retry reconciliation.

## Provider-neutral services and preconditions

`createSiteProjectApiService` takes project/build adapters, SHA-256 function,
component catalog, exact toolchain, optional versioned Assets store, optional
working-generation guard, and optional publication reconciliation adapter.

`planDigest` binds working snapshot and explicit `workingPrecondition` token, delivery candidate, selected transitions,
project head, active identity, storage generation, exact Assets metadata, toolchain,
Changes/Checks/Affected and reconciliation generations. Apply repeats all checks;
the adapter runs its final approval callback under the release transaction lock
before installing the stage catalog. Exact committed approval receipts make
retries idempotent without overwriting immutable inputs.

The standalone CLI requires `workingPrecondition:null` for its explicit detached JSON. It has no browser workspace
or hidden editor-generation capability: `describe.capabilities.workingPrecondition`
and `publicationReconciliation` are false. A browser transport must inject its
coherent flushed workspace capture/currentness guard and owning Content stores.
Its non-null JSON precondition contains the captured workspace identity/session
generation/persisted tokens (not a second copy of the values). The service binds
it into approval and passes it to `isWorkingCurrent(project, precondition)`;
even an edit/revert to equal project JSON invalidates an old captured generation.
A configured guard requires a non-null precondition, and an adapter without that
guard refuses non-null preconditions. Browser transport must not pretend the CLI
inspected browser drafts. Working changes before
apply invalidate browser approval. After A is staged, editing B does not invalidate
building/activating pinned A. Workspace identity/storage remains separate from
active release identity; see [workspace lifecycle](./workspace-design.md#workspace-lifetime-and-capture).

Read-only operations are `describe`, `list`, `active`, `get`, `stage`, `plan`, `completed`.
Mutations are `apply`, `build`, `activate`, `discard`. `get` addresses an exact
retained project revision; `completed` addresses and integrity-checks an exact
completed build; `active` returns the single identity and verified completed
record. No API silently falls back to sample data or mutable current content.

## JSON-stdin examples

Run `corepack pnpm site-project:api` inside this repository, or `zudo-composer release`
from an installed host project — the same service, same protocol, same exit codes.
Each invocation accepts exactly one UTF-8
JSON object (8 MiB maximum) and writes one canonical JSON response with newline.
All operation shapes are exact: extra keys are rejected. Obtain current shapes
and capabilities first:

```sh
corepack pnpm site-project:api <<'JSON'
{"protocolVersion":2,"operation":"describe"}
JSON
corepack pnpm site-project:api <<'JSON'
{"protocolVersion":2,"operation":"list"}
JSON
```

For an initial release, explicitly select the intended entries. This example
deliberately selects **all entries in the repository's generated studio sample**; normal
editorial releases should name only the entries being approved. Use the actual
head revision and active triple from `list` for subsequent reviews.

```sh
node --input-type=module <<'NODE' | corepack pnpm site-project:api > release-plan.json
import { readFileSync } from 'node:fs';
const project = JSON.parse(readFileSync('packages/demo-studio/site-project.json', 'utf8'));
const selection = project.providers.content.flatMap(p => p.entries.map(e => ({
  ref: { providerId: p.id, modelId: e.modelId, recordId: e.id }, action: 'publish'
})));
process.stdout.write(JSON.stringify({ protocolVersion: 2, operation: 'plan', project, workingPrecondition: null,
  selection, expectedRevision: null, expectedActive: null }));
NODE
```

Inspect `result.changes`, `result.checks`, `result.affected`, `candidate`, and pins
before approving. Do not edit a plan or invent its digest. Stage the exact plan:

```sh
node --input-type=module <<'NODE' | corepack pnpm site-project:api
import { readFileSync } from 'node:fs';
const response = JSON.parse(readFileSync('release-plan.json', 'utf8'));
if (!response.ok) throw new Error('Planning failed');
process.stdout.write(JSON.stringify({ protocolVersion: 2, operation: 'apply', plan: response.result }));
NODE
```

Use `staged.projectId`, `staged.revision`, and `staged.buildId` from apply. Replace
the symbolic values below with the exact returned IDs/digests:

```json
{"protocolVersion":2,"operation":"build","projectId":"sample-studio-site","buildId":"BUILD_SHA256"}
{"protocolVersion":2,"operation":"completed","projectId":"sample-studio-site","buildId":"BUILD_SHA256"}
{"protocolVersion":2,"operation":"activate","projectId":"sample-studio-site","revision":"PROJECT_SHA256","buildId":"BUILD_SHA256","expectedActive":null}
{"protocolVersion":2,"operation":"active"}
```

For a replacement activation, `expectedActive` is the exact prior triple, not
null. `get` requires `{projectId,revision}`. `stage` requires `{projectId,buildId}`
and returns `{stage,stageGeneration}` from one authoritative catalog read, even
for an unbuilt stage created by another tab or the CLI. `discard` requires
`{projectId,buildId,expectedStageGeneration,expectedActive}`. Use `stageGeneration`
from apply (including idempotent apply) or `list.stageGenerations[buildId]`.
This is the exact visible stage incarnation, not merely a build hash or the
current global catalog generation. Neither operation accepts revision aliases.

Responses use `{ok:true,result:…}` or `{ok:false,error:{code,message,diagnostics?}}`.
CLI exit 0 means success; exit 2 means protocol/validation/compile/not-found/CAS
failure; exit 1 means unavailable/internal failure. Never infer activation from
an apply/build success.

## Local files, recovery and verification

The private root is `.zudo-site-project` **under the host project root** — disposable
derived state rather than CMS data, so it has no `zudo-composer.config.ts` setting and
hosts gitignore it. `ZUDO_SITE_PROJECT_ROOT` supplies an explicit disposable root for
isolated tests. Layout:

```text
heads.json                       stage order/incarnations, heads, generation, receipts
active.json                      sole active project/revision/buildId triple
projects/PROJECT/REVISION.json    immutable canonical project
stages/BUILD_ID.json              immutable lock/toolchain/publication inputs
builds/BUILD_ID/                  immutable build.json, stage.json, modules, Assets
builds/BUILD_ID/complete.json     terminal file manifest/completion digest
```

The local visitor currently renders the verified compiled composition snapshot in
`build.json`; it does not execute the emitted module files. Those module bytes are
still completion-manifest dependencies, so mutations make the active artifact
unavailable and trigger a scoped delivery recheck.

Exclusive process locks, regular-file/no-symlink checks, pinned root checks,
file fsync and parent-directory fsync protect mutations. Unknown layouts and
unsafe paths fail closed. A live writer lock is never stolen. A provably dead
writer can be recovered; an ownerless/invalid lock requires explicit inspection.
Stage application order is persisted explicitly, not inferred from build hashes:
discarding the current C in A→B→C restores B. Discard receipts make retry of a
committed discard idempotent only for its original incarnation. Restaging the
same build assigns a fresh monotonic stage generation; a delayed old discard
cannot remove it. Discard retries also require the original expectedActive and a
matching current active pointer; changing the precondition cannot reuse an old
receipt. Heads validation checks exclusive visible/discarded sets,
generation order, exact project heads, complete approval coverage, immutable
stage identities and retained active references before any receipt shortcut.
Durable partial stage/build files can be retried
with the same inputs. A valid already-copied Assets destination is verified by
path, size, signature/MIME and digest before any source reader is consulted, so
retry can complete while that source is unavailable. Corrupt destinations block.
Completed
outputs cannot be repaired by silently overwriting conflicting bytes.

`commit-uncertain` (CLI exit 1) after an atomic pointer/catalog rename or lock
cleanup failure after a logical stage/build/activation/discard commit identifies
the exact project/revision/build identity. The operation may have committed but its
acknowledgment was lost. Inspect `list`, `active`, and `completed`, then retry the
same approved identity; do not construct a new blind mutation. Failed staging or
building cannot change active. Activation failures before pointer replacement
leave it unchanged; an uncertain activation is resolved by exact-state inspection
and idempotent retry. Phase-aware lock cleanup tracks owner removal, directory
removal and root sync separately; retries cannot delete a later writer's lock.
Precommit cleanup failures remain unavailable, not falsely committed.

A browser reconciliation timeout reports `commit-uncertain` / reconciliation
busy but quarantines the writer lock until that exact callback settles or its
operator socket disconnects. Later UI/API/CLI activations cannot pass that lane.
Disconnect aborts pending browser Content transactions; restart also disconnects
the client. There is no force-unlock of a live reconciliation. The server
catalog's approval receipts are the only recovery record; the browser keeps no
journal. After `commit-uncertain`, inspect `list` / `active`, then retry the same
approved plan — apply is idempotent by `planDigest`.
Preserve the old root before any explicit clean reset.

Focused API/store/CLI tests cover selection, digests/CAS, interrupted writes,
immutable Assets copies, completion corruption, symlinks and concurrent writers.
The integration owner runs `site-project:boundary`, full CI/artifact gates and
the guarded `test:browser:site-project` lane. Vite development
delivery resolves `/site` only from the currently activated, completed local
release. It verifies the active project/revision/build triple and serves only that
build's copied checksum-addressed Assets bytes; missing or corrupt release state is
unavailable and never falls back to a working draft. In contrast,
`/website-preview` flushes and compiles the current live authoring snapshot. A release
is stamped with the toolchain that built it, so after a component-pack swap an already
activated release no longer matches the installed runtime and becomes unavailable
rather than being served against different components. Local activation is not deployment.
Hosted persistence, authentication, hosted APIs and deployment of host-owned
releases remain future work and are not a claim of this repository. The
disposable static sample described in [`hosted-demo.md`](./hosted-demo.md) is a
separate, explicitly allowlisted artifact adapter.
