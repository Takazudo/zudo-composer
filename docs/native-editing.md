# Deterministic native draft editing

The Phase 0/1 foundation and Phase 2a page-first UI of #890 provide trusted adapters to the existing structural
Composer editor. It does not run a model, publish a release, build a website,
or change the frontend framework. The canonical document remains the selected
workspace's Composition JSON; JSX is derived through the real component pack.

## Supported host and scope

A host explicitly declares semantic roles in `zudo-composer.config.ts`:

```ts
export default defineComposerConfig({
  pack: 'my-host/components',
  nativeEditing: {
    source: 'workspace',
    paragraph: { componentId: 'host.paragraph', textProp: 'text' },
    list: { componentId: 'host.list', itemsProp: 'items' },
    image: { componentId: 'host.image', srcProp: 'src', altProp: 'alt' },
    table: { componentId: 'host.table', columnsProp: 'columns', rowsProp: 'rows' },
  },
});
```

These declarations name existing pack components and fields; they do not add a
second component registry. Inspection validates them against the actual
catalog and reports derived grammar. Inserted components must be leaf nodes
with no additional default props. Native model commands enforce field schemas,
slot acceptance/cardinality and bound-template root constraints. The supplied
text and table values are preserved exactly; an image uses an immutable managed
version URL and requires explicit alternative text (which may be empty).

Only an isolated, directly Composition-owned page is writable. Inspection
returns workspace, sitemap, page, provider and record identity; all direct
consumers and detected mapped/linked consumers; native targets and unsupported
nodes; capabilities and scope blockers. Route strings and explicit page IDs
are accepted, with explicit sitemap selection when needed.

Refused scopes include generated/source-authored hosts (`site-project.ts` or
`site-project.json`), Mapping/Content-owned pages or values, shared/published
Compositions, targets under dynamic Mapping routes, and unsupported providers.
A bound page may insert into its own validated template outlet; the shared
source template is never modified. A paragraph inside `ProseMd.markdown` is
not a standalone node: there is no Markdown source-range adapter in this slice.
Missing/ambiguous targets require explicit selection, never a guessed insertion.

`fixtures/edit-host` is the disposable canonical authoring host. Its bootstrap
uses the public `initializeAuthoringWorkspace` authoring primitive and an
in-memory `defineSite` project to create a ready workspace and managed image.
It has no generated SiteProject source file, release or activation. The packed
proof installs it outside the repository and imports only public package paths.

## Page-first browser editing

Start the configured host with `zudo-composer dev`, open its direct loopback
URL, then open **Composer → Edit page** (`/composer?native=1`). Choose an actual
sitemap page in the compact top bar. The page fills most of the desktop and the
right pane contains the exact insertion and review controls. On narrow screens,
use **Page / Edit** tabs. **Structure** opens the existing structural editor.
`/site` and `/website-preview` remain visitor documents.

**Select targets** captures clicks and keyboard Enter/Space without following
links. **Browse page** permits ordinary page navigation. Only a supported
standalone native node can become the qualified workspace/sitemap/page/provider/
composition/node target chip. Markdown sub-blocks and mapped/shared ownership
never acquire native write authority.

Choose one exact insertion:

- **Exact text:** supply the complete text, including Japanese and line breaks.
- **Managed image:** choose an existing active image and supply alternative text;
  select **Intentionally empty alternative text** for an intentional empty alt.
- **Supplied table:** provide JSON containing only `columns` and rectangular
  `rows`, for example `{"columns":["項目","値"],"rows":[["数量","3"]]}`.

**Review insertion** creates a detached server plan. **Original / Proposed**
shows the retained before/candidate records through the actual installed pack,
checked template context and assets. Neither planning, preview nor **Discard**
changes canonical draft JSON/JSX. **Apply to draft** is enabled only for the
current successful Proposed rendering with the matching plan/digest, qualified
page, render revision, frame session and dependency identity. Iframe boot
readiness alone cannot authorize Apply. Reviewed candidates have no inline,
move, drag/drop or history mutation lane.

A pending plan retains its original page and target when navigation or selection
changes. Return to that page and render Proposed again before approval. Minimal
per-page input and server plan references survive reload in this tab; this is
not a conversation platform. No generation provider is connected, and there is
no natural-language parser or generated copy in this slice.

After Apply, the server invalidates old browser write revisions and clean tabs
reopen actual records. The retained plan recovers the durable receipt after a
lost response, reload or server restart. Success is displayed only from that
receipt. **Guarded Undo** uses the existing journal and refuses to overwrite a
later structural/browser/CLI edit. **Discard** applies only to pending plans;
it never undoes a committed operation.

## Browser coordination and recovery

