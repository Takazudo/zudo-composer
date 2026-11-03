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
`/hosted-content/editor`, `/hosted-content/editor.css` and, for its Node server,
`/hosted-content/node`). The host owns the
Article model and its presentation metadata, the policy, the projection, the
navigation, the article list with editorial status, the working and published
views, the history panel (compare and restore), the publication panel and one
field control: a title length counter that wraps the built-in control through
`fieldRenderers`. A "Standard form" switch mounts the same editor without it;
both write the same records through the same commands.

It runs from an independently installed consumer, never from this checkout.
Install a pushed commit of this checkout once (it needs network), then start
the admin from that directory:

```sh
corepack pnpm hosted:install <full pushed sha> <consumer dir>   # = node scripts/install-hosted-consumer.mjs
cd <consumer dir>
node article-cms/server.mjs --data .zudo-local/article-cms --ai fake        # offline fake provider, port 4180
node article-cms/server.mjs --data .zudo-local/article-cms --ai claude-cli  # your signed-in Claude Code CLI
node article-cms/server.mjs --data .zudo-local/article-cms --ai codex-cli   # your signed-in Codex CLI
node article-cms/server.mjs --data .zudo-local/article-cms --ai off         # no new inference
```

`--data` and `--ai` are required, so the storage location and the Content-AI
provider are always explicit. A CLI provider runs in this Node process, never in
the browser; add `--executable`, `--model` or `--timeout-ms` as needed. The
start banner prints the data file and the provider's current status. The admin's
AI panel prepares a title/body proposal, shows its field differences and the
candidate rendered as the real article, and applies or undoes it as one revision
in the same history as manual edits. See
[Content-AI for an independent host](./hosted-content.md#content-ai-for-an-independent-host).

The same data directory can be started with any provider, in any order, and is
never reseeded or reset when the provider changes. Stop the process (Ctrl+C or
SIGTERM) before starting it again with another `--ai`.

| | `fake`, `claude-cli`, `codex-cli` | `off` |
| --- | --- | --- |
| New proposal (Prepare) | Yes, through that provider only | Refused (`unavailable`); no CLI is started, probed or asked |
| Saved proposals, their field differences and candidate render | Yes | Yes |
| Apply or Undo of an existing proposal (write accounts, fresh render for Apply, current content) | Yes | Yes |
| Recovery of a committed Apply or Undo after a lost answer, reload or restart | Yes; no render, model call or write permission needed | Yes, the same |
| Manual editing, history, compare, restore, publication | Yes | Yes |

A fresh Apply still needs the proposal to be unexpired, its candidate rendered
again in this page and the content unchanged since it was prepared; a fresh Undo
still needs the account's current write permission and no later edit. Recovery
only reads what the host already committed. When an Apply or Undo answer is
lost and the read finds no committed result yet, the panel keeps it pending and
offers **Check again** instead of reporting it failed or resending it; the same
operation can only commit once. `node article-cms/ai-launcher-proof.mjs` proves
this table with separate `server.mjs` processes on one data directory (fake →
off → fake) in Chromium.

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
  editor offers an AI proposal for **Title and Body only**. See below.

### Content-AI proposals

**Prepare** asks the configured provider, validates the candidate against the
pinned Entry identity through the owning backend and writes no Content. The
proposal (id, Entry, pinned precondition, owner scope and actor, the exact
candidate and its digest, the operation key, creation and expiry times) is
stored create-only before the editor sees it, under `<dataDir>/content-ai/`
beside the native Content files. The service takes its proposal store as a
dependency, and the shared scenario runs it against local SQLite Hosted
Content too, with both this file store and the Article CMS host's own
create-only SQLite store. A hosted site supplies its own durable store. A record is never changed; whether it was applied or
undone is read back from the Content store's own receipts.

**Review.** The editor shows the changed fields, the raw candidate text and
the **rendered candidate**: the working project is compiled exactly as
`/website-preview` compiles it, with only this Entry's validated candidate
overlaid in memory, and the route that shows the Entry is rendered by the
host's own template, Mapping, components and styles. The raw text shows what
will be stored; the rendered page shows how the site will present it (a
Markdown heading or link as rendered output, missing images or fonts as a
failed render). Nothing is saved while rendering.

**Apply.** A fresh Apply is available only once the frame has acknowledged
the current render of this exact candidate: the acknowledgement names the
proposal, its digest, the route and Mapping, and a digest of the rendered
dependencies, and only the latest render counts. The editor states
preparing, rendering, ready for review, stale, render failed, applying or
recovering, applied and undone. A new proposal, a local edit, a change of
Entry, or a new render invalidates the approval, and after a reload the
candidate must render again. The check lives in the controller's command
path and again in the service, which refuses a fresh Apply without the
candidate's digest. Apply is one keyed save through the same editorial path
as a human edit, with `content-ai` provenance; a stale Apply (the Entry
changed after Prepare) is refused, writes nothing and offers Prepare again.
A host without a renderer for the Entry shows a blocked state and never
enables Apply.

**Lost acknowledgements and restarts.** Apply and Undo first look up their
own operation key in the backend's receipts. If the commit happened and the
response was lost, or the process stopped right after the commit, the retry
returns the original receipt and adds no revision; it needs no new preview,
because nothing new is written. The browser keeps a per-Entry reference to
the last proposal (`localStorage`), so a reload reads the proposal and its
committed outcome back without calling the model. A restarted dev server
issues a new request capability, so an open page reloads before it can use
it, which Vite does by itself.

**Undo** restores the revision before the Apply as a new revision, pinned to
the state right after Apply, so it is refused rather than overwriting a later
human edit. A retried Undo recovers its own receipt the same way.

**Expiry.** An unapplied proposal can be freshly applied for 24 hours after
Prepare; after that the editor offers Prepare again. A committed Apply or
Undo stays recoverable for as long as its record exists, and records are
never pruned or reused: ids are random UUIDs, and the operation key derives
from the id. Proposals belong to their backend scope and actor; another
workspace, backend or actor gets "not found".

A provider decline is shown as a refusal. Publication stays the existing
explicit step, `permission: "propose"` disables a fresh Apply and a fresh Undo
(committed ones stay recoverable), and the composition Assistant keeps its
refusals of Content-owned values.

**Provider status.** The editor separates "configured" from "can run now": a
CLI that is missing, too old, signed out or undeterminable is shown with its
reason, Prepare is disabled while it is unavailable, and saved proposals,
their committed results and the Entry's history stay readable. An
undeterminable sign-in is never shown as signed in.

`pnpm exec vitest run server/content-editorial` runs the decisive scenario
and the Content-AI scenario against both native files and local SQLite
Hosted Content, closing and reopening the store and the proposal records
between each half of a recovery. `pnpm test:browser:content-history` and
`pnpm test:browser:content-ai` drive a disposable copy of the Blog host with
the fake provider on port 4179, including a delayed and a failed render, a
lost Apply acknowledgement followed by a dev-server restart and reload, and a
lost Undo acknowledgement followed by a retry and a restart. CI runs both in
the `content-browser` job. These use fake replies and are not evidence of
model behavior.

### Content-AI real-CLI acceptance

`pnpm test:browser:content-ai:real-cli` is the Content-AI-specific opt-in
check; the composition Assistant's `test:browser:assistant:real-cli` does not
cover Content-AI. It runs one provider at a time through the independently
installed Article CMS, with your normal CLI sign-in, and never in CI:

```sh
pnpm hosted:install <pushed sha of this checkout> <consumer dir>   # once; needs network
pnpm test:browser:content-ai:real-cli -- --provider claude-cli --consumer <consumer dir> --plan
pnpm test:browser:content-ai:real-cli -- --provider claude-cli --consumer <consumer dir> --yes
```

- `--plan` prints the target data, provider, the one planned model call and
  the limits, and runs nothing; without `--yes` nothing runs either.
- The consumer's installed hosted-content payload must equal this checkout.
  The scratch host is a fresh copy of the checkout's `article-cms` fixture over
  that consumer's `node_modules`, with its own SQLite data in a temp dir; no
  existing workspace or data is opened.
- Exactly one model call (one title-only proposal for the "welcome" article);
  a second call is refused, every step runs once, and there is no retry until
  success and no fallback to the fake. `--timeout-ms` bounds the reply
  (default 180000).
- `--max-minutes` (default 10, at most 30) is a deadline for the whole run,
  set before the scratch host is created. The steps run as one process group
  (host, browser, CLI). At the deadline their HTTP requests and the provider
  call are cancelled (the CLI's own process group is killed) and the browser and
  host are closed; whatever is still running after a 15 s grace period is
  killed, and on Linux so is any process carrying the run's environment marker.
  Nothing outside the run is signalled, and Ctrl+C stops the run the same way
  (recorded as `interruptedIn`). The result is then written as `fail`
  with `deadline.timedOutPhase` naming the step (or `cleanup` when cleanup
  overran its grace), and the scratch host is removed unless `--keep`.
  `node scripts/content-ai/verify-real-cli-deadline.mjs --consumer <dir>` checks
  this with the fake CLI and proof-only stalls (a request that never answers, a
  render that never finishes, a provider that never replies, a stuck cleanup, Ctrl+C)
  and runs in CI; a fake dry run may run in CI, a real run never does.
- Steps: provider status → publish A, save B → prepare → rendered candidate →
  Apply → restart, reload and recover the Apply → Undo → restart and recover
  the Undo. They are judged by the changed field (title only), the saved
  values, the unchanged body, summary, author and published values, AI
  provenance, and receipt/history invariants — never by the wording, and the
  model call count must stay 1 through every recovery.
- A provider that is not ready records `blocked` (exit 3) without a model
  call. Results go to `verification/content-ai/real-cli/`; a dry run with the
  repository fake CLI (`--executable scripts/fixtures/assistant/fake-claude-cli.mjs
  --allow-fake-executable`) is labelled as such and written to
  `test-results/content-ai-real-cli-dry-run/` only.

Three different claims, recorded separately:

- **Configured**: `--provider` and `--executable` name the CLI; nothing is known
  about it yet.
- **Available**: the local status check passed (installed, supported version,
  signed in where the CLI can tell). The banner and `provider-status` show it; a
  check that cannot decide is `unknown`, never "signed in". No model was asked.
- **Exercised with a real model**: a `--yes` run whose result is labelled
  `normal-login real CLI inference` and `pass`. Only this row is model evidence.

**Still outstanding:** a Content-AI journey with a real model through
`claude-cli`, `codex-cli` or `anthropic` (the **Real CLI usage** row above)
and the **Physical device** row. Neither is claimed by the fake lanes or a
dry run.

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
