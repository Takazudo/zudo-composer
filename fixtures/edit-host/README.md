# Native editing installed host

This disposable host owns a paragraph/list/image/table pack. The install proof
creates its package manifest outside the checkout, installs the packed tool and
contract, then runs `initialize.mjs` using only installed public entry points.
The host has no generated SiteProject source or JSON. Initialization authors an
in-memory project and persists it through the canonical workspace stores; the
image is uploaded through the managed Assets store.

Run `corepack pnpm edit:installed` after preparing the public entries.
The proof owns browser port 4175 and must run under the heavy-test guard with
other browser lanes stopped. It exercises three CLI edits and opens the resulting
records in the actual Composer UI, then reopens them after a server restart.
The live server must reject CLI plan/apply requests with `authoring-busy`.
The proof also imports the installed `zudo-composer/editing` public service.

Playwright Chromium is used by default. Environments with a provisioned system
Chromium may set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to its absolute executable
path; the same browser assertions still run.
