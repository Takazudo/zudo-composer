# Hosted content consumer host

An independent host of the hosted content entries, installed outside this
repository by `corepack pnpm smoke:host-install -- --host hosted-content-host`
(packed tarballs) and by `node scripts/verify-root-git-install.mjs` (the exact
root Git commit). It imports Composer only through public bare specifiers.

- `site.mjs` — the host's own project, component pack manifest and trusted
  editor policy.
- `worker.mjs` — a Worker-style `fetch` service over `zudo-composer/content`
  and `zudo-composer/host-storage`: draft read, expected-revision apply,
  receipt recovery, snapshot capture and route projection. Every other path,
  including `/composer`, `/mapping`, `/sitemapper`, `/assets` uploads and
  schema writes, is refused by the service. `tsconfig.worker.json` type-checks
  it against `ES2023 + WebWorker` only.
- `index.html` + `editor/main.mjs` — the restricted editor mounted with
  `zudo-composer/content-editor` over `fetch`, built by `vite.config.mjs` with
  `contentEditorPlugins()`.
- `verify.mjs` — runs the Worker checks, the Worker type check, the editor
  build and an emitted-graph scan. `serve.mjs` serves the built editor and the
  Worker together for the browser proof.

The memory storage adapter stands in for the host's durable backend; it proves
the contract, not D1 durability.