The dev server keeps its lifetime authoring lease. Its own finite native adapter
executes under a private server-owned scope; it has no request-supplied lock
bypass and never shells out to the CLI. External CLI mutations remain
`authoring-busy` while that server runs.

Before plan/apply/undo, every bound authoring tab locks new user input and
flushes through its existing save registry and real provider path, with provider
admission still open for those saves. An active inline/prose edit inside
Structure's iframe blocks preparation until
you explicitly save or cancel it. A nonce-bound frame reply follows earlier
inline commit messages before the parent flush; iframe boot is not a clean-state
acknowledgment. Input stays locked in both parent and preview during preparation.
The server then freezes admission, drains actual in-flight storage work and
obtains fresh nonce-bound clean
acknowledgments from every tab. Dirty/saving/error, unresponsive or disconnected
clients fail closed with pending input retained. Failed preflight does not
invalidate a tab's revision. Once a native mutation starts, late requests from
old epochs are refused, including delayed autosaves and read-repair paths.
Reconnecting cannot authorize stale in-memory records. Module refresh preserves
the tab's original client and revision owner; a changed
server capability requires reopening canonical records, even if its epoch reset
to zero. Tabs automatically reopen after a commit only while input stayed locked
through preparation and no pending or inline edits remain. A disconnected tab
retains its input and shows recovery guidance instead of automatically reloading,
even when the storage registry reports no pending writes.

If an interrupted tab retains unsaved structural input after another revision
commits, keep that tab and preserve/copy its pending values before reopening
current records. Do not blindly retry an old write. Source, pack, template,
asset or workspace changes invalidate candidate readiness; inspect and review
a fresh plan. Executed source changes require a real dev-server process restart,
not a browser reload or a newly constructed service. Missing renderer/pack/
template/image dependencies keep Apply disabled.

The native operator channel requires direct loopback Host/Origin validation,
a per-server capability and a bound authoring session. Proposal and explicit
Apply/Undo capabilities are separate. Browser responses contain projected data,
not host paths, source graphs, JSX or credentials. Remote dev authoring tabs
participate in coordination, but the native operator UI remains loopback-only.
Static sites and disposable hosted editors receive no native write transport.
Graceful shutdown cancels challenges, closes sockets, drains actual work and
only then releases the lease.

## CLI protocol

Every command accepts exactly one JSON object on stdin and returns one JSON
object on stdout: `{ "ok": true, "result": ... }`, or
`{ "ok": false, "error": { "code": "...", "message": "..." } }` with exit 2.
Use `--root DIR` to select a host; `--stdin` and `--json` are accepted explicit
protocol markers. Unknown keys, extra operations, arbitrary component/prop
patches and shell commands are rejected.

Save browser work and stop the authoring server before planning, applying or
undoing. Configured authoring servers hold an exclusive host lease until a
successful shutdown. CLI mutations refuse `authoring-busy` while the server
is open, even if the current draft appears saved. This is intentionally
conservative: a CLI cannot infer unsaved browser state. Inspection remains
available; storage contention returns a retryable diagnostic rather than
reading through a partial transaction.

```sh
# Substitute the actual workspace ID returned by the host bootstrap/UI.
echo '{"workspaceId":"native-proof","page":"/"}' |
  zudo-composer edit inspect --stdin --json > inspection.json

# Only detached plan storage changes. The current draft remains unchanged.
echo '{"workspaceId":"native-proof","page":"/","after":{"kind":"paragraph","ordinal":1},"insert":{"kind":"image","assetId":"IMAGE_ID","alt":"説明"}}' |
  zudo-composer edit plan --stdin > plan.json

# Exact Japanese text after a selected standalone list.
echo '{"workspaceId":"native-proof","page":"/","after":{"nodeId":"LIST_NODE_ID"},"insert":{"kind":"text","text":"正確な日本語の追記。\n改行も保持します。"}}' |
  zudo-composer edit plan --stdin

# Required supplied columns and rectangular rows; nothing is invented.
echo '{"workspaceId":"native-proof","page":"/","after":{"nodeId":"ANCHOR_NODE_ID"},"insert":{"kind":"table","columns":["項目","値"],"rows":[["数量","3"],["備考","そのまま保持"]]}}' |
  zudo-composer edit plan --stdin

# Read the retained exact candidate, operation, IDs, JSX, scope and revisions.
echo '{"planId":"PLAN_ID"}' | zudo-composer edit review --stdin

# AFTER reviewing that exact content, the trusted operator supplies approval.
echo '{"planId":"PLAN_ID","approve":"EXACT_REVIEWED_DIGEST"}' |
  zudo-composer edit apply --stdin

echo '{"planId":"PLAN_ID"}' | zudo-composer edit receipt --stdin

echo '{"planId":"PLAN_ID","approve":"EXACT_REVIEWED_DIGEST"}' |
  zudo-composer edit undo --stdin

# Pending plans only:
echo '{"planId":"PLAN_ID"}' | zudo-composer edit discard --stdin
echo '{"planId":"OLD_PLAN_ID","replacementPlanId":"NEW_PLAN_ID"}' |
  zudo-composer edit supersede --stdin
```

