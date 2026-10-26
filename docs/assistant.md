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
workspace-owned pages) and an `assistant` block in `zudo-composer.config.ts`
that selects exactly **one** provider:

```ts
export default defineComposerConfig({
  pack: "my-site/components",
  nativeEditing: { source: "workspace" },
  assistant: { provider: "claude-cli", name: "Site Bot" },
});
```

| `provider` | What answers | Settings (all optional except `provider`) |
| --- | --- | --- |
| `"fake"` | Deterministic offline policy; no model, no network | `name`, `permission` |
| `"claude-cli"` | Your installed, signed-in Claude Code CLI | `executable` (default `claude`), `model`, `effort`, `timeoutMs` |
| `"codex-cli"` | Your installed, signed-in Codex CLI | `executable` (default `codex`), `model`, `effort`, `timeoutMs` |
| `"anthropic"` (default) | Anthropic Messages API via the pinned SDK | `model`, `apiKeyEnv`, `effort`, `baseUrl` |

`name` is the default display name (renamable per site); `permission` is
`"apply"` or `"propose"` (review allowed, Apply refused). `executable` is a
command name looked up on `PATH` or an absolute path, never a command line.
API-only settings are rejected for the CLI and fake providers. The config
never holds a secret.

**There is no fallback.** If the selected provider is missing, signed out or
unsupported, the Assistant shows that state and sends nothing; it never
switches to another provider. Composer, review, Memory and saved
conversations keep working.

### CLI providers

A CLI provider is used for **one model reply per call**. Composer renders the
whole request (rules, tool list, bounded conversation, tool results) as one
escaped JSON document on **stdin**, runs the CLI with a fixed restricted
profile in a fresh empty temporary directory, and reads its JSONL output.
The CLI answers with Composer's structured reply (`text`, requested
`tool_calls`, `stop`); Composer validates it itself (allowed tool names,
unused ids, JSON object inputs, size limits) and only Composer's runner
executes inspect/read/list/propose/Memory tools. The CLI never gets an
Apply, Undo, publish, file or shell capability, no Composer MCP server, and
no CLI session/resume/auto-memory is used as Composer state.

- Arguments, environment additions and the output schema file are fixed by
  Composer, never derived from prompts or model output; the process runs with
  `shell: false` in its own process group. **Stop**, the reply timeout and
  server shutdown terminate that process tree and wait for it; late output is
  ignored.
- A reply counts only when the CLI's terminal result reports success, the
  structured reply is present and the exit status is 0. Raw CLI output,
  thinking and messages that could carry secrets are never shown; errors are
  mapped to fixed messages (not installed, not signed in, unsupported
  version/platform, refused, usage limit, overloaded, timeout, malformed).
