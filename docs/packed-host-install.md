# Packed host install proof

Run the complete lane from the repository root, with the other browser lanes
stopped:

```sh
corepack pnpm smoke:host-install
```

The lane owns port **4175** and runs hosts serially. It packs the actual tool
and component-contract with `pnpm pack` once, then installs those archives into
disposable projects outside both this checkout and any containing checkout.
Its temporary parent must also have no ambient `node_modules` or pnpm workspace.
The complete command is also part of `corepack pnpm check`; that aggregate
therefore requires network access, installed Playwright Chromium and exclusive
use of the browser lanes. Install Chromium with
`corepack pnpm exec playwright install chromium` before the first local run.

The default command retains the synthesized `fixtures/self-host` proof: boot
without activation, author a sitemap in a browser, execute the installed image
editor worker, restart into a fresh browser context, validate release portability
in both directions, and confirm CMS data survives removal of the tool.

It also discovers real host packages from disk. Currently these are
`demo-blog`, `demo-landing`, `demo-studio`, and `demo-webshop`. Every copied host
keeps its source, component exports, styles, committed CMS, public assets,
asset-import inputs and tests. Installed dependencies, prior build artifacts,
derived releases and browser-lane scratch directories are excluded. Filesystem
links in source fail the copy instead of reaching back into a checkout.

For each host, the runner:

1. Rewrites only `zudo-composer` and `@zudo-composer/component-contract` to the
   two absolute `file:` tarballs, with exact `pnpm.overrides` also expressed in
   pnpm 11's `pnpm-workspace.yaml`. Other workspace/file/link dependencies or
   consumer overrides fail. The external provider retains its exact Git pin.
2. Generates a fresh local lockfile, then repeats the install with
   `--frozen-lockfile`. This only affects the temporary copy; the repository's
   frozen-install policy is unchanged. Module lookup must resolve both packages
   inside that host's own `node_modules`, with no repository path in the lookup
   list. The local install disables hoisting and workspace linking.
   A consumer `.npmrc` is accepted only when its exact bytes are
   `block-exotic-subdeps=false\n`, the reviewed creator setting for the exact
   provider Git pin. Every additional or altered setting fails before rewriting.
3. Boots the installed `zudo-composer dev` and fetches every canonical
   `AUTHORING_ROUTES` entry, including `/composer/preview`, as HTML.
4. Stops the server, runs installed `generate --check`, the host's `seed`
   script (asset import followed by `zudo-composer seed`), installed
   `build-site`, and the host's own test script.
5. Imports `verifySiteStaticArtifact` from the **installed** public
   `zudo-composer/site-build` entry and verifies the artifact again, including
   the host project and installed tool identities. Only then may `dist-site`
   join `node_modules`, `cms`, `public` and `.zudo-site-project` as writable
   top-level paths. Any other newly created host path fails confinement.
6. Restarts the activated host and crawls every verified `manifest.routes` entry
   under `/site`, fetching HTML explicitly and requiring a rendered heading on
   both direct navigation and refresh, with no not-found page or runtime errors.
   Studio's manifest also matches its host-owned frozen production route data.

Consumer commands receive an environment with inherited Composer roots, Node
loaders/module paths, production-only install settings and package-manager
overrides removed. Repository and `node_modules` entries are removed from the
inherited `PATH`; pnpm adds the copied host's own installed binaries. This
keeps the repository's dependencies out of consumer resolution while allowing
the runner itself to use its browser/test tooling. The existing checkout-to-pack
release-portability check intentionally exercises both runtimes separately.

The runner cleans temporary copies and archives in `finally` blocks. Startup
failure also terminates the detached server process group, including descendants
whose launcher has already exited. An occupied port fails before spawning.

## Fresh creator output and CI

The full command also creates a separate launcher project, installs the two
tarballs there, and invokes its actual installed `zudo-composer init` with
paired `--tool-tarball` and `--contract-tarball`. `check-creator --host` verifies
the pristine output's current version references, full required inventory and
strict consumer boundary before any dependency rewrite. The repository ledger
must be empty, and no template or generated-path exemption is allowed. Retained
output must have real canonical ready CMS, no installed dependencies, no activated release,
no archive and no temporary lockfile or override.

The common runner copies that real output to another external directory and
performs the same install/dev/generate/seed/build/test proof. Before seeding, it
opens the five authoring libraries in Chromium, requires the starter records
and image, rejects first-activation prompts and browser runtime errors, and
checks that opening and closing the host changed no CMS bytes. It also runs
the generated host's own `check`, including its typecheck. The untouched
creator output is scanned again and compared byte for byte after the proof.

