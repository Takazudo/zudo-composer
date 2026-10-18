# AI Assistant

The AI Assistant is another entrance to the same authoring data as Composer.
The author has already defined the components, editable fields, allowed
child slots, templates and visual design; the Assistant works inside that
schema the way a database client works inside a database schema. It cannot
create or register components, write HTML/CSS/JSX, edit files, change
templates, or bypass ownership. It proposes changes; you review the exact
rendered candidate and explicitly apply it. **Apply saves authoring data in
Composer. It does not publish or deploy.**

## Enabling it

The Assistant is opt-in per host. It requires `nativeEditing` (writable,
workspace-owned pages) and an `assistant` block in `zudo-composer.config.ts`:

```ts
export default defineComposerConfig({
  pack: "my-site/components",
  nativeEditing: { source: "workspace" },
  assistant: {
    name: "Site Bot",              // default display name; renamable per site
    model: "claude-opus-5-5",      // Anthropic Messages API model (default)
    apiKeyEnv: "ANTHROPIC_API_KEY",// variable read by the authoring server only (default)
    effort: "medium",              // low | medium | high (default medium)
    permission: "apply",           // or "propose": review allowed, Apply refused
    // baseUrl: "https://gateway.example.com", // https, or loopback http
  },
});
```

The config never holds a secret. Start `zudo-composer dev` with the variable
set in the server's environment. Without it, the Assistant shows a
configuration state, sends nothing, and the rest of Composer (including saved
conversations, Memory and review) keeps working.

### Provider and data flow

One provider adapter ships: the Anthropic Messages API through the pinned
official SDK (`@anthropic-ai/sdk`), called by the local authoring server, with
streaming, adaptive thinking and the server-side refusal fallback
(`fallbacks: "default"`). Internally the runner uses a provider-neutral
interface; there is no multi-provider product. The developer's Claude Code
session is never a runtime credential, and the adapter ignores
`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`: it uses only `apiKeyEnv` and
`baseUrl`.

Each model call can send: your message and recent conversation (bounded), the
current page/selection ids, the blocks the model inspects, saved site Memory,
exact materials you attach to the turn, and component definitions from the
installed pack. **Context details** under the message box lists this and the
destination. Credentials, host paths and source files are never sent, logged
or returned to the browser.

## Using it

Open **Composer → AI Assistant** (`/composer?assistant=1`). Desktop shows the
conversation on the left and the real page preview on the right; narrow
screens switch between **Conversation** and **Page** views. **← Composer**
returns to the same page's Composition with the same selected block.

- **Select block** captures clicks in the preview (links don't navigate) and
  adds the block to the next message's context. **Page:** shares the current
  page; untick it to send no page.
- **Attach** adds exact material (text, a table, or an existing managed image
  with alternative text). The Assistant must use attached material exactly,
  by reference; it cannot retype it.
- Conversations are separate and resumable. All conversations of a site
  contribute to **one shared draft** (v1 does not branch task drafts or apply
  part of a draft).

Replies are kept distinct from changes:

| You see | What it is |
| --- | --- |
| Reply text | Advice or a clarifying question. Never proof that anything changed. |
| **Proposed wording** card | Copy suggestions; **Add to review** stages it as an exact change. |
| **Unstaged changes** | Validated candidate changes in the shared draft. Nothing is saved yet. |
| **Applied to Composer** + receipt | A durable receipt from the writer. Only this means saved. |
| **Memory update proposal** / **Remembered · Memory rN** | Memory state, separate from page changes. |

### Reviewing changes

**Current / Draft** switch between the saved page and the exact candidate,
both rendered by the installed pack, template and assets. Review markers are
editor chrome, never page content:

- Changed or added **words** have a **yellow background** (CSS Custom
  Highlight API; the page markup is untouched).
- Changed or added **blocks** get an amber outline with an external
  **Changed N/M** / **Added N/M** label; Current shows **Will change**
  blocks and the words that will be removed or replaced.
- Images, table cells and non-text fields are outlined as blocks; the change
  list shows the exact Current/Draft values. When a custom renderer doesn't
  expose a field's words reliably, the whole block is marked and the list
  says so.
- Markers are anchored to the node id inside that node's own element, keyed to
  the draft candidate, page and view; a repeated phrase elsewhere is never
  marked. They follow scrolling, resizing and image/font loading, and are
  replaced after every revision, Apply, Discard or Undo.

**Previous / Next change** and the change list move between markers by
keyboard. Page tabs list every changed page. **Withdraw** removes one change;
a change that other changes depend on asks before withdrawing them together.
A value returned to its original disappears from the count. **Discard all**
drops the draft without touching saved pages.

### Apply, receipt and Undo

**Apply to Composer** is enabled only when the draft is current, every changed
page's exact Draft candidate has rendered successfully in this session (images
and fonts loaded), the host permits Apply, and no reply is running. Apply
coordinates every open authoring tab first; an unsaved edit anywhere blocks it
and is kept. All changed pages, their derived JSX and one receipt are
committed together under the existing writer journal, or none are. A lost
response is recovered from the receipt (**Check receipt**). **Undo apply**
restores the pages once and refuses if any page changed afterwards.