`edit resolve` accepts inspection keys plus `after` and returns the one qualified
native target. `after` is exactly `{nodeId}` or `{kind, ordinal}`, where kind is
paragraph/list/image/table and ordinal is one-based. A plan adds exactly one
`insert` object, one of the three shapes above. `sitemapId` is optional on
inspection/resolve/plan and otherwise uses the workspace's selected sitemap.

Plans retain exact candidates, generated IDs, canonical operation, before
record, source/catalog/domain revisions, asset pin and policy identity. They
are detached and append-only; discard/supersession is separate disposition.
The SHA-256 digest binds review content. **It is not authentication or proof
that a human approved.** The local trusted CLI operator owns approval; a future
untrusted proposal runner must not receive the apply/undo adapter or credentials.

## Persistence, concurrency and recovery

Apply acquires the host lease, then existing registry/Content/Mapping/Sitemap/
Assets mutation locks in fixed order, then the Composer writer boundary.
It rechecks exact revisions and reconstructs the one permitted semantic effect
with the original IDs. It never rebases an approved plan. The Composer snapshot
CAS and final pack/source checks run inside the real writer lock. All ordinary
Composer reads/writes, including JSX repair, now participate in that lock.
Graceful shutdown first disconnects operator challenges and active request
streams, then drains asynchronous provider work before disposing Vite and
releasing the host lease. A disconnected HTTP response does not mean its storage
work has finished. CLI and browser test runners await this drain; they do not
remove locks or force an otherwise healthy server to exit after a deadline.

A long-lived editing process pins the host source epoch when loading its context.
The editing fingerprint follows and hashes imported dependency files, including
bare-package metadata, rather than trusting package versions. After a source
change, restart the process before planning again; creating another service in
the same process cannot clear native ESM caches. Graphs that cannot be statically
resolved are refused. Storage edits do not reset this source epoch.

A durable prepared journal is irrevocable commit intent. It contains the exact
canonical JSON, JSX and receipt. Roll-forward accepts only recorded before or
after bytes; unexpected external edits are preserved and block recovery. Every
publication is fsynced, and cooperating readers recover intent before exposing
a snapshot. This is a recoverable flat-file transaction, not a claim that two
renames are atomic to arbitrary filesystem readers. Once the receipt is durable,
retry/lost acknowledgement returns the original receipt without another insertion.
Undo uses its own idempotent receipt and refuses to overwrite a later draft edit.

Native locks are never stolen based on a timeout or PID alone. After a crash or
`commit-uncertain`, preserve the journal and files. Stop and verify all authoring
and CLI writer processes have exited. Inspect the error's operation ID, journal,
exact before/after destinations and receipt; only then may the operator remove
the retained `.mutation.lock` in that Composition directory and the host's
`.zudo-authoring.lock` if retained. The next receipt/inspection operation performs
idempotent roll-forward under a newly acquired lock. If any destination differs
from both recorded states, recover from verified copies manually; do not delete
the journal or blindly retry writes. Never remove a live writer's lock.

## Verification and later phases

`pnpm edit:installed` packs and installs the tool/contract, applies all three
insertions through the installed CLI, verifies exact content and receipts, then
opens and restarts real Composer to verify persisted text/table/image rendering.
It owns port 4175 and belongs to the serial heavy lane; it is also in `pnpm check`.
Focused suites cover config/ownership, strict operations, stale/tampered/inactive
plans, real writer contention, interrupted JSON/JSX/receipt publication and undo.

External Node hosts can use `const service = await createEditingService({ workspaceRoot })`
from `zudo-composer/editing`; it exposes the same strict operations as the CLI.
Phase 2a uses this shared boundary and the existing preview protocol while
preserving conservative external-CLI exclusion. This does not complete all
Phase 2 or Phase 3 roadmap work. Phase 3 may produce strict
proposals but must keep conversation/run state, plans, approvals and receipts
separate. No model calls or provider credentials are part of this implementation.

The installed browser proof additionally exercises the page-first UI, all three
exact insertions, identical JSON/JSX before approval, Original/Proposed,
navigation to another page with colliding node ids, receipts across reload,
guarded undo, Discard, narrow tabs and synthetic composition Enter. Cloud
synthetic tests do not establish physical Japanese IME, touch or virtual-keyboard
behavior on Mac/Fold devices; those remain separately labelled manual checks.