`corepack pnpm packed-host:matrix` prints the matrix used by CI. Its host list
comes from the same disk discovery and selector as the runner: currently the
four package hosts, `generated`, and `self-host`. A later configured package is
included automatically, regardless of workspace membership. CI has one job per
entry with fail-fast disabled; it does not sample or duplicate the full lane
in the main validation job.

## Focused and negative runs

For diagnosis, select a host by name or its discovered package path:

```sh
corepack pnpm smoke:host-install -- --host demo-blog
corepack pnpm smoke:host-install -- --host generated
corepack pnpm smoke:host-install -- --host self-host
```

`--host` is repeatable. An explicit selection runs exactly those entries. The
default full command proves every discovered host and both special entries.
Negative modes require exactly one disk host.

These two commands must **exit nonzero** because of the injected runtime
failure, after their installs complete. They do not convert arbitrary failures
into a passing negative test:

```sh
corepack pnpm smoke:host-install -- --host demo-blog --negative missing-runtime
corepack pnpm smoke:host-install -- --host demo-blog --negative hoisted-dependency
```

`missing-runtime` unpacks the real tool archive, adds `!plugins/roots.mjs` to
its `files` allowlist, and runs `pnpm pack` again. It checks that the second
archive omits that file, then lets the ordinary installed dev command fail to
import it. The repository manifest and runtime files remain untouched.

`hoisted-dependency` creates a uniquely named package under the repository's
`node_modules`, proves a control import resolves from the original host, and
adds an undeclared import only to the copied host's config. The installed dev
command must fail to resolve `zudo-composer-undeclared-host-proof-<uuid>`.
The planted package is removed during cleanup. No tracked host file is changed.

When recording negatives, require the corresponding injection/control log and
the actual missing module error. A network, install, port-conflict or unrelated
test failure is not evidence for either negative. For example, the following
bounded wrapper checks the missing-runtime result and retains a diagnostic log:

```sh
packed_missing_log=$(mktemp /tmp/packed-host-missing-runtime.XXXXXX.log)
if corepack pnpm smoke:host-install -- --host demo-blog --negative missing-runtime >"$packed_missing_log" 2>&1; then
  cat "$packed_missing_log"
  exit 1
fi
rg 'negative missing-runtime: excluded plugins/roots.mjs' "$packed_missing_log"
rg "Cannot find module '.*/plugins/roots[.]mjs'" "$packed_missing_log"
```

Focused regression tests exercise tiny offline tarballs, a frozen reinstall,
pnpm's pre-exec dependency verification, both negative mechanisms, actual
artifact checksum rejection, environment isolation and process-group cleanup:

```sh
corepack pnpm exec vitest run scripts/__tests__/packed-host-install.test.ts
corepack pnpm exec vitest run scripts/__tests__/no-deploy.test.ts
corepack pnpm typecheck:scripts
```

These tests do not replace the full installed/browser lane, the exact provider
pin and 12-component runtime/CSS/WASM gates, or the repository's other checks.

## Deployment assertion

`corepack pnpm no-deploy:check` is a bounded static check; it executes none of
the commands it audits. It runs first in the aggregate, before packed installs,
and in CI before matrix discovery and each selected host. Newly generated
output receives the same audit before its scripts run.

The audit reads every nonproduction workflow and job, local composite actions
and all three Node-action lifecycle entries,
the installed-host command roots, discovered package scripts and lifecycle
hooks. It follows package aliases, local shell/Node wrappers, static imports,
CLI dispatch paths, generated script maps and literal subprocess arguments,
including imported aliases and local forwarding functions. ESM imports and
CommonJS `require`/`createRequire` are checked. Only reviewed,
pinned setup/artifact actions are allowed. A Wrangler invocation must be an
explicit `wrangler deploy --dry-run`; other verbs, disabling flags, API/SDK
calls and `hosted-demo:deploy` are rejected. Shell substitutions and unknown
external actions/commands require a directly auditable command definition.
The guarantee covers repository-controlled command definitions and these
supported static data flows. Arbitrary runtime JavaScript evaluation and
third-party tool internals are outside this static analysis.

The production workflow is excluded only as an independent entry point. Any
validation reference to that workflow or its deployment/live-check/guard
commands fails. `.github/workflows/hosted-demo-deploy.yml` and
`scripts/hosted-demo/*`, including the trusted-run guard, are unchanged by this
gate. Focused tests plant violations through each supported route and require
the ordinary assertion to fail; comments about deployment do not count as an
executable invocation.
