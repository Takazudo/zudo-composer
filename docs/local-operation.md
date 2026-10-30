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

One command opens any of the four demos in the AI Assistant, with that demo's
own components, styles, images and pages:

```sh
corepack pnpm assistant:local -- --host <sample|landing|blog|webshop> --provider <fake|claude-cli|codex-cli>
```

| Demo | `--host` | Start it | Try this (fake provider) |
| --- | --- | --- | --- |
| Sample Studio | `sample` | `corepack pnpm assistant:local -- --host sample` | `replace "Clear ideas, carefully shaped" with "Clear ideas, shaped together"` |
| Orrery | `landing` | `corepack pnpm assistant:local` (the default) | `replace "Plan next week in ten minutes" with "Plan next week in five minutes"` |
| Margin Notes | `blog` | `corepack pnpm assistant:local -- --host blog` | `replace "The Sunday note" with "The Saturday note"` |
| Nightjar Supply | `webshop` | `corepack pnpm assistant:local -- --host webshop` | `replace "Letters from the shelf" with "Letters from the workbench"` |

`--host edit-host` opens the small native-edit fixture instead. Run one host
at a time on the default port, or give each its own `--port`.

**Providers.** `--provider fake` (the default) is offline and deterministic:
it never contacts a model and understands only a few fixed requests —
`replace "A" with "B"`, `replace "A" with "B" on all pages`, `suggest "text"`
and `remember: a fact`. It proves the editing flow, not answer quality.
`--provider claude-cli` and `--provider codex-cli` use the Claude Code or
Codex CLI you are already signed in to, so you can ask in your own words
("make the Home heading warmer"). At start the launcher only looks the CLI
up: if it is missing, the `Provider:` line says `unavailable: …`. The
authoring server then checks that the CLI runs and is signed in; when it is
not, the Assistant says that replies are unavailable and why, and **Send**
stays disabled. It never falls back to another provider. To switch, stop the server and start
again with another `--provider`; your data stays.

Other options: `--dir <path>`, `--port <n>` (default 4178; 4175–4177 belong
to test lanes), and for CLI providers `--executable <name|/abs/path>`,
`--model <id>`, `--effort low|medium|high`, `--timeout-ms <n>` (or
`ZUDO_CLAUDE_CLI_EXECUTABLE`/`_MODEL`, `ZUDO_CODEX_CLI_EXECUTABLE`/`_MODEL`).

**Using it.** Open the printed `Open:` URL; the first start lands on the
demo's editable Home. Ask for a change: it appears as a pending proposal in
**Draft** with changed words highlighted and the changed block labelled, and
**Current** marks what will change. Nothing is saved until you choose
**Apply to Composer**, which records a receipt; **Undo apply** restores the
previous content. The review highlights and labels never enter saved data or
site output.

**What it can change.** The Assistant edits fields and blocks of a page's own
Composition, within the demo's registered components. It cannot change the
shared site frame (header, navigation, footer), values delivered from Content
through Mapping (articles, products, pricing tiers, testimonials, FAQ), or
Markdown text ranges, and it does not write HTML, CSS, JSX or new components;
such requests are declined and nothing changes. Working with four demos does
not mean every page and every value is editable.

**Your data stays until you reset.**

- The first start seeds a new writable, workspace-owned host from the
  repository's real demo definition and component pack through the public
  `initializeAuthoringWorkspace`; the demo's own pack setting (a host-local
  pack or an installed themeset) is read from its config, and its images
  enter through the owning Assets store. The tracked `packages/demo-*`
  sources and generated CMS are never written.
- **Data:** `.zudo-local/assistant/<host>/` (gitignored), one folder per demo,
  so each demo has its own conversations, Memory, draft and applied changes.
  Conversations, run events and Memory are under `cms/assistant/`, the
  shared draft under `cms/edit-drafts/`, applied pages under
  `cms/compositions/`. Server output goes to `.zudo-local-host.log`
  (`--verbose` prints it instead).
- **Every later start reuses the host.** Conversations, Memory, the draft
  and applied changes survive restarts; switching provider needs no reset.
- `--reset` is the only way to start over: it deletes that demo's folder and
  seeds it again. It refuses directories this command did not create; stop
  the running server first.
- **Apply is local.** It saves into this local copy only; it does not
  publish, deploy or change the demo sites.

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
deployed, and the publication panel says so. Each step resumes from the
persisted publication status, so a publication stopped after its artifact was
verified and before activation is activated exactly once at the next start.

The list, history, comparison and restore always follow one selection, whether
it changes from the list or from the editor's own navigation. The preview names
the exact working snapshot or published baseline it shows, waits for the frame to
render that identity, and is cleared or replaced when the perspective, the
selection or the content changes; Submit stays disabled until the current saved
content is previewed again. The list and history load further pages on request. `node article-cms/proof.mjs`
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

## Content history and Content-AI

Native filesystem Content and Hosted Content answer the same editorial
boundary (`src/content/editorial`): working and published reads, stable
identities, field edits, history, compare, restore and publication status.
Each backend keeps its own authoritative store; there is no second editable
copy.

- **Native history.** Every value change appends a revision and an
  operation receipt in the same Content generation commit. An existing
  workspace opens unchanged; its current values are recorded as an
  `initial` revision ("Values before history began") on the first change.
  Restore validates the old values against the current model and appends a
  new revision; an incompatible restore is refused with field diagnostics.
  Published values come from the activated SiteProject release and are
  never changed by an edit or a restore.
- **Content editor.** An opened Entry shows its History: compare any
  revision with the working values, restore it, and load older pages.
- **Content-AI.** When the host config has an `assistant`, an Article's
  editor offers an AI proposal for **Title and Body only**. Prepare asks the
  configured provider, validates the candidate against the pinned entry
  identity and writes nothing; the editor shows each changed field and the
  exact candidate. Apply is one guarded save with operation key, receipt and
  `content-ai` provenance, so a repeated Apply returns the same receipt and a
  stale Apply (the entry changed after Prepare) is refused without writing.
  Undo restores the pre-Apply revision as a new revision and is refused if a
  later edit happened. A provider decline is shown as a refusal. Publication
  stays the existing explicit step, `permission: "propose"` disables Apply,
  and the composition Assistant keeps its refusals of Content-owned values.

`pnpm exec vitest run server/content-editorial` runs the decisive scenario
and the Content-AI scenario against both native files and local SQLite
Hosted Content. `pnpm test:browser:content-history` and
`pnpm test:browser:content-ai` drive a disposable copy of the Blog host with
the fake provider (port 4179); real CLI providers follow the evidence table
above.

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
  installed Article CMS consumer; native Content history behind the shared
  editorial boundary; Content-AI for Article title and body.
- **Replaced:** completion no longer waits for direct Anthropic API live
  inference or for production delivery. Real use is verified with each
  CLI's normal sign-in through an opt-in command.
- **Deferred:** Pinsel API migration and production settings; production
  resources, remote D1, Access, a real Git publisher, Cloudflare delivery and
  releases; Assistant edits to Mapping-owned values and Content fields beyond
  Article title and body, shared templates
  and source-authored hosts; arbitrary HTML/CSS/JSX and new components;
  task-specific draft branches, partial Apply and Markdown range edits;
  Windows-native CLI support; physical-device checks.
