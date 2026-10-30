# Local operation

Composer runs completely on your machine: the AI Assistant can answer through
the Claude Code or Codex CLI you are already signed in to, or through an
offline deterministic fake, and Hosted Content can be edited, previewed and
published to a local artifact. None of this needs an API key, Cloudflare,
Access, D1, a Git publisher or a deployment.

## Four modes, three independent choices

| Mode | Content storage | What runs | Where it is described |
| --- | --- | --- | --- |
| **Browser demos** | Browser tab memory; a reload starts over | The hosted demo editors and static sites | [hosted demo](./hosted-demo.md) |
| **Local AI** | The workspace filesystem (`.zudo-local/assistant/<host>/`) | The authoring server with the AI Assistant | [AI editing host](#ai-editing-host) |
| **Local Hosted Content** | SQLite, served over loopback HTTP, with local artifacts | The public Hosted Content service, editor and renderer | [Hosted Content host](#hosted-content-host), [Article CMS](#article-cms-consumer) |
| **Production Hosted Content** | The host's own store, for example D1 | Contracts only here: the host owns auth, storage and delivery | [Hosted Content adapters](./hosted-content.md) |

Three choices are independent of each other and of the mode:

- **Content perspective.** `working` is the retained draft; `published` is
  the active canonical baseline. Reading `published` never filters the draft
  by lifecycle.
- **Content backend.** In-memory test storage, local SQLite, or a host's
  production adapter. They all implement the same `HostedStorage` contract
  and pass the same conformance runner.
- **AI provider.** `fake`, `claude-cli` or `codex-cli` (and the opt-in
  `anthropic`). The provider never changes where content is stored, and
  direct Anthropic API inference is not required for any local mode.

## AI editing host

```sh
corepack pnpm assistant:local                          # fake provider, Orrery (landing) host
corepack pnpm assistant:local -- --provider claude-cli # your signed-in Claude Code
corepack pnpm assistant:local -- --provider codex-cli  # your signed-in Codex
```

Options: `--host landing|blog|webshop|edit-host`, `--dir <path>`,
`--port <n>` (default 4178; 4175–4177 belong to test lanes), and for CLI
providers `--executable <name|/abs/path>`, `--model <id>`,
`--effort low|medium|high`, `--timeout-ms <n>` (or
`ZUDO_CLAUDE_CLI_EXECUTABLE`/`_MODEL`, `ZUDO_CODEX_CLI_EXECUTABLE`/`_MODEL`).

- The first start seeds a new writable, workspace-owned host from the
  repository's real demo definition and component pack through the public
  `initializeAuthoringWorkspace`; tracked demo sources and generated CMS are
  never made writable.
- It prints the URL to open (`/composer?assistant=1&…`), the provider status
  (for a CLI: found and version, or why it is unavailable; only `--version`
  is run) and where data is stored.
- **Data:** `.zudo-local/assistant/<host>/` (gitignored). Conversations, run
  events and Memory are under `cms/assistant/`, the shared draft under
  `cms/edit-drafts/`, applied pages under `cms/compositions/`. Server output
  goes to `.zudo-local-host.log` (`--verbose` prints it instead).
- **Every later start reuses the host.** Conversations, Memory, the draft and
  applied changes survive restarts; switching provider needs no reset.
- `--reset` is the only way to start over. It refuses directories this
  command did not create; stop the running server first.

The Assistant UI, provider selection, CLI profiles and troubleshooting are
described in [AI Assistant](./assistant.md).

## Hosted Content host

```sh
corepack pnpm hosted:local:prepare   # once, needs network: installs the real renderer host
corepack pnpm hosted:local           # every time; never installs anything
corepack pnpm hosted:local -- --dir <path> --port <n>   # default 127.0.0.1:4179
```

- It uses the public Hosted Content service with a real SQLite file over
  loopback HTTP, the published editor, and the **real renderer**
  (`fixtures/hosted-content-consumer/renderer/`, ZFB + zudo-sg) installed by
  the existing `scripts/install-hosted-consumer.mjs`. Preparation installs it
  into `.zudo-local/renderer-host/<sha12>/` at the merge-base commit and
  refuses one whose hosted-content code differs from your checkout; a normal
  start refuses a missing or stale installation and prints the prepare
  command.
- In the browser: edit and **Save**, review the **exact saved snapshot** in
  the real renderer's preview, **Generate local artifact**, then open it.
  Each artifact is a real ZFB build of that immutable snapshot, stored under
  `.zudo-local/hosted-content/artifacts/<publication>/` with a manifest that
  links publication, snapshot, digest, operation and renderer, and opened at
  `/local-artifacts/<publication>/` (each artifact is served on its own
  loopback origin). It is labelled a local artifact and is never live,
  production or deployed.
- **Data:** `.zudo-local/hosted-content/` holds `content.sqlite`, the local
  publication sink (`publication/remote.json`) and the artifacts. Identity
  (a fixed local actor), storage, renderer and publisher are chosen in one
  composition root (`local/host.mjs`); core and UI have no local/production
  branches.
- Saving while a publication builds does not change that publication; a
  restart, lost acknowledgement, failed build or stale notification resumes
  from the persisted facts without duplicating the operation. `--reset` is
  the only way to delete local data and refuses folders it did not create.
- Proofs: `corepack pnpm hosted:local:proof` (after preparation; needs
  Chromium).

## Article CMS consumer

`fixtures/hosted-content-consumer/article-cms/` is a host-customized Article
admin built only from public imports (`zudo-composer/hosted-content`,
`/hosted-content/editor` and `/hosted-content/editor.css`). The host owns the
Article model and its presentation metadata, the policy, the projection, the
navigation, the article list with editorial status, the working and published
views, the history panel (compare and restore), the publication panel and one
field control: a title length counter that wraps the built-in control through
`fieldRenderers`. A "Standard form" switch mounts the same editor without it;
both write the same records through the same commands.

It runs from an independently installed consumer, never from this checkout:

```sh
node scripts/install-hosted-consumer.mjs <full-sha> <dir>   # once, needs network
cd <dir> && node article-cms/server.mjs [data-dir] [port]   # default .zudo-local/article-cms, 4180
```

Data is one SQLite file plus local artifacts under the data directory. Submit
writes a local artifact and activates it as the local baseline; nothing is
deployed, and the publication panel says so. `node article-cms/proof.mjs`
drives the whole journey in Chromium and is part of `pnpm hosted:installed`.

## Kinds of evidence

| Kind | Talks to | Proves | Does not prove |
| --- | --- | --- | --- |
| **Fake** (`provider: "fake"`, fake CLI executables) | Nothing | The editing contract, validation, persistence, Apply/receipt/Undo, Stop, process handling | Anything about a real model or CLI |
| **Real binary harness** | The installed CLI, with a loopback **scripted** model endpoint | The CLI's protocol, the restricted profile (refused tools and writes), error mapping and Stop on that version | Model behavior or inference quality |
| **Real CLI usage** | Your installed CLI with your normal sign-in, and its model | The whole journey with a real model, per CLI | Production delivery or another CLI/version/OS |
| **Physical device** | A real phone or tablet browser on the local network | Touch, viewport and on-device behavior of the same journeys | Anything the other rows already cover |
| **Production check** | Hosted services | Not part of local operation; deferred | — |

Each row proves something different: a fake or scripted run never stands in
for real CLI usage, and real CLI usage never stands in for a physical device.

## Content-AI milestone (planned, not implemented)

The AI Assistant still refuses Hosted Content- and Mapping-owned values; those
refusals stay until this route lands as its own change:

1. The Assistant proposes Content edits as ordinary `set-fields` or
   `restore-revision` commands against the **working** perspective, with
   operation keys and expected identities, through the same Hosted Content
   service and policy; it never writes storage directly.
2. A proposal shows a field-level comparison (`compareRevisions`) and the
   exact snapshot preview before Apply; Apply is the guarded save and records
   a revision whose `source` names the Assistant.
3. Undo is a `restore-revision` of the previous revision, so history stays
   append-only and publication stays the existing explicit Submit.
4. Verification follows the evidence table above: the fake provider first,
   then each CLI with its normal sign-in.

## Production delivery is stopped

Hosted-demo production delivery is stopped
(`scripts/hosted-demo/delivery-state.mjs` is `"stopped"`): the deploy
workflow has no automatic trigger, and its guard and deploy entry refuse
every event. CI still builds and verifies every artifact. Re-enabling is a
separate, owner-approved change; see [hosted demo](./hosted-demo.md).

## Changes from the earlier plan

- **Added:** explicit provider selection (`fake`, `claude-cli`, `codex-cli`,
  `anthropic`) without fallback; the Claude Code and Codex CLI providers with
  fixed restricted profiles; a deterministic fake provider and fake CLI
  executables on the same structured reply contract; real-binary harnesses;
  the persistent local AI host; the persistent local Hosted Content host;
  the Hosted Content editorial API with durable revision history; the
  installed Article CMS consumer.
- **Replaced:** completion no longer waits for direct Anthropic API live
  inference or for production delivery. Real use is verified with each
  CLI's normal sign-in through an opt-in command.
- **Deferred:** Pinsel API migration and production settings; production
  resources, remote D1, Access, a real Git publisher, Cloudflare delivery and
  releases; AI edits to Hosted Content/Mapping-owned values, shared templates
  and source-authored hosts; arbitrary HTML/CSS/JSX and new components;
  task-specific draft branches, partial Apply and Markdown range edits;
  Windows-native CLI support; physical-device checks.