If a saved page changes after a proposal, the draft shows it as stale. Apply
stays disabled until **Revalidate** replays the draft onto the saved pages
(reporting anything that no longer applies) and you review again.

## Memory

Each site (host installation + workspace) has one editable Memory document,
opened from **Memory** in the conversation header. It is separate from
conversations and page content.

| Mode | Model reads Memory | Model may change Memory |
| --- | --- | --- |
| **Read only** (default) | yes | only by proposal you approve |
| **Auto remember** | yes | small bounded updates grounded in your turn |
| **Off** | no | no (you can still edit it) |

The latest saved Memory is read immediately before **every** model call, and
each reply shows the revision it used. Saving, clearing and restoring use
revision checks and keep your unsaved text on conflict; restore creates a new
revision. Clear, restore and mode changes fence out automatic updates from
replies that started earlier. Clearing Memory does not erase conversations.
Memory is context, never authority: it cannot add tools, widen scope or
approve page changes. History keeps the last 100 revisions.

## Supported scope

- Declared-field updates on blocks of writable, workspace-owned pages.
- Insertion of registered components into allowed slots/positions, and copying
  an existing block. Components whose author defaults contain copy must have
  those values supplied explicitly; components that require child blocks
  cannot be inserted.
- Exact standalone text/table/image insertion where the host declares
  `nativeEditing` paragraph/table/image components (see
  [native editing](./native-editing.md)).

Not supported, and explained when relevant: source-authored hosts
(`site-project.ts`/`.json`), Mapping/Content-owned pages and values,
collection slots filled through Mapping, shared or published templates,
positions inside a Markdown field, and arbitrary tables or components a theme
does not define. A request is never silently moved to another position.

## Storage and recovery

Assistant data is private authoring state under the host data directory:
`<dataDir>/assistant` (conversations, run events, Memory, name, attached
materials) and `<dataDir>/edit-drafts` (shared drafts). It is keyed by the
host's real path and the `WorkspaceRecord.id`, never by a display name, and is
never part of SiteProject JSON, generated JSX, assets, site builds or visitor
routes. Files with an unknown schema are preserved and reported, not replaced.

Runs stream ordered events; a reconnecting tab replays from its last sequence.
After a server restart, unfinished replies are marked **Interrupted**, never
applied; **Retry this turn** reuses the same turn. Stop ends a reply at once,
and late output or tool calls from a stopped reply are discarded. Draft writes
carry the draft generation the reply observed, so a discarded, applied or
undone draft cannot be revived by a late reply.

## Verification

- Native/store/runner tests: `server/edit/__tests__/draft-service.test.ts`,
  `server/assistant/__tests__/*.test.ts` (runner tests use a scripted fake
  provider), and the preview/review tests under `src/`.
- `pnpm test:browser:assistant` (port 4177) seeds disposable writable hosts from
  the real Orrery, Margin Notes and Nightjar Supply definitions and the
  native-edit fixture (`scripts/assistant/prepare-host.mjs`), then drives the
  real dev server, renderers and adapter against a loopback **scripted**
  Messages API. It is real-browser evidence with fake model replies, not live
  inference.
- Live-provider behavior needs a real credential and is recorded separately.
  Synthetic IME tests are not physical-device evidence.