- Progress shows only what the CLI actually reports (for example "Codex is
  reasoning"); replies are not streamed token by token.
- Composer never reads, copies or stores credentials and does not relocate
  `HOME`/`CODEX_HOME`. The CLI uses its own normal sign-in. For `claude-cli`
  the server's `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and
  `ANTHROPIC_BASE_URL` are withheld, so a key held for the API provider is
  never reused; Composer's own `ZUDO_ASSISTANT_*` variables are withheld from
  every CLI.

| CLI | Supported | Fixed profile (summary) |
| --- | --- | --- |
| Claude Code | **2.1.310** or later on macOS and Linux/WSL | `-p --output-format stream-json --verbose --no-session-persistence --safe-mode --restricted --setting-sources "" --tools "" --strict-mcp-config --mcp-config '{"mcpServers":{}}' --disallowedTools "mcp__*" --permission-mode dontAsk --permission-prompts none --disable-slash-commands --max-turns 1 --system-prompt <fixed> --json-schema <reply schema>` |
| Codex | **0.164.0** or later on macOS and Linux/WSL | `exec --json --ephemeral --skip-git-repo-check -C <scratch> --ignore-user-config --ignore-rules --strict-config --sandbox read-only -c approval_policy="never"`; shell/exec, web search, multi-agent, apps, plugins, hooks, memories, image, browser/computer use, code mode, plan and user-input tools disabled; skills, AGENTS.md project docs and environment context off; no history or side channels; `--output-schema <file> -`. A reply in which Codex ran one of its own tools is refused. |

Each version range was verified on Linux with the real binary against a
loopback scripted model endpoint (see Verification). macOS uses the same
flags but was not run; Windows is reported as unsupported. Any probe that
finds an older version or a missing flag reports **unsupported**; Composer
never runs a looser profile. What still applies under these profiles:

- **Managed/admin policy** is never bypassed (Claude Code managed settings;
  Codex `managed_config.toml`/`requirements.toml`/MDM). If it adds tools or
  rejects the profile, the run fails closed.
- **Claude Code:** user/project settings, CLAUDE.md, hooks, plugins and MCP
  are not loaded; only `StructuredOutput` is offered, and the model's attempts
  at Write/Edit/Bash were answered "No such tool". Sign-in that depends on
  `apiKeyHelper` or `env` in your user `settings.json` is therefore not
  available; use `claude auth login` (or `CLAUDE_CODE_OAUTH_TOKEN`).
- **Codex:** `apply_patch` is part of the model's own toolset and cannot be
  removed; the read-only sandbox with approval `never` rejects every patch,
  inside or outside the scratch directory. **Read-only does not stop
  reading**: no read tool is offered by this profile, but the sandbox itself
  would allow reading files your account can read. Global
  `$CODEX_HOME/AGENTS.md` is still sent to the model, and Codex still writes
  its own state databases under `CODEX_HOME`. If you set
  `cli_auth_credentials_store="keyring"` in your user `config.toml`, that
  setting is ignored by this profile and replies fail as signed out.

### When a CLI provider is unavailable

| Shown | Do this |
| --- | --- |
| not installed | Install the CLI, or set `assistant.executable` to its absolute path, then reload. |
| not signed in | Run `claude auth login` or `codex login` in a terminal as the same user, then retry. |
| unsupported version | Update the CLI to the supported version or later. |
| unsupported platform | Use macOS or Linux/WSL. |
| usage limit / overloaded | Wait and retry; Composer does not switch providers. |

### Anthropic Messages API provider

`provider: "anthropic"` calls the Messages API through the pinned official
SDK (`@anthropic-ai/sdk`) from the local authoring server, with streaming,
adaptive thinking and the server-side refusal fallback
(`fallbacks: "default"`). It reads only `apiKeyEnv` (default
`ANTHROPIC_API_KEY`) and `baseUrl`, and ignores
`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`. Start `zudo-composer dev` with
that variable set in the server's environment.

### What a model call can carry

Each model call can send: your message and recent conversation (bounded), the
current page/selection ids, the blocks the model inspects, saved site Memory,
exact materials you attach to the turn, and component definitions from the
installed pack. **Context details** under the message box lists this, the
destination, model and CLI version. Host paths and source files are never
sent; credentials are never read by Composer. Each run records the provider,
model and CLI version that produced it.

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

Long values are shown to the model shortened; it must read the exact value
(`read_field`) before proposing an edit to such a field, and a value carrying
the shortened-display marker is refused.

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

Evidence classes are kept separate; none stands in for another.

| Class | Command | What it proves |
| --- | --- | --- |
| Provider contract (fake) | `pnpm test` (`server/assistant/__tests__/`) | The same multi-page propose → Apply → receipt retry → Undo, Memory, refusal, unknown-tool and Stop flow passes for the in-process fake and for fake `claude`/`codex` executables that are really spawned; reply validation, process runner (stdin, UTF-8 chunking, size caps, process-tree Stop/timeout) and probe states. |
| Fake browser | `pnpm test:browser:assistant` (port 4177) | Real dev server, renderers and UI on disposable hosts seeded from Orrery, Margin Notes, Nightjar Supply and the native-edit fixture against a loopback scripted Messages API. |
| Local host lifecycle | `pnpm test:browser:assistant:local-host` | `pnpm assistant:local` creates, reuses and restarts a host; Memory, conversation and applied change survive restart; reset is explicit. Fake provider. |
| Real CLI binary harness | `pnpm assistant:claude-harness`, `pnpm assistant:codex-harness -- --codex <path>` (opt-in, never CI) | The installed binary with Composer's exact profile against a loopback **scripted** model endpoint: output protocol, refused built-in tools/writes, error mapping, Stop. Evidence: `verification/assistant/cli-harness/`. **Not model inference.** |
| Real CLI usage | `pnpm test:browser:assistant:real-cli -- --provider claude-cli\|codex-cli --yes` (opt-in, uses your normal sign-in) | Natural-language edit → candidate → preview → Apply → reload → Undo, Memory, Stop, restart and out-of-scope refusal with a real model. Evidence: `verification/assistant/real-cli/`. |
| Live Messages API | `pnpm test:browser:assistant:live` | The API provider with a dedicated credential and approved spend cap; records `blocked` without them. |

Fake success is never reported as real CLI use, and harness success is never
reported as model inference. Synthetic IME tests are not physical-device
evidence.
