# Content-AI verification records

`real-cli/` receives the results of `pnpm test:browser:content-ai:real-cli`, the
opt-in Content-AI acceptance that drives the independently installed Article CMS
with a person's normal `claude-cli` or `codex-cli` sign-in (see
`docs/local-operation.md`). Each file is named `<provider>-<cliVersion>-<sha8>.json`
and records the label, outcome (`pass`, `fail` or `blocked`), the provider
identity, the model call count and every step's details. Earlier results,
failures included, are kept; a rerun gets a numbered name.

Dry runs with the repository's fake CLI executables are never written here, and
no file here is produced by CI. An empty `real-cli/` means the real-model
journey has not been run.
