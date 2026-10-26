# Local operation

Composer runs completely on your machine: the AI Assistant can answer through
the Claude Code or Codex CLI you are already signed in to, or through an
offline deterministic fake, and Hosted Content can be edited, previewed and
published to a local artifact. None of this needs an API key, Cloudflare,
Access, D1, a Git publisher or a deployment.

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

## Kinds of evidence

| Kind | Talks to | Proves | Does not prove |
| --- | --- | --- | --- |
| **Fake** (`provider: "fake"`, fake CLI executables) | Nothing | The editing contract, validation, persistence, Apply/receipt/Undo, Stop, process handling | Anything about a real model or CLI |
| **Real binary harness** | The installed CLI, with a loopback **scripted** model endpoint | The CLI's protocol, the restricted profile (refused tools and writes), error mapping and Stop on that version | Model behavior or inference quality |
| **Real CLI usage** | Your installed CLI with your normal sign-in, and its model | The whole journey with a real model, per CLI | Production delivery or another CLI/version/OS |
| **Production check** | Hosted services | Not part of local operation; deferred | — |

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
  the persistent local AI host; the persistent local Hosted Content host.
- **Replaced:** completion no longer waits for direct Anthropic API live
  inference or for production delivery. Real use is verified with each
  CLI's normal sign-in through an opt-in command.
- **Deferred:** Pinsel API migration and production settings; production
  resources, remote D1, Access, a real Git publisher, Cloudflare delivery and
  releases; AI edits to Hosted Content/Mapping-owned values, shared templates
  and source-authored hosts; arbitrary HTML/CSS/JSX and new components;
  task-specific draft branches, partial Apply and Markdown range edits;
  Windows-native CLI support; physical-device checks.
